(() => {
  'use strict';
  const button = document.getElementById('accountButton');
  const panel = document.getElementById('accountPanel');
  if (!button || !panel || !window.SpxHubUsage) return;
  let profile = null;
  let pending = null;
  let checkedAt = 0;
  let catalogVersion = '';
  let loaderVersion = '';
  let opened = false;
  let collectedAccount = '';
  const versions = new Map();
  const set = (id, value) => { document.getElementById(id).textContent = value; };
  let storage;
  try { storage = localStorage; } catch {}
  const client = SpxHubUsage.createClient({
    storage,
    getProfile: () => refresh(),
    onStatus(value) {
      set('accountUsageNotice', value === 'disabled' ? 'Registro de uso aguardando configuração.' : value === 'pending' ? 'Registro de uso pendente de envio.' : 'São registrados HUB, conta e ferramentas utilizadas para acompanhar a adoção da extensão.');
    }
  });

  function showPanel(value) {
    opened = value;
    panel.hidden = !value;
    button.setAttribute('aria-expanded', String(value));
    if (value) { void refresh(); document.getElementById('closeAccountButton').focus(); }
    else button.focus();
  }
  button.addEventListener('click', () => showPanel(!opened));
  document.getElementById('closeAccountButton').addEventListener('click', () => showPanel(false));
  document.addEventListener('click', event => { if (opened && !panel.contains(event.target) && !button.contains(event.target)) showPanel(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && opened) showPanel(false); });

  async function read(url) {
    let timer;
    const response = await Promise.race([
      LoaderBridge.requestForModule('spx-dock-flow', 'network.fetchBatch', { profileId: 'spx', requests: [{ key: 'account', url, method: 'GET' }] }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('A consulta da conta demorou. Atualize a lista para tentar novamente.')), 15000); })
    ]).finally(() => clearTimeout(timer));
    const item = response?.results?.account;
    if (!item?.ok || item.data?.retcode !== 0) throw new Error('Abra uma aba do SPX com a sessão autenticada e atualize a lista.');
    return item.data;
  }
  function render(value) {
    profile = value;
    button.dataset.state = 'ready';
    button.title = value.name + ' · ' + value.role;
    set('accountName', value.name);
    set('accountLogin', value.email || value.login || 'Conta sem e-mail informado');
    set('accountHub', value.hubName);
    set('accountHubId', value.hubId);
    set('accountUserId', value.userId);
    set('accountRole', value.role);
    document.getElementById('accountRole').dataset.role = value.role;
    set('accountMessage', 'Perfil de acesso às ferramentas conforme as permissões da conta SPX.');
    document.getElementById('accountDetails').hidden = false;
  }
  async function refresh(force = false) {
    if (pending) return pending;
    if (!force && profile && Date.now() - checkedAt < 60000) return profile;
    button.dataset.state = 'loading';
    panel.setAttribute('aria-busy', 'true');
    pending = SpxHubUsage.readIdentity(read).then(async value => {
      checkedAt = Date.now();
      render(value);
      const key = value.hubId + '|' + value.userId;
      if (key !== collectedAccount) {
        const recorded = await client.record('launcher', catalogVersion, 'catalog_open', value).catch(() => false);
        if (recorded) collectedAccount = key;
      }
      return value;
    }).catch(error => {
      profile = null;
      collectedAccount = '';
      button.dataset.state = 'error';
      button.title = 'Conta SPX não identificada';
      document.getElementById('accountDetails').hidden = true;
      set('accountName', 'Conta SPX não identificada');
      set('accountLogin', '');
      set('accountMessage', error.message || 'Não foi possível consultar a conta SPX.');
      return null;
    }).finally(() => { pending = null; panel.setAttribute('aria-busy', 'false'); });
    return pending;
  }
  async function record(moduleId, event) {
    const account = await refresh();
    if (!account) return false;
    return client.record(moduleId, versions.get(moduleId) || loaderVersion, event, account).catch(() => false);
  }
  function configure(catalog, loader) {
    catalogVersion = String(catalog.updatedAt || '').slice(0, 40);
    loaderVersion = loader;
    for (const module of catalog.modules || []) versions.set(module.id, module.version);
  }
  window.HubAccount = Object.freeze({ configure, refresh, record });
  window.addEventListener('online', () => { void client.flush(true); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const account = await refresh(true);
    if (account) await client.record('launcher', catalogVersion, 'catalog_active', account).catch(() => {});
    await client.flush();
  }, 15 * 60 * 1000);
})();
