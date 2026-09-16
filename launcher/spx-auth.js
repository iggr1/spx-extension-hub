(function initializeSpxAuth() {
  'use strict';

  try { localStorage.removeItem('spx-hub-auth-session-v1'); } catch (_) {}
  try { sessionStorage.removeItem('spx-hub-auth-session-v1'); } catch (_) {}

  function access(id) {
    if (id === 'spx-dock-flow' || id === 'catalogo-de-etiquetas') {
      return { allowed: true, restricted: false, loading: false, message: 'Acesso liberado.' };
    }
    if (id === 'assistente-de-devolucoes') {
      return { allowed: true, restricted: false, loading: false, message: '' };
    }
    return { allowed: false, restricted: true, loading: false, message: 'Módulo sem regra de acesso configurada.' };
  }

  function emit() {
    window.dispatchEvent(new CustomEvent('spx-auth-change'));
  }

  function refresh() {
    emit();
    return Promise.resolve(true);
  }

  async function authorize(id) {
    return access(id).allowed;
  }

  window.HubAuth = Object.freeze({ access, authorize, refresh });
  emit();
})();
