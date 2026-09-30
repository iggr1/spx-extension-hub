const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deflateRawSync } = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const core = require('./importador-de-planilhas.js');
global.DOMParser = class { constructor() { throw new Error('DOMParser não deve ser usado sob Trusted Types.'); } };

function archive(files, deflate = true) {
  const locals = [], directory = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text), filename = Buffer.from(name);
    const data = deflate ? deflateRawSync(body) : body;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(core.crc32(body), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(filename.length, 26);
    locals.push(header, filename, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(core.crc32(body), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const end = Buffer.alloc(22), dir = Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function excel(extra = {}, deflate = true) {
  return new File([archive({
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Recebimento" r:id="rId1"/><sheet name="Expedição" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>BR00123</t></si><si><r><t>Olá, </t></r><r><t>"mundo"</t></r></si></sst>',
    'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>texto\nlinha</t></is></c><c r="B3" t="b"><v>1</v></c><c r="C3" s="1"><v>45292</v></c></row><row r="4"><c r="A4"><f>SUM(1,2)</f><v>3</v></c><c r="C4"><v>12345678901234567890</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Segunda aba</t></is></c></row></sheetData></worksheet>',
    ...extra
  }, deflate)], 'dados.xlsx');
}

test('ZIP DEFLATE/STORE, namespaces, várias abas e CSV com lacunas, aspas, linhas e datas', async () => {
  for (const deflate of [true, false]) {
    const book = await core.workbook(excel({}, deflate));
    assert.deepEqual(book.sheets.map(sheet => sheet.name), ['Recebimento', 'Expedição']);
    const csv = await core.sheetCsv(book, 0);
    assert.equal(csv.name, 'Recebimento.csv');
    assert.deepEqual(Array.from(new Uint8Array(await csv.arrayBuffer()).slice(0, 3)), [239, 187, 191]);
    assert.equal(await csv.text(), '"BR00123","","Olá, ""mundo"""\r\n"","",""\r\n"texto\nlinha","TRUE","2024-01-01"\r\n"3","","12345678901234567890"');
    assert.equal(await (await core.sheetCsv(book, 1)).text(), '"Segunda aba"');
  }
});

test('recusa arquivo inválido, corrompido, criptografado e XML perigoso', async () => {
  await assert.rejects(core.openZip(new ArrayBuffer(3)), /inválido/);
  const buffer = archive({ 'a.xml': '<a>texto</a>' }, false);
  buffer[35] ^= 1;
  const zip = await core.openZip(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
  await assert.rejects(zip.read('a.xml'), /corrompido/);
  const encrypted = archive({ 'a.xml': '<a/>' }, false);
  const dir = encrypted.readUInt32LE(encrypted.length - 6);
  encrypted.writeUInt16LE(1, dir + 8);
  const protectedZip = await core.openZip(encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.length));
  await assert.rejects(protectedZip.read('a.xml'), /protegido/);
  await assert.rejects(core.workbook(excel({ 'xl/workbook.xml': '<!DOCTYPE x [<!ENTITY e "oops">]><x/>' })), /estrutura/);
});

test('recusa fórmulas sem cache, strings inválidas, abas vazias e matrizes enormes', async () => {
  for (const [content, message] of [
    ['<c r="A1"><f>A2+1</f></c>', /resultado salvo/],
    ['<c r="A1" t="s"><v>99</v></c>', /texto inválido/],
    ['<c r="A1"/>', /vazia/],
    ['<c r="XFD1048576"><v>1</v></c>', /milhões/]
  ]) {
    const book = await core.workbook(excel({ 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row>' + content + '</row></sheetData></worksheet>' }));
    await assert.rejects(core.sheetCsv(book, 0), message);
  }
});

test('épocas de datas e nomes das opções em português e inglês', () => {
  assert.equal(core.dateValue(1, false, false), '1900-01-01');
  assert.equal(core.dateValue(0, true, false), '1904-01-01');
  assert.equal(core.dateValue(.5, false, true), '12:00:00');
  assert.equal(core.normalize(' Inserir nova(s) página(s)… '), 'inserir nova(s) pagina(s)');
  assert.equal(Object.keys(core.MODES).length, 4);
});

const source = fs.readFileSync(path.join(__dirname, 'importador-de-planilhas.js'), 'utf8');
function page(html = '') {
  const dom = new JSDOM(html, { url: 'https://docs.google.com/spreadsheets/d/test-sheet/edit', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  win.HTMLElement.prototype.getClientRects = function () {
    return this.closest('[hidden]') || win.getComputedStyle(this).display === 'none' ? [] : [{ width: 100, height: 30 }];
  };
  win.crypto.randomUUID = require('node:crypto').randomUUID;
  win.AbortController = global.AbortController;
  win.File = global.File;
  win.Blob = global.Blob;
  win.TextDecoder = global.TextDecoder;
  win.DecompressionStream = global.DecompressionStream;
  win.DataTransfer = class {
    constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
  };
  Object.defineProperty(win.HTMLInputElement.prototype, 'files', { configurable: true, get() { return this._files || []; }, set(value) { this._files = value; } });
  win.eval(source);
  return { dom, win, root: win.document.querySelector('[data-spx-importer]').shadowRoot };
}
function drop(win, files) {
  const event = new win.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files } });
  win.document.body.dispatchEvent(event);
  return event;
}
async function until(read) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (read()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for test UI');
}

test('arraste direto abre opções, valida tipos e não interfere em diálogo nativo', async () => {
  const { dom, win, root } = page();
  try {
    assert(root.querySelector('.panel').hidden);
    assert.equal(drop(win, [new File(['a,b\n1,2'], 'dados.csv')]).defaultPrevented, true);
    await until(() => !root.querySelector('.start').disabled);
    assert.equal(root.querySelector('.panel').hidden, false);
    assert.equal(root.querySelector('input:checked').value, 'insert');
    assert.match(root.querySelector('.file').textContent, /dados.csv/);
    drop(win, [new File(['x'], 'dados.exe')]);
    assert.match(root.querySelector('.status').textContent, /CSV ou XLSX/);
    assert(root.querySelector('.start').disabled);
    drop(win, [new File(['x'], 'a.csv'), new File(['x'], 'b.csv')]);
    assert.match(root.querySelector('.status').textContent, /apenas um/);
    win.document.body.insertAdjacentHTML('beforeend', '<div role="dialog">Upload do Google</div>');
    assert.equal(drop(win, [new File(['x'], 'native.csv')]).defaultPrevented, false);
  } finally { dom.window.close(); }
});

test('XLSX arrastado permite escolher aba, informa conversão e proteção de destino', async () => {
  const { dom, win, root } = page();
  try {
    drop(win, [excel()]);
    await until(() => !root.querySelector('.start').disabled);
    const radio = root.querySelector('input[value="current"]');
    radio.checked = true; radio.dispatchEvent(new win.Event('change'));
    assert.equal(root.querySelector('.sheet-field').hidden, false);
    assert.equal(root.querySelector('.sheet').options.length, 2);
    assert.match(root.querySelector('.note').textContent, /fórmulas.*não serão mantidas/);
    const replace = root.querySelector('input[value="replace"]');
    replace.checked = true; replace.dispatchEvent(new win.Event('change'));
    assert.match(root.querySelector('.note').textContent, /Todas as abas/);
  } finally { dom.window.close(); }
});

function nativePage(english = false, unsupported = false) {
  const p = page('<div id="docs-file-menu" role="menuitem">' + (english ? 'File' : 'Arquivo') + '</div>');
  const { win } = p;
  let confirmed = 0, file = null;
  win.document.getElementById('docs-file-menu').addEventListener('click', () => {
    const item = win.document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.textContent = english ? 'Import' : 'Importar';
    win.document.body.appendChild(item);
    item.addEventListener('click', () => {
      item.remove();
      const input = win.document.createElement('input');
      input.type = 'file'; input.accept = '.csv,.xlsx';
      win.document.body.appendChild(input);
      input.addEventListener('change', () => {
        file = input.files[0]; input.remove();
        const dialog = win.document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.innerHTML = '<select>' + (unsupported ? '<option>Unsupported destination</option>' : Object.entries(core.MODES).map(([key, value]) => '<option value="' + key + '">' + value.native[english ? value.native.length - 1 : 0] + '</option>').join('')) + '</select><button>' + (english ? 'Import data' : 'Importar dados') + '</button>';
        dialog.querySelector('button').addEventListener('click', () => confirmed++);
        win.document.body.appendChild(dialog);
      });
    });
  });
  return { ...p, confirmed: () => confirmed, file: () => file };
}

test('prepara os quatro destinos, encaminha arquivo e deixa confirmação final no Google', async () => {
  for (const english of [false, true]) for (const mode of Object.keys(core.MODES)) {
    const p = nativePage(english);
    try {
      drop(p.win, [new File(['id,valor\nBR01,2'], 'dados.csv')]);
      await until(() => !p.root.querySelector('.start').disabled);
      p.root.querySelector('input[value="' + mode + '"]').checked = true;
      p.root.querySelector('.start').click();
      await until(() => p.root.querySelector('.status').textContent.includes('Arquivo enviado'));
      assert.equal(p.win.document.querySelector('[role="dialog"] select').value, mode);
      assert.equal(p.file().name, 'dados.csv');
      assert.equal(p.confirmed(), 0);
    } finally { p.dom.window.close(); }
  }
});

test('Excel para aba atual envia somente CSV da aba escolhida', async () => {
  const p = nativePage();
  try {
    drop(p.win, [excel()]);
    await until(() => !p.root.querySelector('.start').disabled);
    p.root.querySelector('input[value="current"]').checked = true;
    p.root.querySelector('.sheet').value = '1';
    p.root.querySelector('.start').click();
    await until(() => p.root.querySelector('.status').textContent.includes('Arquivo enviado'));
    assert.equal(p.file().name, 'Expedição.csv');
    assert.equal(await p.file().text(), '"Segunda aba"');
    assert.equal(p.confirmed(), 0);
  } finally { p.dom.window.close(); }
});

test('destino desconhecido não confirma importação e mostra orientação', async () => {
  const p = nativePage(false, true);
  try {
    drop(p.win, [new File(['x'], 'dados.csv')]);
    await until(() => !p.root.querySelector('.start').disabled);
    p.root.querySelector('.start').click();
    await until(() => p.root.querySelector('.status').textContent.includes('Não foi possível selecionar'));
    assert.equal(p.confirmed(), 0);
    assert.equal(p.root.querySelector('.panel').hidden, false);
  } finally { p.dom.window.close(); }
});

test('falha ao selecionar destino preserva CSV preparado para importação manual', async () => {
  const p = nativePage(false, true);
  try {
    drop(p.win, [excel()]);
    await until(() => !p.root.querySelector('.start').disabled);
    p.root.querySelector('input[value="current"]').checked = true;
    p.root.querySelector('.start').click();
    await until(() => p.root.querySelector('.status').textContent.includes('Baixe o CSV preparado'));
    assert.equal(p.root.querySelector('.download').hidden, false);
    assert.equal(p.confirmed(), 0);
  } finally { p.dom.window.close(); }
});

test('catálogo e launcher liberam módulo apenas nos hosts declarados', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../catalog.json')));
  const module = catalog.modules.find(item => item.id === 'importador-de-planilhas');
  assert(module.enabled);
  assert.equal(module.userScripts[0].allFrames, true);
  assert.deepEqual(module.hostPermissions, ['https://docs.google.com/*', 'https://drive.google.com/*']);
  assert(!module.permissions.includes('cookies'));
  const vm = require('node:vm');
  const window = { dispatchEvent() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../launcher/spx-auth.js'), 'utf8'), { window, CustomEvent: class {}, localStorage: { removeItem() {} }, sessionStorage: { removeItem() {} } });
  assert.equal(window.HubAuth.access(module.id).allowed, true);
});
