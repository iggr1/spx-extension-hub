const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const usage = require('../shared/hub-usage.js');
const basic = { retcode: 0, data: { id: 123, name: 'Nome de teste', email: 'test@shopee.com' } };
const permissions = { retcode: 0, data: { perm_list: [{ perm_alias: ['RESOLVE_EO', 'CANCEL_EO_REASON'] }] } };
const stations = { retcode: 0, data: { current_station_id: 5264, station_list: [{ station_id: 1, station_name: 'Outra estação' }, { station_id: 5264, station_name: 'HUB de teste' }] } };
const profile = { userId: '123', name: 'Nome de teste', email: 'test@shopee.com', login: 'test@shopee.com', role: 'Analista', hubId: '5264', hubName: 'HUB de teste' };
function store() { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; }

test('perfil depende das duas permissões; falha não vira operador', () => {
 assert.equal(usage.classify(basic, permissions), 'Analista');
 assert.equal(usage.classify(basic, { retcode: 0, data: { perm_list: [] } }), 'Operador');
 assert.equal(usage.classify({ ...basic, data: { ...basic.data, email: '[ops123]Teste' } }, permissions), 'Operador');
 assert.equal(usage.classify(basic, { retcode: 0, data: { perm_list: [{ perm_alias: ['RESOLVE_EO'] }] } }), 'Operador');
 assert.equal(usage.classify(basic, null), 'Não identificado');
 assert.equal(usage.classify({ ...basic, data: { ...basic.data, email: 'test@shopee.com.evil.test' } }, permissions), 'Operador');
});
test('HUB é current_station_id; troca de conta ou de estação cancela a leitura', async () => {
 const reader = async url => url === usage.URLS.basic ? basic : url === usage.URLS.station ? stations : permissions;
 assert.equal((await usage.readIdentity(reader)).hubName, 'HUB de teste');
 let basicCalls = 0;
 await assert.rejects(usage.readIdentity(async url => url === usage.URLS.basic ? (++basicCalls === 1 ? basic : { ...basic, data: { ...basic.data, id: 124 } }) : reader(url)), /mudou/);
 let stationCalls = 0;
 await assert.rejects(usage.readIdentity(async url => url === usage.URLS.station ? (++stationCalls === 1 ? stations : { retcode: 0, data: { current_station_id: 88 } }) : reader(url)), /mudou/);
 const absent = await usage.readIdentity(async url => url === usage.URLS.station ? { retcode: 0, data: { current_station_id: 99, station_list: stations.data.station_list } } : reader(url));
 assert.equal(absent.hubName, 'HUB 99');
});
test('data usa São Paulo e URL aceita apenas implantação exec', () => {
 assert.equal(usage.dayOf(new Date('2026-10-23T01:30:00Z')), '2026-10-22');
 assert(usage.endpointAllowed('https://script.google.com/macros/s/TestId/exec'));
 for (const url of ['https://script.google.com/macros/s/ID/dev', 'https://example.test/exec', 'javascript:alert(1)', 'https://script.google.com.evil.test/macros/s/ID/exec']) assert(!usage.endpointAllowed(url));
});
test('desativado não coleta identidade, não persiste conta nem envia POST', async () => {
 let identityCalls = 0; let posts = 0; const storage = store();
 const client = usage.createClient({ storage, getProfile: async () => { identityCalls++; return profile; }, fetch: async (_, options) => { if (options.method) posts++; return { ok: true, json: async () => ({ enabled: false, endpoint: '' }) }; } });
 assert.equal(await client.record('launcher', '1', 'catalog_open'), false);
 assert.equal(identityCalls, 0); assert.equal(posts, 0); assert.equal(storage.getItem('spxHubUsagePendingV1'), null);
});
test('falha mantém fila, reenvio é confirmado e só sai o snapshot aceito', async () => {
 const storage = store(); let clock = Date.parse('2026-10-23T12:00:00Z'); let fail = true; const sent = [];
 const client = usage.createClient({ storage, now: () => clock, getProfile: async () => ({ ...profile, cookie: 'NUNCA_ENVIAR', token: 'NUNCA_ENVIAR' }), fetch: async (_, options) => {
  if (!options.method) return { ok: true, json: async () => ({ enabled: true, endpoint: 'https://script.google.com/macros/s/TestId/exec' }) };
  sent.push({ options, body: JSON.parse(options.body) });
  if (fail) throw Error('offline');
  return { ok: true, json: async () => ({ ok: true, accepted: JSON.parse(options.body).events.map(event => event.key) }) };
 } });
 await client.record('launcher', '1', 'catalog_open'); await client.flush();
 assert.equal(JSON.parse(storage.getItem('spxHubUsagePendingV1')).length, 1);
 clock += 60000;
 await client.record('launcher', '2', 'catalog_active'); await client.flush();
 const queue = JSON.parse(storage.getItem('spxHubUsagePendingV1'));
 assert.equal(queue.length, 1); assert.deepEqual(queue[0].events, ['catalog_active', 'catalog_open']);
 assert.equal(queue[0].firstSeen, '2026-10-23T12:00:00.000Z'); assert.equal(queue[0].lastSeen, '2026-10-23T12:01:00.000Z');
 fail = false; clock += 60000; assert.equal(await client.flush(true), true);
 assert.equal(storage.getItem('spxHubUsagePendingV1'), null);
 assert(sent.every(entry => entry.options.credentials === 'omit' && entry.options.mode === 'cors' && !JSON.stringify(entry.body).includes('NUNCA_ENVIAR')));
});
test('geração dos agentes corresponde ao core e às versões do catálogo', () => {
 const root = path.resolve(__dirname, '..'); const core = fs.readFileSync(path.join(root, 'shared/hub-usage.js'), 'utf8');
 const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json')));
 for (const id of ['spx-dock-flow-autoadd', 'assistente-de-devolucoes']) {
  const module = catalog.modules.find(item => item.id === id);
  assert.equal(fs.readFileSync(path.join(root, 'shared/usage-agents', id + '.js'), 'utf8'), core + '\nSpxHubUsage.startSpxAgent(' + JSON.stringify(id) + ', ' + JSON.stringify(module.version) + ');\n');
 }
});
test('confirmação de lote antigo preserva uma atualização feita durante o envio', async () => {
 const storage = store(); let clock = Date.parse('2026-10-23T12:00:00Z'); let release; let requested;
 const started = new Promise(resolve => { requested = resolve; });
 const client = usage.createClient({ storage, now: () => clock, getProfile: async () => profile, fetch: async (_, options) => {
  if (!options.method) return { ok: true, json: async () => ({ enabled: true, endpoint: 'https://script.google.com/macros/s/TestId/exec' }) };
  const keys = JSON.parse(options.body).events.map(event => event.key);
  requested(); await new Promise(resolve => { release = resolve; });
  return { ok: true, json: async () => ({ ok: true, accepted: keys }) };
 } });
 await client.record('launcher', '1', 'catalog_open'); await started;
 clock += 60000;
 await client.record('launcher', '1', 'catalog_active');
 release(); await client.flush();
 const pending = JSON.parse(storage.getItem('spxHubUsagePendingV1'));
 assert.equal(pending.length, 1); assert(pending[0].events.includes('catalog_active'));
});
