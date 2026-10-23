const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/Coleta_Hubs_SPX.gs', 'utf8');
function receiver() {
 const sheets = { Acessos: [['Chave', 'Data', 'ID HUB', 'HUB', 'ID usuário', 'Nome', 'E-mail', 'Login', 'Perfil de acesso', 'Ferramenta', 'Versão', 'Primeiro acesso', 'Último acesso', 'Eventos', 'Recebido em']], Hubs: [['ID HUB', 'HUB', 'Primeiro acesso', 'Último acesso', 'Ferramentas']] };
 let held = false; let flushes = 0;
 const sheet = name => ({
  getLastRow: () => sheets[name].length, getMaxRows: () => 1000,
  getRange(row, col, height, width) { return { getValues: () => sheets[name].slice(row - 1, row - 1 + height).map(value => value.slice(col - 1, col - 1 + width)), setValues(values) { values.forEach((value, index) => { sheets[name][row - 1 + index] = value; }); } }; }
 });
 const context = vm.createContext({ Date, Map, Set, Number, String, Array, Object, JSON, Math, Error,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test' }) },
  LockService: { getScriptLock: () => ({ tryLock: () => { held = true; return true; }, hasLock: () => held, releaseLock: () => { held = false; } }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: sheet }), flush: () => { flushes++; } },
  Utilities: { formatDate: date => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const get = name => p.find(i => i.type === name).value; return get('year') + '-' + get('month') + '-' + get('day'); } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: value => ({ value, setMimeType() { return this; } }) }
 });
 vm.runInContext(source, context);
 return { sheets, send: events => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ schemaVersion: 1, events }) } }).value), get: () => JSON.parse(context.doGet().value), held: () => held, flushes: () => flushes };
}
function event(moduleId = 'launcher') {
 const now = new Date(); const iso = now.toISOString();
 const day = require('../shared/hub-usage.js').dayOf(now);
 return { key: [day, '5264', '123', moduleId].join('|'), day, hubId: '5264', hubName: 'HUB Teste', userId: '123', name: 'Teste', email: 'test@shopee.com', login: 'test@shopee.com', role: 'Analista', moduleId, version: '1', firstSeen: iso, lastSeen: iso, events: ['catalog_open'] };
}
test('reenvio e lote com chaves repetidas geram uma linha; resumo reúne módulos', () => {
 const r = receiver(); const value = event();
 assert(r.send([value, value]).ok); assert(r.send([value]).ok);
 assert.equal(r.sheets.Acessos.length, 2); assert.equal(r.sheets.Hubs.length, 2);
 const module = event('spx-dock-flow'); module.events = ['module_active'];
 assert(r.send([module]).ok); assert.equal(r.sheets.Acessos.length, 3); assert.equal(r.sheets.Hubs.length, 2);
 assert.equal(r.sheets.Hubs[1][4], 'launcher, spx-dock-flow'); assert.equal(r.held(), false); assert(r.flushes() > 0);
});
test('lote inválido não grava parcialmente; strings de fórmula são neutralizadas', () => {
 const r = receiver(); const good = event(); const invalid = { ...event(), hubId: '0' };
 assert.equal(r.send([good, invalid]).ok, false); assert.equal(r.sheets.Acessos.length, 1);
 const formula = { ...good, name: '=IMPORTXML("https://invalid.test","//x")', hubName: '@teste' };
 assert(r.send([formula]).ok); assert(r.sheets.Acessos[1][5].startsWith("'=")); assert(r.sheets.Hubs[1][1].startsWith("'@"));
 const health = r.get(); assert.equal(health.ok, true); assert(!JSON.stringify(health).includes('test@shopee.com'));
});
test('fora da retenção e chave divergente são recusados', () => {
 const r = receiver(); const old = { ...event(), firstSeen: new Date(Date.now() - 8 * 86400000).toISOString() };
 assert.equal(r.send([old]).ok, false); assert.equal(r.send([{ ...event(), key: 'forged' }]).ok, false);
 assert.equal(r.sheets.Acessos.length, 1);
});
