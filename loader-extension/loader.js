const CHANNEL = 'spx-extension-loader';
const SUPPORT_EMAIL = 'igor.camara@shopee.com';

const frame = document.getElementById('moduleFrame');
const state = document.getElementById('loaderState');
const stateTitle = document.getElementById('stateTitle');
const stateMessage = document.getElementById('stateMessage');
const stateActions = document.getElementById('stateActions');
const retryButton = document.getElementById('retryButton');
const optionsButton = document.getElementById('optionsButton');
const permissionDialog = document.getElementById('permissionDialog');
const permissionMessage = document.getElementById('permissionMessage');
const permissionList = document.getElementById('permissionList');
const permissionConfirm = document.getElementById('permissionConfirm');
const permissionCancel = document.getElementById('permissionCancel');

let bootstrap = null;
let activeModule = null;
let expectedOrigin = null;
let pendingPermission = null;

retryButton.addEventListener('click', () => initialize(true));
optionsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());
permissionCancel.addEventListener('click', closePermissionDialog);
permissionConfirm.addEventListener('click', grantPendingPermission);
frame.addEventListener('load', () => state.classList.add('hidden'));
window.addEventListener('message', handleFrameMessage);

initialize(false);

async function initialize(forceRefresh) {
  showState('Carregando catálogo', 'Consultando os módulos publicados no GitHub.', false);
  const response = await sendRuntimeMessage({ type: 'LOADER_BOOTSTRAP', forceRefresh });

  if (!response?.ok) {
    showState('Não foi possível carregar o catálogo', `${response?.error || 'Falha desconhecida.'} Verifique o repositório configurado.`, true);
    return;
  }

  bootstrap = response;
  const requestedModule = new URLSearchParams(location.search).get('module');
  if (requestedModule) {
    await openModule(requestedModule);
    return;
  }

  loadRemotePage(response.catalog.launcher.url, null);
}

async function handleFrameMessage(event) {
  if (event.source !== frame.contentWindow || event.origin !== expectedOrigin) return;
  const message = event.data;
  if (!message || message.channel !== CHANNEL) return;

  if (message.type === 'OPEN_MODULE') {
    await openModule(message.moduleId);
    return;
  }

  if (message.type === 'OPEN_LAUNCHER') {
    activeModule = null;
    loadRemotePage(bootstrap.catalog.launcher.url, null);
    return;
  }

  if (message.type === 'BRIDGE_REQUEST') {
    const requestedModuleId = activeModule?.id || String(message.moduleId || 'launcher');
    const launcherCanTargetModule = !activeModule &&
      requestedModuleId !== 'launcher' &&
      ['userscripts.status', 'userscripts.setEnabled'].includes(String(message.operation || ''));

    const response = (!activeModule && requestedModuleId !== 'launcher' && !launcherCanTargetModule)
      ? { ok: false, error: 'O launcher não pode executar esta operação para outro módulo.' }
      : await sendRuntimeMessage({
          type: 'LOADER_BRIDGE_REQUEST',
          moduleId: requestedModuleId,
          operation: message.operation,
          payload: message.payload
        });

    frame.contentWindow.postMessage({
      channel: CHANNEL,
      type: 'BRIDGE_RESPONSE',
      requestId: message.requestId,
      response
    }, expectedOrigin);
  }
}

async function openModule(moduleId) {
  const latestBootstrap = await sendRuntimeMessage({ type: 'LOADER_BOOTSTRAP', forceRefresh: false });
  if (latestBootstrap?.ok) bootstrap = latestBootstrap;

  const module = bootstrap.catalog.modules.find(item => item.id === moduleId && item.enabled);
  if (!module) {
    showState('Módulo indisponível', 'O módulo solicitado não existe ou foi desativado no catálogo.', true);
    return;
  }

  const requirements = await sendRuntimeMessage({ type: 'LOADER_MODULE_REQUIREMENTS', moduleId });
  if (!requirements?.ok) {
    showState('Falha ao verificar permissões', requirements?.error || 'Não foi possível verificar as permissões.', true);
    return;
  }

  if (!requirements.requestable) {
    showState('Atualização do loader necessária', requirements.contactMessage || `Contate ${SUPPORT_EMAIL} para atualizar as permissões da extensão.`, true);
    return;
  }

  if (!requirements.granted) {
    pendingPermission = { module, requirements };
    permissionMessage.textContent = 'Este módulo precisa de acesso adicional do Chrome antes de ser iniciado.';
    permissionList.textContent = [
      ...module.permissions.map(item => `API: ${item}`),
      ...module.hostPermissions.map(item => `Site: ${item}`)
    ].join('\n') || 'Permissões adicionais declaradas pelo módulo.';
    permissionDialog.classList.remove('hidden');
    return;
  }

  activeModule = module;
  if (module.type === 'user_script') {
    const response = await bridgeRequest(module.id, 'userscripts.setEnabled', { enabled: true });
    if (!response?.ok) {
      showState('Não foi possível ativar o módulo', response?.error || `Contate ${SUPPORT_EMAIL}.`, true);
      return;
    }
    activeModule = null;
    loadRemotePage(bootstrap.catalog.launcher.url, null);
    return;
  }

  loadRemotePage(module.entry, module.id);
}

async function grantPendingPermission() {
  if (!pendingPermission) return;
  const { module } = pendingPermission;

  try {
    const granted = await chrome.permissions.request({
      permissions: module.permissions,
      origins: module.hostPermissions
    });

    closePermissionDialog();
    if (!granted) {
      showState('Permissão não concedida', `O módulo não pode ser iniciado sem esse acesso. Em caso de dúvida, contate ${SUPPORT_EMAIL}.`, true);
      return;
    }

    await openModule(module.id);
  } catch (error) {
    closePermissionDialog();
    showState('Atualização do loader necessária', `${error.message || error} Entre em contato com ${SUPPORT_EMAIL}.`, true);
  }
}

function closePermissionDialog() {
  pendingPermission = null;
  permissionDialog.classList.add('hidden');
}

function loadRemotePage(url, moduleId) {
  const parsed = new URL(url);
  parsed.searchParams.set('loaderModule', moduleId || 'launcher');
  parsed.searchParams.set('loaderVersion', bootstrap.loader.version);
  activeModule = moduleId ? bootstrap.catalog.modules.find(item => item.id === moduleId) : null;
  expectedOrigin = parsed.origin;

  // O launcher precisa ficar fora do sandbox para permitir que o visualizador
  // nativo de PDF do Chrome seja carregado dentro da sidebar de descrições.
  // Os módulos continuam isolados pelo sandbox original.
  if (moduleId) {
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups'
    );
  } else {
    frame.removeAttribute('sandbox');
  }

  showState('Abrindo módulo', activeModule?.name || bootstrap.catalog.name, false);
  frame.src = parsed.toString();
}

async function bridgeRequest(moduleId, operation, payload) {
  return sendRuntimeMessage({ type: 'LOADER_BRIDGE_REQUEST', moduleId, operation, payload });
}

function showState(title, message, showActions) {
  stateTitle.textContent = title;
  stateMessage.textContent = message;
  stateActions.classList.toggle('hidden', !showActions);
  state.classList.remove('hidden');
}

function sendRuntimeMessage(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}
