(function initializeSpxAuth() {
  'use strict';
  const LOG_PREFIX = '[SPX Hub Auth]';
  const log = (message, data) => data === undefined ? console.log(`${LOG_PREFIX} ${message}`) : console.log(`${LOG_PREFIX} ${message}`, data);
  const errorLog = (message, error) => console.error(`${LOG_PREFIX} ${message}`, error);

  log('Inicializando validação do catálogo.', { bridgeModuleId: LoaderBridge.moduleId });

  try { localStorage.removeItem('spx-hub-auth-session-v1'); } catch (_) {}
  try { sessionStorage.removeItem('spx-hub-auth-session-v1'); } catch (_) {}
  const state = { allowed: false, loading: true, email: '', message: 'Verificando conta SPX...' };
  let pending = null;

  async function requestAsLauncher(operation, payload) {
    log('Bridge request iniciado.', {
      moduleId: LoaderBridge.moduleId,
      operation,
      profileId: payload?.profileId || null,
      url: payload?.requests?.[0]?.url || payload?.url || null
    });
    const response = await LoaderBridge.request(operation, payload);
    log('Bridge response recebido.', {
      moduleId: LoaderBridge.moduleId,
      operation,
      ok: response?.ok,
      error: response?.error || null,
      message: response?.message || null,
      resultOk: response?.results?.identity?.ok,
      resultError: response?.results?.identity?.error || null
    });
    if (response?.ok === false) throw new Error(response.error || response.message || 'Solicitação recusada pelo loader.');
    return response;
  }

  const checker = createSpxAccessChecker(async url => {
    log('Consultando endpoint SPX.', { url });
    const response = await requestAsLauncher('network.fetchBatch', {
      profileId: 'spx', requests: [{ key: 'identity', url, method: 'GET' }]
    });
    const item = response?.results?.identity;
    log('Resultado da consulta SPX.', {
      url,
      itemOk: item?.ok,
      itemError: item?.error || null,
      retcode: item?.data?.retcode,
      hasData: Boolean(item?.data?.data)
    });
    if (!item?.ok) throw new Error(item?.error || 'Sessão SPX indisponível.');
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
    if (pending) {
      log('Refresh ignorado: já existe uma validação em andamento.');
      return pending;
    }
    log('Iniciando refresh de acesso.');
    state.loading = true;
    emit();
    pending = checker.check(true)
      .then(result => {
        Object.assign(state, result);
        log('Validação concluída.', { allowed: result.allowed, email: result.email || null, message: result.message });
        return result.allowed;
      })
      .catch(refreshError => {
        errorLog('Erro inesperado no refresh.', refreshError);
        throw refreshError;
      })
      .finally(() => {
        state.loading = false;
        pending = null;
        emit();
        log('Refresh finalizado.', { allowed: state.allowed, message: state.message });
      });
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
      log('Solicitando abertura do SPX.');
      const response = await requestAsLauncher('tabs.open', { url: 'https://spx.shopee.com.br/' });
      if (!response?.ok) throw new Error('Não foi possível abrir o SPX.');
    } catch (openError) {
      errorLog('Falha ao abrir o SPX.', openError);
      state.message = 'Abra https://spx.shopee.com.br/ e entre com sua conta corporativa.';
      emit();
    }
  });

  window.addEventListener('focus', () => void refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
  window.HubAuth = Object.freeze({ access, authorize, refresh });
  emit();
  void refresh();
})();
