const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const elements = new Map();
const element = () => ({ classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, disabled: false, inert: false });
const document = { hidden: false, querySelector: id => document.getElementById(id), getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, addEventListener() {} };
let allowed = true;
let calls = [];
let release;
const ready = new Promise(resolve => { release = resolve; });
const window = { addEventListener() {}, dispatchEvent() {} };
const context = vm.createContext({ document, window, CustomEvent: class {}, localStorage: { removeItem() {} }, sessionStorage: { removeItem() {} }, setInterval() {}, Date, console,
  LoaderBridge: { requestForModule: async (id, operation, payload) => {
    calls.push({ id, operation }); await ready;
    assert.equal(id, 'spx-dock-flow');
    assert.equal(operation, 'network.fetchBatch');
    const basic = payload.requests[0].url.endsWith('basic_info');
    return { ok: true, results: { identity: { ok: true, data: { retcode: 0, data: basic ? { id: 123, email: allowed ? 'person@shopee.com' : '[Ops123]Operator' } : { perm_list: [{ perm_alias: ['RESOLVE_EO', 'CANCEL_EO_REASON'] }] } } } } };
  } }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../shared/spx-access.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'spx-auth.js'), 'utf8'), context);
(async () => {
  assert.equal(window.HubAuth.access('spx-dock-flow').allowed, true);
  assert.equal(window.HubAuth.access('assistente-de-devolucoes').loading, true);
  assert.equal(document.querySelector('.auth-bar').inert, true);
  release(); await window.HubAuth.refresh();
  assert.equal(window.HubAuth.access('assistente-de-devolucoes').allowed, true);
  assert.equal(document.querySelector('.auth-bar').inert, false);
  allowed = false; await window.HubAuth.refresh();
  assert.equal(window.HubAuth.access('assistente-de-devolucoes').allowed, false);
  assert.equal(window.HubAuth.access('spx-dock-flow').allowed, true);
  assert(calls.every(call => call.id === 'spx-dock-flow' && call.operation === 'network.fetchBatch'), 'Authentication must use the public SPX network profile without changing user scripts');
  console.log('Catalog checks passed: public profile auth, pending access, allowed account, OPS denied, Dock Flow public, no registration changes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
