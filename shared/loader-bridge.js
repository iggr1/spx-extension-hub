(function initializeLoaderBridge() {
  const CHANNEL = 'spx-extension-loader';
  const moduleId = new URLSearchParams(location.search).get('loaderModule') || 'launcher';
  const pending = new Map();
  let sequence = 0;

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== 'BRIDGE_RESPONSE') return;
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    request.resolve(message.response);
  });

  function request(operation, payload = {}) {
    return new Promise((resolve, reject) => {
      if (window.parent === window) {
        reject(new Error('Este módulo precisa ser aberto pelo SPX Extension Loader.'));
        return;
      }

      const requestId = `${Date.now()}-${++sequence}`;
      const timeout = window.setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('O loader não respondeu à solicitação do módulo.'));
      }, 60000);

      pending.set(requestId, {
        resolve(response) {
          window.clearTimeout(timeout);
          resolve(response);
        }
      });

      window.parent.postMessage({
        channel: CHANNEL,
        type: 'BRIDGE_REQUEST',
        requestId,
        moduleId,
        operation,
        payload
      }, '*');
    });
  }

  function openModule(targetModuleId) {
    window.parent.postMessage({
      channel: CHANNEL,
      type: 'OPEN_MODULE',
      moduleId: targetModuleId
    }, '*');
  }

  function openLauncher() {
    window.parent.postMessage({
      channel: CHANNEL,
      type: 'OPEN_LAUNCHER'
    }, '*');
  }

  window.LoaderBridge = Object.freeze({
    moduleId,
    request,
    openModule,
    openLauncher
  });
})();
