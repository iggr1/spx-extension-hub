(function () {
  'use strict';

  const CHANNEL = 'spx-sheets-import-v1';
  const ORIGINS = ['https://docs.google.com', 'https://drive.google.com'];
  const MAX_FILE = 50 * 1024 * 1024;
  const MAX_XML = 64 * 1024 * 1024;
  const MODES = {
    new: { label: 'Criar nova planilha', native: ['Criar nova planilha', 'Create new spreadsheet'] },
    current: { label: 'Substituir aba atual', native: ['Substituir página atual', 'Substituir aba atual', 'Replace current sheet'] },
    insert: { label: 'Adicionar novas abas', native: ['Inserir nova(s) página(s)', 'Inserir novas páginas', 'Inserir novas abas', 'Insert new sheet(s)'] },
    replace: { label: 'Substituir tudo', native: ['Substituir planilha', 'Replace spreadsheet'] }
  };

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().replace(/[.…]+$/, '').trim().toLowerCase();
  }

  /* SAX_PARSER_BUNDLE */

  // Parse XML as data, without DOMParser/HTML sinks or a Trusted Types policy.
  function xml(text) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('O Excel contém uma estrutura não suportada.');
    const root = { children: [] };
    const stack = [root];
    const parser = sax.parser(true, { xmlns: true, strictEntities: true });
    parser.onopentag = tag => {
      if (stack.length > 256) throw new Error('XML do Excel muito profundo.');
      const node = {
        name: tag.local, children: [],
        getAttribute(name) { return tag.attributes[name]?.value ?? null; },
        getAttributeNS(uri, name) { return Object.values(tag.attributes).find(a => a.uri === uri && a.local === name)?.value ?? null; },
        get textContent() { return this.children.map(n => typeof n === 'string' ? n : n.textContent).join(''); }
      };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    };
    parser.onclosetag = () => stack.pop();
    parser.ontext = parser.oncdata = value => stack[stack.length - 1].children.push(value);
    parser.onerror = () => { throw new Error('Não foi possível ler as abas do Excel.'); };
    parser.write(text).close();
    return root;
  }

  function tags(node, name) {
    const result = [];
    function visit(parent) {
      for (const child of parent.children) {
        if (typeof child === 'string') continue;
        if (child.name === name) result.push(child);
        visit(child);
      }
    }
    visit(node);
    return result;
  }

  const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function openZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
    }
    if (end < 0) throw new Error('Arquivo Excel inválido ou protegido por senha.');
    const count = view.getUint16(end + 10, true);
    if (count > 20000 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw new Error('Este arquivo Excel não é suportado.');
    const entries = new Map();
    let offset = view.getUint32(end + 16, true);
    const directoryEnd = offset + view.getUint32(end + 12, true);
    if (directoryEnd > end) throw new Error('Arquivo Excel incompleto.');
    for (let i = 0; i < count; i++) {
      if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Arquivo Excel incompleto.');
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressed = view.getUint32(offset + 20, true);
      const size = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      if (next > directoryEnd) throw new Error('Arquivo Excel incompleto.');
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (entries.has(name)) throw new Error('Arquivo Excel com entradas duplicadas.');
      entries.set(name, { flags, method, compressed, size, crc: view.getUint32(offset + 16, true), local: view.getUint32(offset + 42, true) });
      offset = next;
    }
    async function read(name, required = true) {
      const entry = entries.get(name);
      if (!entry) { if (!required) return ''; throw new Error('Não foi possível localizar uma aba do Excel.'); }
      if (entry.flags & 1 || entry.size > MAX_XML || ![0, 8].includes(entry.method)) throw new Error('Excel protegido, muito grande ou com compressão não suportada.');
      const start = entry.local;
      if (start + 30 > bytes.length || view.getUint32(start, true) !== 0x04034b50) throw new Error('Arquivo Excel incompleto.');
      const dataStart = start + 30 + view.getUint16(start + 26, true) + view.getUint16(start + 28, true);
      if (dataStart + entry.compressed > view.getUint32(end + 16, true)) throw new Error('Arquivo Excel incompleto.');
      let data = bytes.subarray(dataStart, dataStart + entry.compressed);
      if (entry.method === 8) {
        let stream;
        try { stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
        catch (_) { throw new Error('Atualize o Chrome para ler este arquivo Excel.'); }
        const reader = stream.getReader();
        const chunks = [];
        let total = 0;
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          total += result.value.length;
          if (total > MAX_XML || total > entry.size) { await reader.cancel(); throw new Error('Arquivo Excel muito grande.'); }
          chunks.push(result.value);
        }
        data = new Uint8Array(total);
        let cursor = 0;
        for (const chunk of chunks) { data.set(chunk, cursor); cursor += chunk.length; }
      }
      if (data.length !== entry.size) throw new Error('Arquivo Excel incompleto.');
      if (crc32(data) !== entry.crc) throw new Error('Arquivo Excel corrompido.');
      return new TextDecoder().decode(data);
    }
    return { read };
  }

  async function workbook(file) {
    const zip = await openZip(await file.arrayBuffer());
    const book = xml(await zip.read('xl/workbook.xml'));
    const rels = xml(await zip.read('xl/_rels/workbook.xml.rels'));
    const paths = new Map(tags(rels, 'Relationship').filter(node => node.getAttribute('TargetMode') !== 'External').map(node => {
      const path = new URL(node.getAttribute('Target'), 'https://xlsx.invalid/xl/workbook.xml').pathname.slice(1);
      return [node.getAttribute('Id'), path];
    }));
    const sheets = tags(book, 'sheet').map(node => ({
      name: node.getAttribute('name'),
      path: paths.get(node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || node.getAttribute('r:id'))
    })).filter(sheet => /^xl\/worksheets\/[^/]+\.xml$/.test(sheet.path || ''));
    if (!sheets.length) throw new Error('O Excel não contém abas de dados disponíveis.');
    const properties = tags(book, 'workbookPr')[0];
    return { zip, sheets, date1904: ['1', 'true'].includes(properties?.getAttribute('date1904')) };
  }

  function csvCell(value) {
    return '"' + String(value ?? '').replace(/"/g, '""') + '"';
  }

  function fileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    const divisor = bytes < 1048576 ? 1024 : 1048576;
    return (bytes / divisor).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + (divisor === 1024 ? ' KB' : ' MB');
  }

  function dateValue(serial, date1904, timeOnly) {
    if (!Number.isFinite(serial)) return String(serial);
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, serial < 60 ? 31 : 30);
    const date = new Date(epoch + Math.round(serial * 86400000));
    if (!Number.isFinite(date.getTime())) throw new Error('O Excel contém uma data inválida.');
    const iso = date.toISOString();
    if (timeOnly) return iso.slice(11, 19);
    return Math.abs(serial - Math.round(serial)) < 1e-9 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }

  async function sheetCsv(book, index) {
    const sheet = book.sheets[index];
    if (!sheet) throw new Error('Selecione uma aba válida do Excel.');
    const stringsText = await book.zip.read('xl/sharedStrings.xml', false);
    const strings = stringsText ? tags(xml(stringsText), 'si').map(node => tags(node, 't').map(t => t.textContent).join('')) : [];
    const stylesText = await book.zip.read('xl/styles.xml', false);
    const formats = new Map();
    let styles = [];
    if (stylesText) {
      const styleDoc = xml(stylesText);
      for (const node of tags(styleDoc, 'numFmt')) formats.set(Number(node.getAttribute('numFmtId')), node.getAttribute('formatCode'));
      const xfs = tags(styleDoc, 'cellXfs')[0];
      if (xfs) styles = tags(xfs, 'xf').map(node => Number(node.getAttribute('numFmtId')));
    }
    const rows = new Map();
    let maxRow = -1;
    let maxColumn = -1;
    const doc = xml(await book.zip.read(sheet.path));
    for (const cell of tags(doc, 'c')) {
      const ref = /^([A-Z]{1,3})([1-9]\d*)$/.exec(cell.getAttribute('r') || '');
      if (!ref) throw new Error('O Excel contém uma referência de célula inválida.');
      let column = 0;
      for (const char of ref[1]) column = column * 26 + char.charCodeAt(0) - 64;
      column--;
      const row = Number(ref[2]) - 1;
      if (column >= 16384 || row >= 1048576) throw new Error('A aba excede o tamanho permitido.');
      const type = cell.getAttribute('t');
      let value = tags(cell, 'v')[0]?.textContent ?? '';
      if (tags(cell, 'f').length && value === '') throw new Error('Há fórmulas sem resultado salvo. Abra e salve o Excel antes de importar esta aba.');
      if (type === 's') {
        if (!/^\d+$/.test(value) || strings[Number(value)] === undefined) throw new Error('O Excel contém um texto inválido.');
        value = strings[Number(value)];
      } else if (type === 'inlineStr') value = tags(cell, 't').map(node => node.textContent).join('');
      else if (type === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
      else if (value !== '' && (!type || type === 'n')) {
        const formatId = styles[Number(cell.getAttribute('s') || 0)];
        const custom = (formats.get(formatId) || '').replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '').toLowerCase();
        const timeOnly = [18, 19, 20, 21, 45, 46, 47].includes(formatId) || (!!custom && /[hs]/.test(custom) && !/[dy]/.test(custom));
        if ([14, 15, 16, 17, 22].includes(formatId) || timeOnly || /[dy]/.test(custom)) value = dateValue(Number(value), book.date1904, timeOnly);
      }
      if (value === '') continue;
      maxRow = Math.max(maxRow, row);
      maxColumn = Math.max(maxColumn, column);
      if ((maxRow + 1) * (maxColumn + 1) > 2000000) throw new Error('Para substituir uma aba, selecione um Excel com até 2 milhões de células.');
      if (!rows.has(row)) rows.set(row, new Map());
      rows.get(row).set(column, value);
    }
    if (maxRow < 0) throw new Error('A aba selecionada está vazia.');
    const output = [];
    let length = 0;
    for (let row = 0; row <= maxRow; row++) {
      const line = Array.from({ length: maxColumn + 1 }, (_, column) => csvCell(rows.get(row)?.get(column))).join(',');
      length += line.length + 2;
      if (length > MAX_FILE) throw new Error('A aba é muito grande para esta conversão.');
      output.push(line);
    }
    return new File(['\ufeff', output.join('\r\n')], sheet.name.replace(/[\\/:*?"<>|]/g, '-') + '.csv', { type: 'text/csv;charset=utf-8' });
  }

  const core = { normalize, openZip, workbook, csvCell, dateValue, sheetCsv, MODES, crc32 };
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }
  if (!ORIGINS.includes(location.origin) || window.__spxSheetsImporter) return;
  window.__spxSheetsImporter = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function visible(node) {
    return Boolean(node && node.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[data-spx-importer]'));
  }
  function enabled(node) {
    return node && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && !/goog-[\w-]*disabled/.test(node.className || '');
  }
  function label(node) { return node.querySelector('.goog-menu-button-caption')?.textContent || node.getAttribute('aria-label') || node.textContent; }
  function find(labels, root = document, selector = '[role="button"],button,[role="menuitem"],[role="option"],[role="tab"],.goog-menuitem,.goog-menu-button') {
    const targets = labels.map(normalize);
    return Array.from(root.querySelectorAll(selector)).find(node => visible(node) && enabled(node) && targets.includes(normalize(label(node))));
  }
  function click(node) {
    if (!visible(node) || !enabled(node)) throw new Error('O Google Sheets não disponibilizou esta opção.');
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    node.click();
  }
  async function waitFor(read, signal, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error('Importação cancelada.');
      const value = read();
      if (value) return value;
      await sleep(150);
    }
    throw new Error('O Google não respondeu a tempo. Você pode continuar pela janela de importação do Google.');
  }

  function uploadInput() {
    return Array.from(document.querySelectorAll('input[type="file"]')).find(node => !node.closest('[data-spx-importer]') && !node.disabled && (!node.accept || /csv|xlsx|spreadsheet|excel|\*/i.test(node.accept)));
  }

  if (window !== window.top) {
    let currentToken = '';
    let usedToken = '';
    const observer = new MutationObserver(() => announce());
    function announce() {
      if (currentToken && uploadInput()) window.top.postMessage({ channel: CHANNEL, type: 'ready', token: currentToken }, 'https://docs.google.com');
    }
    window.addEventListener('message', event => {
      if (event.source !== window.top || event.origin !== 'https://docs.google.com' || event.data?.channel !== CHANNEL) return;
      const message = event.data;
      if (message.type === 'probe') {
        currentToken = message.token;
        const tab = find(['Upload', 'Fazer upload', 'Carregar', 'Enviar']);
        if (tab) click(tab);
        announce();
      } else if (message.type === 'file' && message.token === currentToken && usedToken !== currentToken && message.file instanceof Blob) {
        const input = uploadInput();
        if (!input) return;
        try {
          const transfer = new DataTransfer();
          transfer.items.add(new File([message.file], message.name, { type: message.file.type }));
          input.files = transfer.files;
          usedToken = currentToken;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          window.top.postMessage({ channel: CHANNEL, type: 'uploaded', token: currentToken }, 'https://docs.google.com');
        } catch (_) {
          window.top.postMessage({ channel: CHANNEL, type: 'upload-error', token: currentToken }, 'https://docs.google.com');
        }
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });
    return;
  }
  if (location.origin !== 'https://docs.google.com' || !/^\/spreadsheets\/d\/[^/]+\/edit/.test(location.pathname)) return;

  let selectedFile = null;
  let selectedBook = null;
  let preparedFile = null;
  let reading = 0;
  let job = null;
  let uploaded = false;
  let frameRecipient = null;
  const host = document.createElement('div');
  host.dataset.spxImporter = '';
  const shadow = host.attachShadow({ mode: 'open' });
  // Use DOM construction: Sheets enforces Trusted Types in the MAIN world.
  function el(tag, attrs, children, namespace) {
    const node = document.createElementNS(namespace, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }
  shadow.append(
    el("style", {}, ["\n    :host{all:initial;position:fixed;right:20px;bottom:28px;z-index:2147483000;font-family:Arial,sans-serif;color:#172b24;font-size:14px}\n    *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.55;cursor:default}[hidden]{display:none!important}\n    .fab{display:flex;align-items:center;gap:9px;padding:12px 18px;border:0;border-radius:28px;background:#137333;color:#fff;font-weight:700;box-shadow:0 4px 18px #0003}.fab svg{width:20px;height:20px}\n    .panel{position:absolute;right:0;bottom:58px;width:390px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);overflow:auto;background:#fff;border:1px solid #dce5df;border-radius:16px;box-shadow:0 10px 42px #0003;padding:20px}\n    .drag-screen{position:fixed;inset:12px;display:grid;place-items:center;border:3px dashed #137333;border-radius:20px;background:#e6f4eadb;pointer-events:none}.drag-screen div{padding:28px 36px;background:white;border-radius:16px;box-shadow:0 8px 30px #0002;text-align:center}.drag-screen strong{display:block;font-size:24px;color:#137333}.drag-screen span{display:block;margin-top:10px;color:#536b5b;font-size:14px}\n    header{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:19px;margin:0}.close{border:0;background:none;font-size:24px;color:#64736b;padding:0 4px}\n    p{line-height:1.5;margin:8px 0 16px;color:#637169;font-size:13px}.drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;text-align:center;padding:22px 12px;border:2px dashed #b7cdbd;border-radius:12px;background:#f5faf6;width:100%;color:#17492b}.drop.over{border-color:#137333;background:#e5f3e8}.drop span{font-size:12px;color:#637169}\n    .file{margin:12px 0;overflow-wrap:anywhere;font-size:13px}.options{border:0;padding:0;margin:18px 0 12px}.options legend,.sheet-label{font-weight:700;font-size:13px;margin-bottom:8px}.option{display:flex;gap:10px;padding:10px 8px;border:1px solid transparent;border-radius:8px;cursor:pointer}.option:has(input:checked){background:#edf6ef;border-color:#b7d9c0}.option input{accent-color:#137333;margin:2px 0 0}.option strong{display:block;font-size:13px}.option small{display:block;margin-top:3px;color:#637169;font-size:12px;line-height:1.4}\n    select{width:100%;padding:9px;border:1px solid #c7d6cb;border-radius:7px;margin-top:7px;background:white}.note{padding:10px;background:#fff8e5;border-radius:8px;color:#725716;font-size:12px;line-height:1.5;margin:10px 0}.status{font-size:12px;line-height:1.5;white-space:pre-line;margin:12px 0}.status.error{color:#b3261e}.status.ok{color:#137333}.footer{display:flex;gap:8px;margin-top:15px}.primary,.secondary{border:0;border-radius:8px;padding:11px 14px;font-weight:700}.primary{background:#137333;color:white;flex:1}.secondary{background:#edf1ee;color:#33473a}.progress{width:100%;height:4px;accent-color:#137333;margin-top:10px}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #1a73e8;outline-offset:3px}\n    @media(max-width:500px){:host{right:12px;bottom:18px}.panel{padding:16px}}\n  "], "http://www.w3.org/1999/xhtml"),
    "\n  ",
    el("section", {"class":"panel","hidden":"","role":"dialog","aria-labelledby":"import-title"}, [el("header", {}, [el("h2", {"id":"import-title"}, ["Importar arquivo"], "http://www.w3.org/1999/xhtml"),el("button", {"class":"close","aria-label":"Fechar"}, ["×"], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml"),"\n  ",el("p", {}, ["Traga seus dados para o Google Sheets em poucos passos."], "http://www.w3.org/1999/xhtml"),"\n  ",el("button", {"class":"drop","type":"button"}, [el("strong", {}, ["Arraste o arquivo aqui"], "http://www.w3.org/1999/xhtml"),el("span", {}, ["ou clique para selecionar · CSV ou Excel · até 50 MB"], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml"),"\n  ",el("input", {"type":"file","accept":".csv,.xlsx","hidden":""}, [], "http://www.w3.org/1999/xhtml"),el("div", {"class":"file","hidden":""}, [], "http://www.w3.org/1999/xhtml"),"\n  ",el("fieldset", {"class":"options"}, [el("legend", {}, ["Onde importar?"], "http://www.w3.org/1999/xhtml"),"\n    ",el("label", {"class":"option"}, [el("input", {"type":"radio","name":"mode","value":"new"}, [], "http://www.w3.org/1999/xhtml"),el("span", {}, [el("strong", {}, ["Criar nova planilha"], "http://www.w3.org/1999/xhtml"),el("small", {}, ["Abre outro documento com os dados do arquivo."], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml"),"\n    ",el("label", {"class":"option"}, [el("input", {"type":"radio","name":"mode","value":"current"}, [], "http://www.w3.org/1999/xhtml"),el("span", {}, [el("strong", {}, ["Substituir aba atual"], "http://www.w3.org/1999/xhtml"),el("small", {}, ["Substitui os dados apenas da aba que está aberta."], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml"),"\n    ",el("label", {"class":"option"}, [el("input", {"type":"radio","name":"mode","value":"insert","checked":""}, [], "http://www.w3.org/1999/xhtml"),el("span", {}, [el("strong", {}, ["Adicionar novas abas"], "http://www.w3.org/1999/xhtml"),el("small", {}, ["Mantém as abas existentes e adiciona as do arquivo."], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml"),"\n    ",el("label", {"class":"option"}, [el("input", {"type":"radio","name":"mode","value":"replace"}, [], "http://www.w3.org/1999/xhtml"),el("span", {}, [el("strong", {}, ["Substituir tudo"], "http://www.w3.org/1999/xhtml"),el("small", {}, ["Substitui todas as abas desta planilha."], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml"),"\n  "], "http://www.w3.org/1999/xhtml"),"\n  ",el("div", {"class":"sheet-field","hidden":""}, [el("label", {"class":"sheet-label"}, ["Qual aba do Excel?",el("select", {"class":"sheet"}, [], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml"),"\n  ",el("div", {"class":"note","hidden":""}, [], "http://www.w3.org/1999/xhtml"),el("div", {"class":"status","role":"status","aria-live":"polite"}, [], "http://www.w3.org/1999/xhtml"),el("progress", {"class":"progress","hidden":"","aria-label":"Preparando importação"}, [], "http://www.w3.org/1999/xhtml"),"\n  ",el("button", {"class":"secondary download","type":"button","hidden":""}, ["Baixar CSV preparado"], "http://www.w3.org/1999/xhtml"),"\n  ",el("div", {"class":"footer"}, [el("button", {"class":"secondary cancel","type":"button"}, ["Cancelar"], "http://www.w3.org/1999/xhtml"),el("button", {"class":"primary start","type":"button","disabled":""}, ["Continuar"], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml"),"\n  "], "http://www.w3.org/1999/xhtml"),
    el("button", {"class":"fab","type":"button","aria-expanded":"false"}, [el("svg", {"viewBox":"0 0 24 24","fill":"none","stroke":"currentColor","stroke-width":"2","aria-hidden":"true"}, [el("path", {"d":"M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"}, [], "http://www.w3.org/2000/svg")], "http://www.w3.org/2000/svg"),"Importar"], "http://www.w3.org/1999/xhtml"),
    "\n  ",
    el("div", {"class":"drag-screen","hidden":""}, [el("div", {}, [el("strong", {}, ["Solte para importar"], "http://www.w3.org/1999/xhtml"),el("span", {}, ["CSV ou Excel · escolha o destino em seguida"], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml")], "http://www.w3.org/1999/xhtml")
  );
  document.documentElement.appendChild(host);
  const $ = selector => shadow.querySelector(selector);
  function mode() { return $('input[name="mode"]:checked').value; }
  function status(text, error = false) { $('.status').textContent = text; $('.status').className = 'status' + (error ? ' error' : ''); }
  function panel(open) { $('.panel').hidden = !open; $('.fab').setAttribute('aria-expanded', String(open)); if (open) $('.close').focus(); }
  function update() {
    const convert = mode() === 'current' && !!selectedBook;
    $('.sheet-field').hidden = !convert;
    const messages = [];
    if (convert) messages.push('Serão importados os valores da aba escolhida. Formatação, imagens e fórmulas do Excel não serão mantidas; datas serão convertidas para um formato padrão.');
    if (mode() === 'current') messages.push('Os dados da aba atual serão substituídos.');
    if (mode() === 'replace') messages.push('Todas as abas desta planilha serão substituídas.');
    $('.note').textContent = messages.join(' ');
    $('.note').hidden = !messages.length;
    $('.start').disabled = !selectedFile || !!job || $('.progress').hidden === false;
  }
  function busy(value) {
    $('.progress').hidden = !value;
    for (const node of shadow.querySelectorAll('input,select,.drop')) node.disabled = value;
    $('.close').disabled = value;
    $('.start').disabled = value || !selectedFile;
  }
  async function selectFiles(files) {
    if (job) return;
    const generation = ++reading;
    selectedFile = null;
    selectedBook = null;
    preparedFile = null;
    $('.download').hidden = true;
    $('.file').hidden = true;
    $('.sheet').replaceChildren();
    status('');
    if (files.length !== 1) { status('Selecione apenas um arquivo por importação.', true); update(); return; }
    const file = files[0];
    if (!/\.(csv|xlsx)$/i.test(file.name)) { status('Selecione um arquivo CSV ou XLSX.', true); update(); return; }
    if (!file.size || file.size > MAX_FILE) { status('O arquivo deve ter conteúdo e até 50 MB.', true); update(); return; }
    busy(true);
    try {
      let book = null;
      if (/\.xlsx$/i.test(file.name)) { status('Lendo as abas do Excel…'); book = await workbook(file); }
      if (generation !== reading) return;
      selectedFile = file;
      selectedBook = book;
      if (book) book.sheets.forEach((sheet, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = sheet.name; $('.sheet').appendChild(option); });
      $('.file').textContent = file.name + ' · ' + fileSize(file.size) + (book ? ' · ' + book.sheets.length + ' aba(s)' : '');
      $('.file').hidden = false;
      status('Escolha o destino e clique em Continuar.');
    } catch (error) { if (generation === reading) status(error.message || 'Não foi possível ler o arquivo.', true); }
    finally { if (generation === reading) { busy(false); update(); } }
  }

  function frames(root = window, result = [], depth = 0) {
    if (depth > 5) return result;
    try { for (let i = 0; i < root.frames.length; i++) { result.push(root.frames[i]); frames(root.frames[i], result, depth + 1); } } catch (_) {}
    return result;
  }
  window.addEventListener('message', event => {
    if (!job || !ORIGINS.includes(event.origin) || event.data?.channel !== CHANNEL || event.data.token !== job.token || !frames().includes(event.source)) return;
    if (event.data.type === 'ready' && !frameRecipient) {
      frameRecipient = event.source;
      event.source.postMessage({ channel: CHANNEL, type: 'file', token: job.token, file: job.file, name: job.file.name }, event.origin);
    } else if (event.data.type === 'uploaded' && event.source === frameRecipient) uploaded = true;
    else if (event.data.type === 'upload-error' && event.source === frameRecipient) status('Selecione o arquivo na janela do Google para continuar.', true);
  });

  async function openNative(signal) {
    const fileMenu = document.getElementById('docs-file-menu') || find(['Arquivo', 'File'], document, '[role="menuitem"],.menu-button');
    if (!fileMenu) throw new Error('Não foi possível abrir o menu Arquivo. Verifique se você tem permissão para editar a planilha.');
    click(fileMenu);
    const importItem = await waitFor(() => find(['Importar', 'Import', 'Importar…', 'Import…']), signal);
    click(importItem);
  }

  function importDialog() {
    return Array.from(document.querySelectorAll('[role="dialog"],.modal-dialog')).find(node => visible(node) && find(['Importar dados', 'Import data'], node));
  }

  async function sendFile(signal) {
    await waitFor(() => {
      const tab = find(['Upload', 'Fazer upload', 'Carregar', 'Enviar']);
      if (tab) click(tab);
      const input = uploadInput();
      if (input && !uploaded && !frameRecipient) {
        const transfer = new DataTransfer();
        transfer.items.add(job.file);
        input.files = transfer.files;
        uploaded = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (!uploaded && !frameRecipient) {
        for (const frame of frames()) for (const origin of ORIGINS) frame.postMessage({ channel: CHANNEL, type: 'probe', token: job.token }, origin);
      }
      return uploaded || importDialog();
    }, signal, 25000);
  }

  async function chooseDestination(dialog, target, signal) {
    const nativeSelects = Array.from(dialog.querySelectorAll('select')).filter(visible);
    for (const select of nativeSelects) {
      const option = Array.from(select.options).find(option => target.native.map(normalize).includes(normalize(option.textContent)) && !option.disabled);
      if (option) { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); return; }
    }
    let dropdown = Array.from(dialog.querySelectorAll('[role="listbox"],[role="combobox"],.goog-menu-button')).find(node => visible(node) && Object.values(MODES).some(item => item.native.map(normalize).includes(normalize(label(node)))));
    if (!dropdown) {
      const locationLabel = Array.from(dialog.querySelectorAll('label,[id]')).find(node => visible(node) && ['local de importacao', 'import location'].includes(normalize(node.textContent)));
      if (locationLabel) dropdown = document.getElementById(locationLabel.getAttribute('for')) || dialog.querySelector('[aria-labelledby="' + CSS.escape(locationLabel.id) + '"]');
    }
    if (!dropdown) throw new Error('Não foi possível selecionar o destino automaticamente. Escolha “' + target.label + '” na janela do Google.');
    click(dropdown);
    const option = await waitFor(() => find(target.native), signal, 4000);
    click(option);
    await waitFor(() => target.native.map(normalize).includes(normalize(label(dropdown))), signal, 4000);
  }

  async function start() {
    if (job || !selectedFile) return;
    const target = MODES[mode()];
    const sourceFile = selectedFile;
    const sourceBook = selectedBook;
    const sourceSheet = Number($('.sheet').value);
    const controller = new AbortController();
    job = { token: crypto.randomUUID(), controller, file: sourceFile };
    uploaded = false;
    frameRecipient = null;
    busy(true);
    try {
      $('.download').hidden = true;
      preparedFile = null;
      if (target === MODES.current && sourceBook) { status('Preparando os valores da aba selecionada…'); job.file = await sheetCsv(sourceBook, sourceSheet); preparedFile = job.file; }
      if (controller.signal.aborted) throw new Error('Importação cancelada.');
      status('Abrindo a importação do Google…');
      panel(false);
      await openNative(controller.signal);
      await sendFile(controller.signal);
      const dialog = await waitFor(importDialog, controller.signal, 90000);
      await chooseDestination(dialog, target, controller.signal);
      status('Arquivo enviado e destino selecionado. Confira as opções e clique em “Importar dados” na janela do Google.');
      $('.status').classList.add('ok');
    } catch (error) {
      status(error.message || 'Não foi possível preparar a importação. Continue na janela do Google.', true);
      if (preparedFile) {
        $('.download').hidden = false;
        status($('.status').textContent + '\nBaixe o CSV preparado para selecionar esse arquivo na janela do Google e substituir somente a aba atual.', true);
      }
      panel(true);
    } finally { job = null; uploaded = false; frameRecipient = null; busy(false); update(); }
  }

  $('.fab').addEventListener('click', () => panel($('.panel').hidden));
  $('.close').addEventListener('click', () => panel(false));
  $('.cancel').addEventListener('click', () => { if (job) { job.controller.abort(); status('Preparação cancelada. Feche a janela do Google se ela estiver aberta.'); } else { reading++; busy(false); panel(false); } });
  $('.drop').addEventListener('click', () => $('input[type="file"]').click());
  $('input[type="file"]').addEventListener('change', event => { void selectFiles(Array.from(event.target.files)); event.target.value = ''; });
  for (const type of ['dragenter', 'dragover']) $('.drop').addEventListener(type, event => { event.preventDefault(); if (!job) $('.drop').classList.add('over'); });
  $('.drop').addEventListener('dragleave', () => $('.drop').classList.remove('over'));
  $('.drop').addEventListener('drop', event => { event.preventDefault(); $('.drop').classList.remove('over'); if (!job) void selectFiles(Array.from(event.dataTransfer.files)); });
  for (const radio of shadow.querySelectorAll('input[name="mode"]')) radio.addEventListener('change', update);
  $('.start').addEventListener('click', () => void start());
  $('.download').addEventListener('click', () => {
    if (!preparedFile) return;
    const url = URL.createObjectURL(preparedFile);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = preparedFile.name;
    shadow.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  shadow.addEventListener('keydown', event => { if (event.key === 'Escape' && !job) panel(false); });
  let dragTimer = null;
  function externalFileDrag(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files') && !event.composedPath().includes(host)
      && !Array.from(document.querySelectorAll('[role="dialog"],.modal-dialog,.picker-dialog')).some(visible);
  }
  function hideDrag() { clearTimeout(dragTimer); $('.drag-screen').hidden = true; }
  for (const type of ['dragenter', 'dragover']) window.addEventListener(type, event => {
    if (!externalFileDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.dataTransfer.dropEffect = job ? 'none' : 'copy';
    if (!job) $('.drag-screen').hidden = false;
    clearTimeout(dragTimer);
    dragTimer = setTimeout(hideDrag, 1200);
  }, true);
  window.addEventListener('dragleave', event => { if (!event.relatedTarget && (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight)) hideDrag(); }, true);
  window.addEventListener('drop', event => {
    hideDrag();
    if (!externalFileDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (job) return;
    panel(true);
    void selectFiles(Array.from(event.dataTransfer.files));
  }, true);
  window.addEventListener('dragend', hideDrag, true);
  window.addEventListener('blur', hideDrag);
})();
