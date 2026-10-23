const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/iggr1/spx-extension-hub/main/catalog.json';
const CATALOG_URL_KEY = 'loaderCatalogUrl';
const CATALOG_CACHE_KEY = 'loaderCatalogCacheV1';
const CATALOG_CACHE_AT_KEY = 'loaderCatalogCacheAtV1';
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const SUPPORT_EMAIL = 'igor.camara@shopee.com';
const LOADER_PAGE = 'loader.html';

let catalogPromise = null;
let catalogMemory = null;
let captureProfiles = [];
let userScriptsRefreshSignature = '';
let userScriptsRefreshPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get([CATALOG_URL_KEY]);
  if (!stored[CATALOG_URL_KEY]) {
    await chrome.storage.local.set({ [CATALOG_URL_KEY]: DEFAULT_CATALOG_URL });
  }
  await refreshCatalog({ force: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  refreshCatalog({ force: false }).catch(() => {});
});

chrome.action.onClicked.addListener(async () => {
  const loaderUrl = chrome.runtime.getURL(LOADER_PAGE);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.id && String(tab.url || '').startsWith(loaderUrl));

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url: loaderUrl });
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    if (!captureProfiles.length) return;

    for (const profile of captureProfiles) {
      if (!matchesAnyPattern(details.url, profile.captureUrlPatterns)) continue;

      const wanted = new Set(profile.captureHeaders.map(name => String(name).toLowerCase()));
      const captured = {};

      for (const header of details.requestHeaders || []) {
        const name = String(header.name || '').toLowerCase();
        if (wanted.has(name) && header.value) captured[name] = header.value;
      }

      if (!Object.keys(captured).length) continue;
      const headersKey = authHeadersStorageKey(profile.moduleId, profile.id);
      const capturedAtKey = authCapturedAtStorageKey(profile.moduleId, profile.id);

      chrome.storage.session.get([headersKey]).then(current => chrome.storage.session.set({
        [headersKey]: {
          ...(current[headersKey] || {}),
          ...captured
        },
        [capturedAtKey]: Date.now()
      })).catch(() => {});
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

  if (message.type === 'LOADER_BOOTSTRAP') {
    getBootstrap(message.forceRefresh === true)
      .then(sendResponse)
      .catch(error => sendResponse(failure('BOOTSTRAP_ERROR', normalizeError(error))));
    return true;
  }

  if (message.type === 'LOADER_SET_CATALOG_URL') {
    setCatalogUrl(message.url)
      .then(sendResponse)
      .catch(error => sendResponse(failure('CATALOG_URL_ERROR', normalizeError(error))));
    return true;
  }

  if (message.type === 'LOADER_GET_CATALOG_URL') {
    getCatalogUrl()
      .then(url => sendResponse({ ok: true, url }))
      .catch(error => sendResponse(failure('CATALOG_URL_ERROR', normalizeError(error))));
    return true;
  }

  if (message.type === 'LOADER_MODULE_REQUIREMENTS') {
    getModuleRequirements(message.moduleId)
      .then(sendResponse)
      .catch(error => sendResponse(failure('MODULE_REQUIREMENTS_ERROR', normalizeError(error))));
    return true;
  }

  if (message.type === 'LOADER_BRIDGE_REQUEST') {
    handleBridgeRequest(message, sender)
      .then(sendResponse)
      .catch(error => sendResponse(failure('BRIDGE_ERROR', normalizeError(error))));
    return true;
  }

  return false;
});

async function getBootstrap(forceRefresh) {
  const catalog = await refreshCatalog({ force: forceRefresh });
  return {
    ok: true,
    loader: {
      version: chrome.runtime.getManifest().version,
      supportEmail: SUPPORT_EMAIL,
      catalogUrl: await getCatalogUrl()
    },
    catalog
  };
}

async function setCatalogUrl(value) {
  const url = normalizeHttpsUrl(value);
  await chrome.storage.local.set({ [CATALOG_URL_KEY]: url });
  catalogPromise = null;
  catalogMemory = null;
  const catalog = await refreshCatalog({ force: true });
  return { ok: true, url, catalog };
}

async function getCatalogUrl() {
  const stored = await chrome.storage.local.get([CATALOG_URL_KEY]);
  return normalizeHttpsUrl(stored[CATALOG_URL_KEY] || DEFAULT_CATALOG_URL);
}

async function refreshCatalog({ force }) {
  if (catalogPromise && !force) return catalogPromise;

  catalogPromise = (async () => {
    const stored = await chrome.storage.local.get([CATALOG_CACHE_KEY, CATALOG_CACHE_AT_KEY]);
    const cached = stored[CATALOG_CACHE_KEY];
    const cachedAt = Number(stored[CATALOG_CACHE_AT_KEY] || 0);

    if (!force && cached && Date.now() - cachedAt < CATALOG_CACHE_TTL_MS) {
      const validated = validateCatalog(cached);
      applyCatalog(validated);
      return validated;
    }

    try {
      const catalogUrl = await getCatalogUrl();
      const response = await fetch(addCacheBuster(catalogUrl), { cache: 'no-store' });
      if (!response.ok) throw new Error(`Falha HTTP ${response.status} ao consultar o catálogo.`);
      const catalog = validateCatalog(await response.json());
      await chrome.storage.local.set({
        [CATALOG_CACHE_KEY]: catalog,
        [CATALOG_CACHE_AT_KEY]: Date.now()
      });
      applyCatalog(catalog);
      return catalog;
    } catch (error) {
      if (cached) {
        const validated = validateCatalog(cached);
        applyCatalog(validated);
        return { ...validated, stale: true, catalogWarning: normalizeError(error) };
      }
      throw error;
    }
  })().finally(() => {
    catalogPromise = null;
  });

  return catalogPromise;
}

function applyCatalog(catalog) {
  catalogMemory = catalog;
  captureProfiles = [];

  for (const module of catalog.modules) {
    for (const profile of module.authProfiles || []) {
      captureProfiles.push({
        moduleId: module.id,
        id: profile.id,
        captureHeaders: profile.captureHeaders || [],
        captureUrlPatterns: profile.captureUrlPatterns || profile.tabPatterns || profile.requestPatterns || []
      });
    }
  }

  const signature = JSON.stringify(catalog.modules
    .filter(module => module.enabled && module.type === 'user_script')
    .map(module => ({
      id: module.id,
      version: module.version,
      userScripts: module.userScripts
    })));

  if (signature !== userScriptsRefreshSignature) {
    const previous = userScriptsRefreshPromise;
    userScriptsRefreshSignature = signature;
    const pending = (async () => {
      if (previous) await previous.catch(() => {});
      await refreshEnabledUserScripts(catalog);
    })();
    userScriptsRefreshPromise = pending;
    pending.catch(error => {
      console.warn('SPX Loader: não foi possível atualizar os user scripts ativos.', error);
      if (userScriptsRefreshSignature === signature) userScriptsRefreshSignature = '';
    }).finally(() => {
      if (userScriptsRefreshPromise === pending) userScriptsRefreshPromise = null;
    });
  }
}

function validateCatalog(input) {
  if (!input || typeof input !== 'object') throw new Error('Catálogo remoto inválido.');
  if (Number(input.schemaVersion) !== 1) throw new Error('Versão de catálogo não suportada.');

  const launcherUrl = normalizeHttpsUrl(input.launcher?.url);
  const modules = Array.isArray(input.modules) ? input.modules.map(validateModule) : [];

  return {
    schemaVersion: 1,
    name: String(input.name || 'SPX Extension Hub'),
    updatedAt: input.updatedAt || null,
    launcher: { url: launcherUrl },
    modules
  };
}

function validateModule(module) {
  if (!module || typeof module !== 'object') throw new Error('Módulo inválido no catálogo.');
  const id = String(module.id || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(id)) throw new Error('ID de módulo inválido.');

  const type = String(module.type || 'web_app');
  if (!['web_app', 'user_script'].includes(type)) throw new Error(`Tipo inválido no módulo ${id}.`);

  return {
    id,
    name: String(module.name || id),
    description: String(module.description || ''),
    version: String(module.version || '0.0.0'),
    enabled: module.enabled !== false,
    type,
    entry: type === 'web_app' ? normalizeHttpsUrl(module.entry) : null,
    icon: module.icon ? normalizeHttpsUrl(module.icon) : null,
    permissions: normalizeStringArray(module.permissions),
    hostPermissions: normalizeStringArray(module.hostPermissions),
    capabilities: normalizeStringArray(module.capabilities),
    allowedOpenUrls: normalizeStringArray(module.allowedOpenUrls),
    authProfiles: Array.isArray(module.authProfiles) ? module.authProfiles.map(profile => validateAuthProfile(profile, id)) : [],
    userScripts: Array.isArray(module.userScripts) ? module.userScripts.map(script => validateUserScript(script, id)) : []
  };
}

function validateAuthProfile(profile, moduleId) {
  if (!profile || typeof profile !== 'object') throw new Error(`Perfil de autenticação inválido em ${moduleId}.`);
  const id = String(profile.id || '').trim();
  if (!id) throw new Error(`Perfil sem ID em ${moduleId}.`);

  return {
    id,
    requestPatterns: normalizeStringArray(profile.requestPatterns),
    tabPatterns: normalizeStringArray(profile.tabPatterns),
    captureUrlPatterns: normalizeStringArray(profile.captureUrlPatterns),
    captureHeaders: normalizeStringArray(profile.captureHeaders).map(item => item.toLowerCase()),
    cookieMappings: Array.isArray(profile.cookieMappings) ? profile.cookieMappings.map(mapping => ({
      url: normalizeHttpsUrl(mapping.url),
      cookieName: String(mapping.cookieName || ''),
      headerName: String(mapping.headerName || '').toLowerCase()
    })).filter(mapping => mapping.cookieName && mapping.headerName) : [],
    defaultHeaders: normalizeHeaderObject(profile.defaultHeaders),
    success: profile.success && typeof profile.success === 'object' ? {
      field: String(profile.success.field || ''),
      equals: profile.success.equals
    } : null,
    retryWithoutHeaders: normalizeStringArray(profile.retryWithoutHeaders).map(item => item.toLowerCase())
  };
}

function validateUserScript(script, moduleId) {
  if (!script || typeof script !== 'object') throw new Error(`User script inválido em ${moduleId}.`);
  return {
    id: String(script.id || '').trim(),
    url: normalizeHttpsUrl(script.url),
    matches: normalizeStringArray(script.matches),
    excludeMatches: normalizeStringArray(script.excludeMatches),
    runAt: ['document_start', 'document_end', 'document_idle'].includes(script.runAt) ? script.runAt : 'document_idle',
    world: ['MAIN', 'USER_SCRIPT'].includes(script.world) ? script.world : 'USER_SCRIPT',
    allFrames: script.allFrames === true
  };
}

async function getModuleRequirements(moduleId) {
  const module = await getModule(moduleId);
  const manifest = chrome.runtime.getManifest();
  const declaredPermissions = new Set([...(manifest.permissions || []), ...(manifest.optional_permissions || [])]);
  const undeclaredPermissions = module.permissions.filter(permission => !declaredPermissions.has(permission));
  const permissionState = await chrome.permissions.contains({
    permissions: module.permissions,
    origins: module.hostPermissions
  });

  return {
    ok: true,
    module: publicModule(module),
    granted: permissionState,
    requestable: undeclaredPermissions.length === 0,
    undeclaredPermissions,
    contactMessage: undeclaredPermissions.length ? permissionContactMessage(undeclaredPermissions) : null
  };
}

async function getModule(moduleId) {
  const catalog = catalogMemory || await refreshCatalog({ force: false });
  const module = catalog.modules.find(item => item.id === moduleId && item.enabled);
  if (!module) throw new Error('Módulo não encontrado ou desativado.');
  return module;
}

async function handleBridgeRequest(message, sender) {
  if (!sender.url?.startsWith(chrome.runtime.getURL(LOADER_PAGE))) {
    return failure('UNAUTHORIZED', 'Origem não autorizada para usar a ponte do loader.');
  }

  const operation = String(message.operation || '');
  const payload = message.payload || {};

  if (message.moduleId === 'launcher') {
    if (operation === 'catalog.get') {
      return { ok: true, catalog: publicCatalog(catalogMemory || await refreshCatalog({ force: false })) };
    }
    if (operation === 'catalog.refresh') {
      return { ok: true, catalog: publicCatalog(await refreshCatalog({ force: true })) };
    }
    if (operation === 'loader.info') {
      return { ok: true, version: chrome.runtime.getManifest().version, supportEmail: SUPPORT_EMAIL };
    }
    if (operation === 'account.read') {
      const paths = {
        basic: 'basic_info',
        permissions: 'user_permission_info',
        station: 'station_list/?count=50&status_list=0'
      };
      const path = Object.hasOwn(paths, payload.resource) ? paths[payload.resource] : '';
      if (!path) return failure('ACCOUNT_RESOURCE_NOT_ALLOWED', 'Consulta de conta não autorizada.');
      return handleBridgeRequest({
        moduleId: 'spx-dock-flow',
        operation: 'network.fetchBatch',
        payload: { profileId: 'spx', requests: [{ key: 'account', url: 'https://spx.shopee.com.br/api/admin/basicserver/current_user/' + path, method: 'GET' }] }
      }, sender);
    }
    return failure('CAPABILITY_NOT_ALLOWED', 'O launcher não pode usar esta operação.');
  }

  const module = await getModule(message.moduleId);

  if (!module.capabilities.includes(operation) && operation !== 'catalog.get' && operation !== 'loader.info') {
    return failure('CAPABILITY_NOT_ALLOWED', `O módulo não declarou acesso a ${operation}.`);
  }

  const requirements = await getModuleRequirements(module.id);
  if (!requirements.requestable) {
    return failure('MISSING_EXTENSION_PERMISSION', requirements.contactMessage, {
      permissions: requirements.undeclaredPermissions,
      supportEmail: SUPPORT_EMAIL
    });
  }

  const granted = await chrome.permissions.contains({ permissions: module.permissions, origins: module.hostPermissions });
  if (!granted) {
    return failure('PERMISSION_NOT_GRANTED', `Este módulo ainda não recebeu todas as permissões necessárias. Contate ${SUPPORT_EMAIL} caso o acesso não possa ser liberado.`, {
      supportEmail: SUPPORT_EMAIL
    });
  }

  switch (operation) {
    case 'catalog.get':
      return { ok: true, catalog: publicCatalog(catalogMemory || await refreshCatalog({ force: false })) };
    case 'loader.info':
      return { ok: true, version: chrome.runtime.getManifest().version, supportEmail: SUPPORT_EMAIL };
    case 'tabs.open':
      return openAllowedUrl(module, payload.url);
    case 'storage.get':
      return moduleStorageGet(module.id, payload.keys);
    case 'storage.set':
      return moduleStorageSet(module.id, payload.items);
    case 'storage.remove':
      return moduleStorageRemove(module.id, payload.keys);
    case 'network.fetchBatch':
      return networkFetchBatch(module, payload);
    case 'network.connectionStatus':
      return networkConnectionStatus(module, payload.profileId);
    case 'network.clearAuth':
      return clearAuthProfile(module, payload.profileId);
    case 'dockAlarm.configure':
      return self.spxDockAlarm.configure(payload);
    case 'dockAlarm.status':
      return self.spxDockAlarm.status();
    case 'userscripts.sync':
      return setUserScriptsEnabled(module, true);
    case 'userscripts.status':
      return getUserScriptsStatus(module);
    case 'userscripts.setEnabled':
      return setUserScriptsEnabled(module, payload.enabled === true);
    default:
      return failure('UNKNOWN_OPERATION', `Operação não suportada: ${operation}`);
  }
}

async function openAllowedUrl(module, value) {
  const url = normalizeHttpsUrl(value);
  const allowedPatterns = [module.entry, ...module.allowedOpenUrls, ...module.authProfiles.flatMap(profile => profile.requestPatterns)].filter(Boolean);
  if (!matchesAnyPattern(url, allowedPatterns)) return failure('URL_NOT_ALLOWED', 'O módulo tentou abrir uma URL não autorizada.');
  await chrome.tabs.create({ url });
  return { ok: true };
}

async function moduleStorageGet(moduleId, keys) {
  const requested = normalizeStringArray(keys);
  const mappedKeys = requested.map(key => moduleStorageKey(moduleId, key));
  const stored = await chrome.storage.local.get(mappedKeys);
  const values = {};
  for (const key of requested) values[key] = stored[moduleStorageKey(moduleId, key)];
  return { ok: true, values };
}

async function moduleStorageSet(moduleId, items) {
  if (!items || typeof items !== 'object' || Array.isArray(items)) return failure('INVALID_STORAGE_DATA', 'Dados de armazenamento inválidos.');
  const mapped = {};
  for (const [key, value] of Object.entries(items)) mapped[moduleStorageKey(moduleId, key)] = value;
  await chrome.storage.local.set(mapped);
  return { ok: true };
}

async function moduleStorageRemove(moduleId, keys) {
  const mappedKeys = normalizeStringArray(keys).map(key => moduleStorageKey(moduleId, key));
  await chrome.storage.local.remove(mappedKeys);
  return { ok: true };
}

async function networkFetchBatch(module, payload) {
  const profile = getAuthProfile(module, payload.profileId);
  const requests = Array.isArray(payload.requests) ? payload.requests.map(request => validateNetworkRequest(profile, request)) : [];
  if (!requests.length) return { ok: true, source: 'none', results: {} };

  const auth = await getAuthContext(module.id, profile);
  const tabs = await queryUsableTabs(profile.tabPatterns);
  const usableTab = tabs.find(tab => tab.id && !tab.discarded);
  const results = {};
  let usedTab = false;
  let usedWorker = false;

  if (usableTab?.id) {
    const tabResult = await fetchBatchInsideTab(usableTab.id, requests, auth.headers, profile).catch(error => ({
      ok: false,
      error: normalizeError(error),
      results: {}
    }));
    Object.assign(results, tabResult.results || {});
    usedTab = Object.values(tabResult.results || {}).some(item => item?.ok);
  }

  const unresolved = requests.filter(request => !results[request.key]?.ok);
  if (unresolved.length) {
    const workerResult = await fetchBatchFromWorker(unresolved, auth.headers, profile).catch(error => ({
      ok: false,
      error: normalizeError(error),
      results: {}
    }));

    for (const request of unresolved) {
      const workerItem = workerResult.results?.[request.key];
      if (workerItem?.ok || !results[request.key]) {
        results[request.key] = workerItem || failure('NETWORK_ERROR', workerResult.error || 'Falha na consulta remota.');
      }
    }
    usedWorker = Object.values(workerResult.results || {}).some(item => item?.ok);
  }

  return {
    ok: Object.values(results).some(item => item?.ok),
    source: usedTab && usedWorker ? 'mixed' : usedTab ? 'authenticated-tab' : 'service-worker',
    results
  };
}

function validateNetworkRequest(profile, request) {
  const url = normalizeHttpsUrl(request?.url);
  if (!matchesAnyPattern(url, profile.requestPatterns)) throw new Error('URL de consulta não autorizada pelo perfil do módulo.');
  const method = String(request?.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Método HTTP não permitido.');
  return {
    key: String(request?.key || crypto.randomUUID()),
    url,
    method,
    body: request?.body ?? null,
    headers: normalizeHeaderObject(request?.headers)
  };
}

async function fetchBatchInsideTab(tabId, requests, capturedHeaders, profile) {
  const injection = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (requestList, dynamicHeaders, remoteProfile) => {
      const readCookie = name => {
        const encoded = `${encodeURIComponent(name)}=`;
        const item = document.cookie.split('; ').find(part => part.startsWith(encoded));
        return item ? decodeURIComponent(item.slice(encoded.length)) : '';
      };

      const cookieHeaders = {};
      for (const mapping of remoteProfile.cookieMappings || []) {
        const value = readCookie(mapping.cookieName);
        if (value) cookieHeaders[mapping.headerName] = value;
      }

      const buildHeaders = request => {
        const headers = {
          ...(remoteProfile.defaultHeaders || {}),
          ...(dynamicHeaders || {}),
          ...cookieHeaders,
          ...(request.headers || {})
        };
        if (request.method !== 'GET' && !headers['content-type']) headers['content-type'] = 'application/json;charset=UTF-8';
        return headers;
      };

      const isSuccess = (response, json) => {
        if (!response.ok) return false;
        if (!remoteProfile.success?.field) return true;
        return json?.[remoteProfile.success.field] === remoteProfile.success.equals;
      };

      const execute = async (request, headers) => {
        const response = await fetch(request.url, {
          method: request.method,
          headers,
          body: request.method === 'GET' ? undefined : JSON.stringify(request.body ?? {}),
          credentials: 'include',
          cache: 'no-store'
        });
        const raw = await response.text();
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        return { response, raw, json, ok: isSuccess(response, json) };
      };

      const fetchOne = async request => {
        const headers = buildHeaders(request);
        let result = await execute(request, headers);

        if (!result.ok && (remoteProfile.retryWithoutHeaders || []).some(name => headers[name])) {
          const retryHeaders = { ...headers };
          for (const name of remoteProfile.retryWithoutHeaders || []) delete retryHeaders[name];
          const retry = await execute(request, retryHeaders);
          if (retry.ok || retry.response.status !== result.response.status) result = retry;
        }

        const error = result.ok
          ? null
          : result.json?.message || `Falha HTTP ${result.response.status || 0}: ${result.response.statusText || result.raw.slice(0, 300) || 'resposta inválida'}`;

        return [request.key, {
          ok: result.ok,
          source: 'authenticated-tab',
          httpStatus: result.response.status,
          data: result.json,
          error
        }];
      };

      const entries = await Promise.all(requestList.map(fetchOne));
      return { ok: entries.some(([, item]) => item.ok), results: Object.fromEntries(entries) };
    },
    args: [requests, capturedHeaders || {}, profile]
  });

  const result = injection?.[0]?.result;
  if (!result) throw new Error('A aba autenticada não retornou dados.');
  return result;
}

async function fetchBatchFromWorker(requests, capturedHeaders, profile) {
  const fetchOne = async request => {
    const headers = {
      ...(profile.defaultHeaders || {}),
      ...(capturedHeaders || {}),
      ...(request.headers || {})
    };
    if (request.method !== 'GET' && !headers['content-type']) headers['content-type'] = 'application/json;charset=UTF-8';

    const execute = async currentHeaders => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: currentHeaders,
        body: request.method === 'GET' ? undefined : JSON.stringify(request.body ?? {}),
        credentials: 'include',
        cache: 'no-store'
      });
      const raw = await response.text();
      let json = null;
      try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
      return { response, raw, json, ok: response.ok && (!profile.success?.field || json?.[profile.success.field] === profile.success.equals) };
    };

    let result = await execute(headers);
    if (!result.ok && profile.retryWithoutHeaders.some(name => headers[name])) {
      const retryHeaders = { ...headers };
      for (const name of profile.retryWithoutHeaders) delete retryHeaders[name];
      const retry = await execute(retryHeaders);
      if (retry.ok || retry.response.status !== result.response.status) result = retry;
    }

    return [request.key, {
      ok: result.ok,
      source: 'service-worker',
      httpStatus: result.response.status,
      data: result.json,
      error: result.ok ? null : result.json?.message || `Falha HTTP ${result.response.status || 0}: ${result.response.statusText || result.raw.slice(0, 300) || 'resposta inválida'}`
    }];
  };

  const entries = await Promise.all(requests.map(fetchOne));
  return { ok: entries.some(([, item]) => item.ok), results: Object.fromEntries(entries) };
}

async function networkConnectionStatus(module, profileId) {
  const profile = getAuthProfile(module, profileId);
  const auth = await getAuthContext(module.id, profile);
  const tabs = await queryUsableTabs(profile.tabPatterns);
  return {
    ok: true,
    hasTab: tabs.some(tab => tab.id && !tab.discarded),
    hasCapturedHeaders: Object.keys(auth.headers).length > 0,
    capturedAt: auth.capturedAt,
    headers: Object.fromEntries(Object.keys(auth.headers).map(name => [name, true]))
  };
}

async function clearAuthProfile(module, profileId) {
  const profile = getAuthProfile(module, profileId);
  await chrome.storage.session.remove([
    authHeadersStorageKey(module.id, profile.id),
    authCapturedAtStorageKey(module.id, profile.id)
  ]);
  return { ok: true };
}

async function getAuthContext(moduleId, profile) {
  const headersKey = authHeadersStorageKey(moduleId, profile.id);
  const capturedAtKey = authCapturedAtStorageKey(moduleId, profile.id);
  const stored = await chrome.storage.session.get([headersKey, capturedAtKey]);
  const headers = { ...(stored[headersKey] || {}) };

  for (const mapping of profile.cookieMappings) {
    if (headers[mapping.headerName]) continue;
    const cookie = await chrome.cookies.get({ url: mapping.url, name: mapping.cookieName });
    if (cookie?.value) headers[mapping.headerName] = cookie.value;
  }

  return { headers, capturedAt: stored[capturedAtKey] || null };
}

async function queryUsableTabs(patterns) {
  const allTabs = [];
  for (const pattern of patterns) {
    const tabs = await chrome.tabs.query({ url: pattern });
    allTabs.push(...tabs);
  }
  const unique = new Map(allTabs.filter(tab => tab.id).map(tab => [tab.id, tab]));
  return [...unique.values()];
}

function userScriptsStateKey(moduleId) {
  return `module:${moduleId}:userScriptsEnabled`;
}

function userScriptPrefix(moduleId) {
  return `remote:${moduleId}:`;
}

async function ensureUserScriptsAvailable() {
  if (!chrome.userScripts) {
    return failure('USER_SCRIPTS_DISABLED', 'Ative “Permitir scripts de usuário” nos detalhes da extensão no Chrome.', { supportEmail: SUPPORT_EMAIL });
  }

  try {
    await chrome.userScripts.getScripts();
    return null;
  } catch {
    return failure('USER_SCRIPTS_DISABLED', 'Ative “Permitir scripts de usuário” nos detalhes da extensão no Chrome.', { supportEmail: SUPPORT_EMAIL });
  }
}

async function getUserScriptsStatus(module) {
  if (userScriptsRefreshPromise) await userScriptsRefreshPromise.catch(() => {});
  if (module.type !== 'user_script') {
    return failure('INVALID_MODULE_TYPE', 'Este módulo não é um user script.');
  }

  const unavailable = await ensureUserScriptsAvailable();
  if (unavailable) return unavailable;

  const stateKey = userScriptsStateKey(module.id);
  const [stored, existing] = await Promise.all([
    chrome.storage.local.get({ [stateKey]: false }),
    chrome.userScripts.getScripts()
  ]);
  const prefix = userScriptPrefix(module.id);
  const registered = existing.some(script => script.id.startsWith(prefix));

  return {
    ok: true,
    enabled: stored[stateKey] === true,
    registered,
    scripts: existing.filter(script => script.id.startsWith(prefix)).length
  };
}

async function setUserScriptsEnabled(module, enabled) {
  if (userScriptsRefreshPromise) await userScriptsRefreshPromise.catch(() => {});
  if (module.type !== 'user_script') {
    return failure('INVALID_MODULE_TYPE', 'Este módulo não é um user script.');
  }

  const unavailable = await ensureUserScriptsAvailable();
  if (unavailable) return unavailable;

  const stateKey = userScriptsStateKey(module.id);

  try {
    let scripts = 0;
    if (enabled) {
      scripts = await registerUserScripts(module);
    } else {
      await unregisterUserScripts(module);
    }

    await chrome.storage.local.set({ [stateKey]: enabled });
    const reloadedTabs = await reloadUserScriptTabs(module);

    return {
      ok: true,
      enabled,
      registered: enabled && scripts > 0,
      scripts,
      reloadedTabs
    };
  } catch (error) {
    if (enabled) {
      await chrome.storage.local.set({ [stateKey]: false }).catch(() => {});
      await unregisterUserScripts(module).catch(() => {});
    }
    throw error;
  }
}

async function registerUserScripts(module) {
  if (!module.userScripts.length) return 0;

  await unregisterUserScripts(module);
  const prefix = userScriptPrefix(module.id);
  const registrations = [];

  for (const script of module.userScripts) {
    const response = await fetch(addCacheBuster(script.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Não foi possível baixar o script ${script.id}.`);

    registrations.push({
      id: `${prefix}${script.id}`,
      matches: script.matches,
      excludeMatches: script.excludeMatches,
      js: [{ code: await response.text() }],
      runAt: script.runAt,
      world: script.world,
      allFrames: script.allFrames
    });
  }

  await chrome.userScripts.register(registrations);
  return registrations.length;
}

async function unregisterUserScripts(module) {
  const prefix = userScriptPrefix(module.id);
  const existing = await chrome.userScripts.getScripts();
  const ids = existing
    .filter(script => script.id.startsWith(prefix))
    .map(script => script.id);

  if (ids.length) await chrome.userScripts.unregister({ ids });
  return ids.length;
}

async function reloadUserScriptTabs(module) {
  const patterns = [...new Set(module.userScripts.flatMap(script => script.matches || []))];
  const tabs = await queryUsableTabs(patterns);

  await Promise.all(tabs.map(tab => chrome.tabs.reload(tab.id).catch(() => {})));
  return tabs.length;
}

async function refreshEnabledUserScripts(catalog) {
  const modules = catalog.modules.filter(module => module.enabled && module.type === 'user_script');
  if (!modules.length) return;

  const keys = modules.map(module => userScriptsStateKey(module.id));
  const states = await chrome.storage.local.get(keys);
  const unavailable = await ensureUserScriptsAvailable();
  if (unavailable) return;

  for (const module of modules) {
    if (states[userScriptsStateKey(module.id)] === true) {
      await registerUserScripts(module);
    }
  }
}

function getAuthProfile(module, profileId) {
  const profile = module.authProfiles.find(item => item.id === profileId);
  if (!profile) throw new Error('Perfil de autenticação não encontrado para este módulo.');
  return profile;
}

function publicCatalog(catalog) {
  return {
    schemaVersion: catalog.schemaVersion,
    name: catalog.name,
    updatedAt: catalog.updatedAt,
    modules: catalog.modules.map(publicModule)
  };
}

function publicModule(module) {
  return {
    id: module.id,
    name: module.name,
    description: module.description,
    version: module.version,
    enabled: module.enabled,
    type: module.type,
    entry: module.entry,
    icon: module.icon
  };
}

function moduleStorageKey(moduleId, key) {
  return `module:${moduleId}:${String(key || '')}`;
}

function authHeadersStorageKey(moduleId, profileId) {
  return `auth:${moduleId}:${profileId}:headers`;
}

function authCapturedAtStorageKey(moduleId, profileId) {
  return `auth:${moduleId}:${profileId}:capturedAt`;
}

function permissionContactMessage(permissions) {
  const list = permissions.join(', ');
  return `Este módulo precisa de uma permissão que ainda não está disponível no loader (${list}). Entre em contato com ${SUPPORT_EMAIL} para solicitar a atualização da extensão.`;
}

function matchesAnyPattern(url, patterns) {
  return patterns.some(pattern => matchPattern(url, pattern));
}

function matchPattern(url, pattern) {
  if (!pattern) return false;
  if (url === pattern) return true;
  if (pattern === '<all_urls>') return /^(https?|file|ftp):/i.test(url);
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(url);
}

function normalizeHttpsUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:') throw new Error('Somente URLs HTTPS são permitidas.');
  return url.toString();
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))] : [];
}

function normalizeHeaderObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([name, headerValue]) => [String(name).toLowerCase(), String(headerValue)]));
}

function addCacheBuster(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('_loader_ts', String(Date.now()));
  return parsed.toString();
}

function failure(code, message, details = null) {
  return { ok: false, code, error: message, details };
}

function normalizeError(error) {
  return error?.message || String(error || 'Erro desconhecido');
}

refreshCatalog({ force: false }).catch(() => {});

importScripts('dock-alarm-background.js');
