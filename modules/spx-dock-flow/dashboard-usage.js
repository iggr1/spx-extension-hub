(() => {
  'use strict';
  if (!window.SpxHubUsage || !window.LoaderBridge) return;
  let profile = null;
  let pending = null;
  let checkedAt = 0;
  const read = async url => {
    const response = await LoaderBridge.request('network.fetchBatch', { profileId: 'spx', requests: [{ key: 'identity', url, method: 'GET' }] });
    if (!response?.results?.identity?.ok) throw new Error('Conta SPX indisponível.');
    return response.results.identity.data;
  };
  const getProfile = () => {
    if (pending) return pending;
    if (profile && Date.now() - checkedAt < 60000) return Promise.resolve(profile);
    pending = SpxHubUsage.readIdentity(read).then(value => { profile = value; checkedAt = Date.now(); return value; }).finally(() => { pending = null; });
    return pending;
  };
  let storage;
  try { storage = localStorage; } catch {}
  const client = SpxHubUsage.createClient({ storage, getProfile });
  const tick = async () => {
    if (state.demo || document.visibilityState === 'hidden') return;
    const settings = await client.getConfig().catch(() => null);
    if (!settings?.enabled) return;
    const account = await getProfile().catch(() => null);
    if (account && !state.demo) await client.record('spx-dock-flow', '1.10.11', 'module_active', account).catch(() => {});
    await client.flush();
  };
  void tick();
  setInterval(() => { void tick(); }, 15 * 60 * 1000);
  window.addEventListener('online', () => { void client.flush(true); });
})();
