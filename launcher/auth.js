(function initializeHubAuth() {
  'use strict';

  const SESSION_KEY = 'spx-hub-auth-session-v1';
  const config = window.SPX_AUTH_CONFIG || {};
  const publicModuleIds = new Set(Array.isArray(config.publicModuleIds) ? config.publicModuleIds : []);
  // Workspace deployment links also have a canonical public endpoint.
  const apiUrl = String(config.apiUrl || '').trim()
    .replace(/^https:\/\/script\.google\.com\/a\/macros\/[^/]+\/s\//, 'https://script.google.com/macros/s/');
  const configured = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(apiUrl);
  const state = { user: null, modules: [], checkedAt: 0, expiresAt: 0, error: '', configured, loading: true };
  let token = readToken();
  let epoch = 0;
  let requestSequence = 0;
  let loginAttempt = 0;
  let refreshPromise = null;
  let busy = false;
  let codeEmail = '';
  let retryAt = 0;
  let previousFocus = null;

  const panel = document.getElementById('authDialog');
  const form = document.getElementById('authForm');
  const emailInput = document.getElementById('authEmail');
  const nameInput = document.getElementById('authName');
  const codeInput = document.getElementById('authCode');
  const feedback = document.getElementById('authFeedback');
  const submit = document.getElementById('authSubmit');
  const resend = document.getElementById('authResend');
  const account = document.getElementById('authAccount');

  function readToken() {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) return saved;
    } catch (_) { /* Fall back to tab storage when persistent storage is blocked. */ }
    try {
      const previous = sessionStorage.getItem(SESSION_KEY) || '';
      if (previous) {
        try {
          localStorage.setItem(SESSION_KEY, previous);
          sessionStorage.removeItem(SESSION_KEY);
        } catch (_) { /* Keep the existing tab session if migration is unavailable. */ }
      }
      return previous;
    } catch (_) { return ''; }
  }

  function saveToken(value) {
    token = value;
    if (!value) {
      try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
      try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
      return;
    }
    try {
      localStorage.setItem(SESSION_KEY, value);
      try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    } catch (_) {
      try { sessionStorage.setItem(SESSION_KEY, value); } catch (_) {}
    }
  }

  async function api(action, payload = {}) {
    if (!configured) throw new Error('O login ainda está sendo configurado pelo responsável.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      // Plain text avoids an OPTIONS preflight unsupported by Apps Script.
      // Tokens/codes are carried only in the HTTPS POST body.
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ action, ...payload }),
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error('Não foi possível conectar ao serviço de acesso.');
      let result;
      try { result = await response.json(); }
      catch (_) { throw new Error('O serviço de acesso não respondeu corretamente. Confira a implantação do Apps Script.'); }
      if (!result || result.ok !== true) {
        const error = new Error(result?.error || 'Não foi possível verificar seu acesso.');
        error.code = result?.code;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('A solicitação demorou demais. Aguarde e tente novamente.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function validModules(modules) {
    if (!Array.isArray(modules)) throw new Error('Lista de permissões inválida.');
    const ids = new Set();
    for (const module of modules) {
      if (!module || typeof module.id !== 'string' || typeof module.restricted !== 'boolean' || ids.has(module.id)) {
        throw new Error('Lista de permissões inválida. Solicite a revisão do responsável.');
      }
      ids.add(module.id);
    }
    return modules;
  }

  function applyResult(result, authenticated) {
    const modules = validModules(result.modules);
    if (authenticated && (!result.user || typeof result.user.email !== 'string' || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now())) {
      throw new Error('Resposta de autenticação inválida.');
    }
    state.modules = modules;
    state.user = authenticated ? result.user : null;
    state.expiresAt = authenticated ? result.expiresAt : 0;
    state.checkedAt = Date.now();
    state.error = '';
  }

  function access(moduleId) {
    if (publicModuleIds.has(moduleId)) return { allowed: true, restricted: false, message: 'Acesso livre' };
    const module = state.modules.find(item => item.id === moduleId);
    if (module?.restricted === false) return { allowed: true, restricted: false, message: 'Acesso livre' };
    if (state.loading) return { allowed: false, restricted: true, loading: true, message: 'Consultando acesso...' };
    if (!configured) return { allowed: false, restricted: true, message: 'Acesso restrito · login em configuração' };
    const fresh = state.checkedAt > 0 && Date.now() - state.checkedAt <= 75000;
    if (fresh && !module) return { allowed: false, restricted: true, message: 'Acesso restrito · aguarda configuração do responsável' };
    if (!fresh) return { allowed: false, restricted: true, message: state.error ? 'Não foi possível verificar o acesso' : 'Verificando restrição de acesso...' };
    if (!module.restricted) return { allowed: true, restricted: false, message: 'Acesso livre' };
    if (!state.user || !token || state.expiresAt <= Date.now()) return { allowed: false, restricted: true, message: 'Acesso restrito · entre para solicitar liberação' };
    if (module.allowed === true && module.status === 'APROVADO') return { allowed: true, restricted: true, message: 'Acesso aprovado' };
    return {
      allowed: false, restricted: true,
      message: module.status === 'NEGADO' ? 'Acesso não autorizado pelo responsável' : 'Aguardando aprovação do responsável'
    };
  }

  function emit() {
    renderAccount();
    window.dispatchEvent(new CustomEvent('spx-auth-change'));
  }

  function refresh(force = false) {
    if (refreshPromise && !force) return refreshPromise;
    const currentEpoch = epoch;
    const sequence = ++requestSequence;
    const currentToken = token;
    state.loading = true;
    emit();
    const promise = (async () => {
      try {
        const result = await api(currentToken ? 'session' : 'policy', currentToken ? { token: currentToken } : {});
        if (epoch !== currentEpoch || sequence !== requestSequence) return false;
        applyResult(result, Boolean(currentToken));
        return true;
      } catch (error) {
        if (epoch !== currentEpoch || sequence !== requestSequence) return false;
        state.modules = [];
        state.checkedAt = 0;
        state.error = error.message;
        if (['SESSION_EXPIRED', 'ACCOUNT_BLOCKED'].includes(error.code)) {
          saveToken('');
          state.user = null;
          state.expiresAt = 0;
        }
        return false;
      } finally {
        if (epoch === currentEpoch && sequence === requestSequence) {
          state.loading = false;
          emit();
        }
      }
    })();
    refreshPromise = promise;
    promise.finally(() => { if (refreshPromise === promise) refreshPromise = null; });
    return promise;
  }

  async function authorize(moduleId) {
    if (access(moduleId).restricted === false) return true;
    if (state.loading) return false;
    const valid = await refresh(true);
    const permission = access(moduleId);
    if (!valid || !permission.allowed) {
      if (!state.user) openLogin();
      return false;
    }
    return true;
  }

  function renderAccount() {
    const label = document.getElementById('authIdentity');
    const bar = document.querySelector('.auth-bar');
    bar.classList.toggle('is-loading', state.loading);
    bar.setAttribute('aria-busy', String(state.loading));
    bar.inert = state.loading;
    label.textContent = state.loading ? 'Consultando autenticação...' : state.user ? state.user.email : 'Entre para solicitar acesso aos módulos restritos';
    account.textContent = state.user ? 'Sair' : 'Entrar';
    account.disabled = !configured || state.loading;
    document.getElementById('authCheck').disabled = state.loading;
    document.getElementById('authCheck').hidden = !state.user;
    const message = document.getElementById('authMessage');
    message.textContent = state.loading ? 'Aguarde enquanto verificamos sua sessão e permissões.' : state.error || (state.user ? 'Suas permissões são atualizadas automaticamente.' : 'Os módulos restritos precisam de aprovação.');
    message.classList.toggle('has-error', Boolean(state.error));
  }

  function openLogin() {
    if (state.loading) return;
    previousFocus = document.activeElement;
    loginAttempt += 1;
    codeEmail = '';
    codeInput.value = '';
    codeInput.required = false;
    document.getElementById('authCodeGroup').hidden = true;
    emailInput.readOnly = false;
    nameInput.readOnly = false;
    resend.hidden = true;
    feedback.textContent = configured ? 'Informe seu e-mail para receber um código de acesso.' : 'O responsável ainda precisa configurar o serviço de login.';
    submit.textContent = 'Enviar código';
    submit.disabled = !configured;
    if (!panel.open) panel.showModal();
    emailInput.focus();
  }

  function closeLogin() {
    loginAttempt += 1;
    panel.close();
    previousFocus?.focus?.();
  }

  function setBusy(value) {
    busy = value;
    submit.disabled = value || !configured;
    resend.disabled = value || Date.now() < retryAt;
    emailInput.disabled = value;
    nameInput.disabled = value;
    codeInput.disabled = value;
  }

  async function requestCode() {
    const attempt = loginAttempt;
    const email = emailInput.value.trim().toLowerCase();
    if (!emailInput.reportValidity()) return;
    setBusy(true);
    feedback.textContent = 'Enviando código...';
    try {
      const result = await api('request_code', { email });
      if (attempt !== loginAttempt) return;
      codeEmail = email;
      codeInput.required = true;
      retryAt = Date.now() + Number(result.retryAfter || 60) * 1000;
      emailInput.readOnly = true;
      nameInput.readOnly = true;
      document.getElementById('authCodeGroup').hidden = false;
      resend.hidden = false;
      submit.textContent = 'Entrar';
      feedback.textContent = 'Código enviado. Confira sua caixa de entrada e o spam.';
    } catch (error) {
      if (attempt === loginAttempt) feedback.textContent = error.message;
    } finally {
      setBusy(false);
      if (attempt === loginAttempt && codeEmail) codeInput.focus();
    }
  }

  async function verifyCode() {
    const attempt = loginAttempt;
    const currentEpoch = epoch;
    if (!codeInput.reportValidity()) return;
    setBusy(true);
    feedback.textContent = 'Validando código...';
    try {
      const result = await api('verify_code', { email: codeEmail, code: codeInput.value.trim(), name: nameInput.value.trim() });
      if (attempt !== loginAttempt || currentEpoch !== epoch) return;
      if (!/^[a-f0-9]{64}$/.test(result.token || '')) throw new Error('Sessão inválida.');
      applyResult(result, true);
      state.loading = false;
      epoch += 1;
      saveToken(result.token);
      closeLogin();
      emit();
    } catch (error) {
      if (attempt === loginAttempt) feedback.textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const previousToken = token;
    epoch += 1;
    loginAttempt += 1;
    saveToken('');
    state.user = null;
    state.modules = [];
    state.checkedAt = 0;
    state.expiresAt = 0;
    state.error = '';
    emit();
    if (previousToken) {
      try { await api('logout', { token: previousToken }); }
      catch (_) { state.error = 'Sessão encerrada neste navegador. A sessão remota expirará automaticamente.'; emit(); }
    }
    void refresh(true);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    if (codeEmail) void verifyCode();
    else void requestCode();
  });
  resend.addEventListener('click', () => {
    if (!busy && Date.now() >= retryAt) void requestCode();
  });
  account.addEventListener('click', () => { if (state.user) void logout(); else openLogin(); });
  document.getElementById('authClose').addEventListener('click', closeLogin);
  document.getElementById('authCheck').addEventListener('click', () => { void refresh(true); });
  panel.addEventListener('cancel', event => { event.preventDefault(); closeLogin(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('focus', () => { void refresh(); });
  setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
  setInterval(() => {
    if (!resend.hidden) {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      resend.disabled = busy || remaining > 0;
      resend.textContent = remaining ? 'Reenviar em ' + remaining + 's' : 'Reenviar código';
    }
  }, 1000);

  window.addEventListener('storage', event => {
    if (event.key !== SESSION_KEY && event.key !== null) return;
    const nextToken = event.key === null ? '' : event.newValue || '';
    if (nextToken && !/^[a-f0-9]{64}$/.test(nextToken)) return;
    if (nextToken === token) return;
    epoch += 1;
    loginAttempt += 1;
    token = nextToken;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    state.user = null;
    state.modules = [];
    state.checkedAt = 0;
    state.expiresAt = 0;
    state.error = '';
    emit();
    void refresh(true);
  });

  window.HubAuth = Object.freeze({ access, authorize, refresh, openLogin });
  renderAccount();
  void refresh();
})();
