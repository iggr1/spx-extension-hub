const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'loader-extension/manifest.json')));

function backend() {
  const calls = [];
  const event = { addListener() {} };
  const context = vm.createContext({ URL, URLSearchParams, console, importScripts() {}, chrome: {
    runtime: { getURL: file => 'chrome-extension://test/' + file, getManifest: () => manifest, onInstalled: event, onStartup: event, onMessage: event },
    action: { onClicked: event }, webRequest: { onBeforeSendHeaders: event },
    permissions: { contains: async () => true }
  }, __catalog: catalog, __network: async (module, payload) => {
    calls.push({ module: module.id, payload });
    return { ok: true, results: { account: { ok: true, data: { retcode: 0, data: { id: 72777 } } } } };
  } });
  const source = fs.readFileSync(path.join(root, 'loader-extension/background.js'), 'utf8');
  vm.runInContext(source.replace('refreshCatalog({ force: false }).catch(() => {});', ''), context);
  vm.runInContext('catalogMemory = validateCatalog(__catalog); networkFetchBatch = __network;', context);
  const read = (message, sender = { url: 'chrome-extension://test/loader.html' }) => context.handleBridgeRequest(message, sender);
  return { context, calls, read };
}

test('catálogo usa uma operação própria, limitada às três consultas GET da conta', async () => {
  const worker = backend();
  const catalogResponse = await worker.read({ moduleId: 'launcher', operation: 'catalog.get' });
  assert.equal(catalogResponse.catalog.minimumLoaderVersion, '1.2.3');
  const expected = { basic: 'basic_info', permissions: 'user_permission_info', station: 'station_list/?count=50&status_list=0' };
  for (const [resource, suffix] of Object.entries(expected)) {
    const response = await worker.read({ moduleId: 'launcher', operation: 'account.read', payload: { resource, method: 'DELETE', url: 'https://example.test/', body: { ignored: true } } });
    assert(response.ok);
    const call = worker.calls.at(-1);
    assert.equal(call.module, 'spx-dock-flow');
    assert.equal(call.payload.requests[0].url, 'https://spx.shopee.com.br/api/admin/basicserver/current_user/' + suffix);
    assert.equal(call.payload.requests[0].method, 'GET');
    assert.equal(call.payload.requests[0].body, undefined);
  }
  for (const resource of ['dock', '__proto__', 'constructor', 'https://example.test/']) {
    const response = await worker.read({ moduleId: 'launcher', operation: 'account.read', payload: { resource } });
    assert.equal(response.code, 'ACCOUNT_RESOURCE_NOT_ALLOWED');
  }
  assert.equal(worker.calls.length, 3);
  assert.equal((await worker.read({ moduleId: 'launcher', operation: 'network.fetchBatch' })).code, 'CAPABILITY_NOT_ALLOWED');
  assert.equal((await worker.read({ moduleId: 'launcher', operation: 'account.read', payload: { resource: 'basic' } }, { url: 'https://example.test/' })).code, 'UNAUTHORIZED');
  vm.runInContext('chrome.permissions.contains = async () => false', worker.context);
  assert.equal((await worker.read({ moduleId: 'launcher', operation: 'account.read', payload: { resource: 'basic' } })).code, 'PERMISSION_NOT_GRANTED');
});

test('ponte real do iframe encaminha account.read e mantém bloqueio à rede de outro módulo', async () => {
  const worker = backend();
  const replies = [];
  const contentWindow = { postMessage: message => replies.push(message) };
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, { addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {}, contentWindow });
    return elements.get(id);
  };
  const context = vm.createContext({ URL, URLSearchParams, console,
    location: { search: '' }, window: { addEventListener() {} }, document: { getElementById: getElement },
    chrome: { runtime: {
      get lastError() { return null; },
      sendMessage(message, callback) {
        if (message.type === 'LOADER_BOOTSTRAP') return callback({ ok: true, loader: { version: manifest.version }, catalog: { ...catalog, launcher: { url: 'https://hub.test/launcher/' } } });
        worker.read(message).then(callback);
      }
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'loader-extension/loader.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const send = async (moduleId, operation, payload) => {
    await context.handleFrameMessage({ source: contentWindow, origin: 'https://hub.test', data: { channel: 'spx-extension-loader', type: 'BRIDGE_REQUEST', requestId: 'test', moduleId, operation, payload } });
    return replies.at(-1).response;
  };
  assert((await send('launcher', 'account.read', { resource: 'basic' })).ok);
  assert.equal(worker.calls.length, 1);
  assert.equal((await send('spx-dock-flow', 'network.fetchBatch', {})).ok, false);
  assert.equal(worker.calls.length, 1);
  await context.handleFrameMessage({ source: {}, origin: 'https://hub.test', data: { channel: 'spx-extension-loader', type: 'BRIDGE_REQUEST', moduleId: 'launcher', operation: 'account.read', payload: { resource: 'basic' } } });
  assert.equal(worker.calls.length, 1);
});
