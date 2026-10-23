(function (root) {
  'use strict';
  if (root.SpxHubUsage) return;
  const BASE = 'https://iggr1.github.io/spx-extension-hub/';
  const API = 'https://spx.shopee.com.br/api/admin/basicserver/current_user/';
  const URLS = Object.freeze({ basic: API + 'basic_info', permissions: API + 'user_permission_info', station: API + 'station_list/?count=50&status_list=0' });
  const INTERVAL = 15 * 60 * 1000;
  const RETENTION = 7 * 24 * 60 * 60 * 1000;
  const QUEUE_KEY = 'spxHubUsagePendingV1';
  const MODULES = ['launcher', 'spx-dock-flow', 'spx-dock-flow-autoadd', 'assistente-de-devolucoes'];
  const EVENTS = ['catalog_open', 'catalog_active', 'module_open', 'module_active', 'module_enabled'];
  const text = value => typeof value === 'string' ? value.trim().slice(0, 200) : '';
  const id = value => /^\d{1,18}$/.test(String(value)) && Number(value) > 0 ? String(value) : '';

  function classify(basic, permissions) {
    if (permissions?.retcode !== 0 || !Array.isArray(permissions.data?.perm_list)) return 'Não identificado';
    const email = text(basic?.data?.email).toLowerCase();
    const local = email.split('@')[0];
    const corporate = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@shopee\.com$/.test(email) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
    const aliases = new Set(permissions.data.perm_list.flatMap(item => Array.isArray(item?.perm_alias) ? item.perm_alias : []));
    return corporate && aliases.has('RESOLVE_EO') && aliases.has('CANCEL_EO_REASON') ? 'Analista' : 'Operador';
  }

  async function readIdentity(read) {
    const [stations, basic, permissions] = await Promise.all([
      read(URLS.station), read(URLS.basic).catch(() => null), read(URLS.permissions).catch(() => null)
    ]);
    const stationUserId = id(stations?.data?.id);
    const userId = stationUserId || id(basic?.data?.id);
    const hubId = id(stations?.data?.current_station_id);
    if (stations?.retcode !== 0 || !userId || !hubId) throw new Error('Abra uma aba do SPX com a sessão autenticada e atualize a lista.');
    const [confirmedHub, confirmedUser] = await Promise.all([
      read(URLS.station), stationUserId ? Promise.resolve(null) : read(URLS.basic)
    ]);
    const confirmedId = id(confirmedHub?.data?.id) || id(confirmedUser?.data?.id);
    if (confirmedHub?.retcode !== 0 || confirmedId !== userId || id(confirmedHub.data?.current_station_id) !== hubId ||
        text(confirmedHub.data?.email) !== text(stations.data?.email) ||
        (!stationUserId && (confirmedUser?.retcode !== 0 || text(confirmedUser.data?.email) !== text(basic?.data?.email)))) {
      throw new Error('A conta ou o HUB mudou durante a consulta. Atualize a lista.');
    }
    const data = confirmedHub.data;
    const stationLogin = text(data.email);
    const basicMatches = basic?.retcode === 0 && id(basic.data?.id) === userId &&
      (!stationLogin || !text(basic.data?.email) || text(basic.data?.email).toLowerCase() === stationLogin.toLowerCase());
    const details = basicMatches ? basic.data : {};
    const lists = [data.station_list, data.list, data.stations, data.station_info_list].filter(Array.isArray).flat();
    const station = lists.find(item => id(item.station_id ?? item.id) === hubId);
    const login = stationLogin || text(details.email || details.username || details.user_name);
    return {
      userId,
      name: text(details.name || details.user_name || details.username || details.nickname) || login || 'Usuário SPX',
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login) ? login : '',
      login,
      role: classify({ data: { email: login } }, permissions),
      hubId,
      hubName: text(data.current_station_name || data.current_station?.station_name || station?.station_name || station?.name) || 'HUB ' + hubId
    };
  }

  function dayOf(date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = name => parts.find(part => part.type === name).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  }

  function endpointAllowed(value) {
    return typeof value === 'string' && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value);
  }

  function createClient(options) {
    const request = options.fetch || root.fetch.bind(root);
    const storage = options.storage;
    const now = options.now || Date.now;
    let config = null;
    let configAt = 0;
    let configurationPending = null;
    let sending = null;
    let lastAttempt = 0;
    let lastDelivered = 0;
    let memory = [];
    let localLock = Promise.resolve();

    function status(value) { if (options.onStatus) options.onStatus(value); }
    function exclusive(task) {
      if (root.navigator?.locks) return root.navigator.locks.request(QUEUE_KEY, task);
      const next = localLock.then(task, task);
      localLock = next.catch(() => {});
      return next;
    }
    function loadQueue() {
      try {
        const raw = storage?.getItem(QUEUE_KEY);
        if (storage) memory = raw ? JSON.parse(raw) : [];
      } catch {}
      if (!Array.isArray(memory)) memory = [];
      memory = memory.filter(item => item && typeof item.key === 'string' && Number.isFinite(Date.parse(item.firstSeen)) && Number.isFinite(Date.parse(item.lastSeen)) && now() - Date.parse(item.firstSeen) <= RETENTION).slice(-100);
      return memory;
    }
    function saveQueue(items) {
      memory = items.slice(-100);
      try {
        if (memory.length) storage?.setItem(QUEUE_KEY, JSON.stringify(memory));
        else storage?.removeItem(QUEUE_KEY);
      } catch {}
    }
    async function getConfig() {
      if (config && now() - configAt < (config.enabled ? INTERVAL : 60000)) return config;
      if (configurationPending) return configurationPending;
      configurationPending = (async () => {
        const response = await request(options.configUrl || BASE + 'launcher/usage-config.json', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error('Configuração de uso indisponível.');
        const next = await response.json();
        config = { enabled: next.enabled === true && endpointAllowed(next.endpoint), endpoint: endpointAllowed(next.endpoint) ? next.endpoint : '' };
        configAt = now();
        status(config.enabled ? 'ready' : 'disabled');
        return config;
      })().finally(() => { configurationPending = null; });
      return configurationPending;
    }
    async function record(moduleId, version, event, suppliedProfile) {
      if (!MODULES.includes(moduleId) || !EVENTS.includes(event)) return false;
      const settings = await getConfig().catch(() => null);
      if (!settings?.enabled) return false;
      const profile = suppliedProfile || await options.getProfile();
      if (!id(profile?.userId) || !id(profile?.hubId)) return false;
      const timestamp = new Date(now()).toISOString();
      const day = dayOf(new Date(now()));
      const key = [day, profile.hubId, profile.userId, moduleId].join('|');
      const account = Object.fromEntries(['userId', 'name', 'email', 'login', 'role', 'hubId', 'hubName'].map(field => [field, text(profile[field])]));
      await exclusive(() => {
        const queue = loadQueue();
        const previous = queue.find(item => item.key === key);
        const item = { key, day, ...account, moduleId, version: text(version).slice(0, 40), firstSeen: previous?.firstSeen || timestamp, lastSeen: timestamp, events: [...new Set([...(previous?.events || []), event])].sort() };
        saveQueue([...queue.filter(entry => entry.key !== key), item]);
      });
      status('pending');
      void flush();
      return true;
    }
    async function flush(force = false) {
      if (sending) return sending;
      if (!force && lastAttempt && now() - lastAttempt < (lastDelivered ? 10000 : 60000)) return false;
      sending = (async () => {
        const settings = await getConfig();
        if (!settings.enabled) return false;
        const batch = await exclusive(() => loadQueue().slice(0, 20).map(item => ({ ...item })));
        if (!batch.length) return true;
        lastAttempt = now();
        const response = await request(settings.endpoint, {
          method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ schemaVersion: 1, events: batch }), signal: AbortSignal.timeout(20000)
        });
        if (!response.ok || response.type === 'opaque') throw new Error('Registro de uso sem confirmação.');
        const ack = await response.json();
        if (ack.ok !== true || !Array.isArray(ack.accepted)) throw new Error('Registro de uso não confirmado.');
        const accepted = new Set(ack.accepted);
        const snapshot = new Map(batch.filter(item => accepted.has(item.key)).map(item => [item.key, JSON.stringify(item)]));
        await exclusive(() => saveQueue(loadQueue().filter(item => snapshot.get(item.key) !== JSON.stringify(item))));
        lastDelivered = now();
        status('sent');
        return true;
      })().catch(() => { status('pending'); return false; }).finally(() => { sending = null; });
      return sending;
    }
    return Object.freeze({ record, flush, getConfig });
  }

  function startSpxAgent(moduleId, version) {
    if (root.location?.origin !== 'https://spx.shopee.com.br' || root.top !== root.self) return;
    if (!root.__spxHubUsageAgentV1) {
      let profile = null;
      let checkedAt = 0;
      let pending = null;
      const modules = new Map();
      const sent = new Map();
      const read = async url => {
        const response = await root.fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(12000), headers: { accept: 'application/json', app: 'FMS Portal' } });
        if (!response.ok) throw new Error('Sessão SPX indisponível.');
        return response.json();
      };
      const getProfile = () => {
        if (pending) return pending;
        if (profile && Date.now() - checkedAt < 60000) return Promise.resolve(profile);
        pending = readIdentity(read).then(value => { profile = value; checkedAt = Date.now(); return value; }).finally(() => { pending = null; });
        return pending;
      };
      let storage;
      try { storage = root.localStorage; } catch {}
      const client = createClient({ getProfile, storage });
      const tick = async () => {
        if (root.document.visibilityState === 'hidden') return;
        const config = await client.getConfig().catch(() => null);
        if (!config?.enabled) return;
        const account = await getProfile().catch(() => null);
        if (!account) return;
        for (const [module, currentVersion] of modules) {
          if (module === 'assistente-de-devolucoes' && account.role !== 'Analista') continue;
          const key = account.hubId + '|' + account.userId + '|' + module;
          if (Date.now() - (sent.get(key) || 0) < INTERVAL) continue;
          if (await client.record(module, currentVersion, 'module_active', account).catch(() => false)) sent.set(key, Date.now());
        }
        await client.flush();
      };
      root.__spxHubUsageAgentV1 = { modules, tick };
      root.setInterval(() => { void tick(); }, 60000);
      root.document.addEventListener('visibilitychange', () => { void tick(); });
      root.addEventListener('online', () => { void client.flush(true); });
    }
    root.__spxHubUsageAgentV1.modules.set(moduleId, version);
    void root.__spxHubUsageAgentV1.tick();
  }

  const api = Object.freeze({ URLS, classify, readIdentity, createClient, dayOf, endpointAllowed, startSpxAgent });
  root.SpxHubUsage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

SpxHubUsage.startSpxAgent("spx-dock-flow-autoadd", "1.2.11");
