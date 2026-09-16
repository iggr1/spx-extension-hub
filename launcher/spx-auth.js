(function initializeSpxAuth() {
  'use strict';
  // Discard obsolete Hub sessions. No credentials are persisted by this flow.
  try { localStorage.removeItem('spx-hub-auth-session-v1'); } catch (_) {}
  try { sessionStorage.removeItem('spx-hub-auth-session-v1'); } catch (_) {}
  const state = { allowed: false, loading: true, email: '', message: 'Verificando conta SPX...' };
  let pending = null;
  const checker = createSpxAccessChecker(async url => {
    const response = await LoaderBridge.requestForModule('assistente-de-devolucoes', 'network.fetchBatch', {
      profileId: 'spx', requests: [{ key: 'identity', url, method: 'GET' }]
    });
    const item = response?.results?.identity;
    if (!item?.ok) throw new Error('Sessão SPX indisponível.');
    return item.data;
  });
  function access(id) {
    if (id === 'spx-dock-flow') return { allowed: true, restricted: false, message: 'Acesso livre' };
    if (id !== 'assistente-de-devolucoes') return { allowed: false, restricted: true, message: 'Módulo sem regra de acesso configurada.' };
    return { ...state, restricted: true, allowed: !state.loading && state.allowed };
  }
  function emit() {
    const bar = document.querySelector('.auth-bar');
    bar.classList.toggle('is-loading', state.loading);
    bar.inert = state.loading;
    bar.setAttribute('aria-busy', String(state.loading));
    document.getElementById('authIdentity').textContent = state.loading ? 'Verificando conta SPX...' : state.email || 'Acesso pela sessão do SPX';
    document.getElementById('authMessage').textContent = state.message;
    document.getElementById('authCheck').disabled = state.loading;
    document.getElementById('authAccount').disabled = state.loading;
    window.dispatchEvent(new CustomEvent('spx-auth-change'));
  }
  function refresh() {
    if (pending) return pending;
    state.loading = true;
    emit();
    pending = checker.check(true).then(result => { Object.assign(state, result); return result.allowed; })
      .finally(() => { state.loading = false; pending = null; emit(); });
    return pending;
  }
  async function authorize(id) {
    if (id === 'spx-dock-flow') return true;
    if (id !== 'assistente-de-devolucoes') return false;
    return refresh();
  }
  document.getElementById('authCheck').addEventListener('click', refresh);
  document.getElementById('authAccount').addEventListener('click', async () => {
    try {
      const response = await LoaderBridge.requestForModule('assistente-de-devolucoes', 'tabs.open', { url: 'https://spx.shopee.com.br/' });
      if (!response?.ok) throw new Error('Não foi possível abrir o SPX.');
    } catch (_) { state.message = 'Abra https://spx.shopee.com.br/ e entre com sua conta corporativa.'; emit(); }
  });
  window.addEventListener('focus', () => void refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
  window.HubAuth = Object.freeze({ access, authorize, refresh });
  emit();
  void refresh();
})();
