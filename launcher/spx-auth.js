(function initializeSpxAuth() {
  'use strict';
  const LOG_PREFIX = '[SPX Hub Auth]';
  const log = (message, data) => data === undefined ? console.log(`${LOG_PREFIX} ${message}`) : console.log(`${LOG_PREFIX} ${message}`, data);

  try { localStorage.removeItem('spx-hub-auth-session-v1'); } catch (_) {}
  try { sessionStorage.removeItem('spx-hub-auth-session-v1'); } catch (_) {}

  const ASSISTANT_MESSAGE = 'Validação feita dentro do SPX: exige e-mail @shopee.com e permissões RESOLVE_EO + CANCEL_EO_REASON.';

  function access(id) {
    if (id === 'spx-dock-flow') {
      return { allowed: true, restricted: false, loading: false, message: 'Acesso livre' };
    }
    if (id === 'assistente-de-devolucoes') {
      return { allowed: true, restricted: false, loading: false, message: ASSISTANT_MESSAGE };
    }
    return { allowed: false, restricted: true, loading: false, message: 'Módulo sem regra de acesso configurada.' };
  }

  function emit() {
    const bar = document.querySelector('.auth-bar');
    if (bar) {
      bar.classList.remove('is-loading');
      bar.inert = false;
      bar.setAttribute('aria-busy', 'false');
    }
    const identity = document.getElementById('authIdentity');
    const message = document.getElementById('authMessage');
    const check = document.getElementById('authCheck');
    const account = document.getElementById('authAccount');
    if (identity) identity.textContent = 'Acesso validado dentro do SPX';
    if (message) message.textContent = 'O catálogo não consulta a sessão. Cada módulo protegido valida a conta diretamente na página SPX.';
    if (check) check.hidden = true;
    if (account) account.disabled = false;
    window.dispatchEvent(new CustomEvent('spx-auth-change'));
  }

  function refresh() {
    log('Validação no catálogo desativada; o módulo protegido valida a sessão diretamente no SPX.');
    emit();
    return Promise.resolve(true);
  }

  async function authorize(id) {
    return access(id).allowed;
  }

  const checkButton = document.getElementById('authCheck');
  if (checkButton) checkButton.addEventListener('click', refresh);

  const accountButton = document.getElementById('authAccount');
  if (accountButton) {
    accountButton.addEventListener('click', () => {
      window.open('https://spx.shopee.com.br/', '_blank', 'noopener,noreferrer');
    });
  }

  window.HubAuth = Object.freeze({ access, authorize, refresh });
  emit();
})();
