const PDFJS_MODULE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const USER_SCRIPT_SWITCH_MIN_LOADER_VERSION = '1.1.0';
const SUSPENDED_MODULES = new Set(['importador-de-planilhas']);

const MODULE_ICON_PATHS = Object.freeze({
  'spx-dock-flow': '<path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-5l-3-5h-5"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  'spx-dock-flow-autoadd': '<circle cx="6" cy="19" r="2"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="2"/>',
  'assistente-de-devolucoes': '<path d="m12 2 8 4.5v10L12 21l-8-4.5v-10L12 2Z"/><path d="m4 6.5 8 4.5 8-4.5"/><path d="M12 11v10"/><path d="M17.5 14.5h-4a2.5 2.5 0 0 0 0 5h2"/><path d="m15 17.5 2.5 2-2.5 2"/>'
});

const ACCESS_ICONS = Object.freeze({
  open: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  closed: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
});

function moduleSvg(paths) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}

function renderModuleIcon(module) {
  const paths = MODULE_ICON_PATHS[module.id];
  return paths ? moduleSvg(paths) : escapeHtml(module.name.slice(0, 2).toUpperCase());
}

function renderModuleAccess(module, permission) {
  if (module.id === 'assistente-de-devolucoes') {
    return '<div class="module-access is-limited" role="status" title="Uso condicionado às permissões da conta SPX">' +
      moduleSvg(ACCESS_ICONS.closed) + '<span>Acesso restrito à analistas.</span></div>';
  }
  if (permission.loading) {
    return '<div class="module-access is-loading" role="status"><span class="access-spinner" aria-hidden="true"></span><span>Verificando acesso...</span></div>';
  }
  return '<div class="module-access ' + (permission.allowed ? 'is-approved' : 'is-locked') + '" role="status">' +
    moduleSvg(permission.allowed ? ACCESS_ICONS.open : ACCESS_ICONS.closed) +
    '<span>' + escapeHtml(permission.allowed ? 'Acesso liberado.' : permission.message) + '</span></div>';
}


const grid = document.getElementById('moduleGrid');
const status = document.getElementById('status');
const loaderVersion = document.getElementById('loaderVersion');
const workspace = document.getElementById('workspace');
const descriptionSidebar = document.getElementById('descriptionSidebar');
const descriptionTitle = document.getElementById('descriptionTitle');
const descriptionViewer = document.getElementById('descriptionViewer');
const descriptionLoading = document.getElementById('descriptionLoading');
const descriptionError = document.getElementById('descriptionError');
const descriptionToolbar = document.getElementById('descriptionToolbar');
const descriptionPageCount = document.getElementById('descriptionPageCount');
const openPdfButton = document.getElementById('openPdfButton');
const closeDescriptionButton = document.getElementById('closeDescriptionButton');

let activeDescriptionModuleId = null;
let activePdfUrl = null;
let pdfJsPromise = null;
let pdfRenderToken = 0;
let currentModules = [];
let currentLoaderVersion = '0.0.0';
const userScriptStates = new Map();
let userScriptStatusGeneration = 0;

document.getElementById('refreshButton').addEventListener('click', () => loadModules(true));
document.getElementById('updateLoaderButton').addEventListener('click', () => {
  const dialog = document.getElementById('loaderUpdateDialog');
  const frame = dialog.querySelector('iframe');
  if (!frame.getAttribute('src')) frame.src = 'atualizar-loader.html';
  dialog.showModal();
});
closeDescriptionButton.addEventListener('click', closeDescription);
openPdfButton.addEventListener('click', () => {
  if (activePdfUrl) window.open(activePdfUrl, '_blank', 'noopener,noreferrer');
});
window.addEventListener('spx-auth-change', renderModules);
loadModules(false);

async function loadModules(forceRefresh) {
  userScriptStatusGeneration++;
  status.textContent = 'Atualizando catálogo...';

  try {
    const [catalogResponse, loaderResponse] = await Promise.all([
      LoaderBridge.request(forceRefresh ? 'catalog.refresh' : 'catalog.get'),
      LoaderBridge.request('loader.info')
    ]);

    if (!catalogResponse?.ok) {
      throw new Error(catalogResponse?.error || 'Catálogo indisponível.');
    }

    currentLoaderVersion = loaderResponse?.ok ? String(loaderResponse.version || '0.0.0') : '0.0.0';
    currentModules = catalogResponse.catalog.modules
      .filter(module => module.enabled && !SUSPENDED_MODULES.has(module.id))
      .map(module => ({
        ...module,
        descriptionPdf: resolveDescriptionPdf(module)
      }));

    renderModules();
    status.textContent = `${currentModules.length} módulo(s) disponível(is)`;
    loaderVersion.textContent = loaderResponse?.ok ? `Loader ${currentLoaderVersion}` : '';

    if (activeDescriptionModuleId && !currentModules.some(module => module.id === activeDescriptionModuleId)) {
      closeDescription();
    }

    await Promise.all([loadUserScriptStates(), HubAuth.refresh()]);
    for (const id of SUSPENDED_MODULES) {
      if (!catalogResponse.catalog.modules.some(module => module.id === id)) continue;
      const state = await LoaderBridge.requestForModule(id, 'userscripts.status');
      if (state?.ok && (state.enabled || state.registered)) {
        const result = await LoaderBridge.requestForModule(id, 'userscripts.setEnabled', { enabled: false });
        if (!result?.ok) status.textContent += ' · Atualize o loader para concluir a desativação do Importador de Planilhas.';
      }
    }
  } catch (error) {
    status.textContent = normalizeSwitchError(error);
    grid.innerHTML = '<div class="empty">Não foi possível carregar a lista de módulos.</div>';
  }
}

function renderModules() {
  if (!currentModules.length) {
    grid.innerHTML = '<div class="empty">Nenhum módulo está publicado no momento.</div>';
    return;
  }

  grid.innerHTML = currentModules.map(module => {
    const hasDescription = Boolean(module.descriptionPdf);
    const isDescriptionActive = activeDescriptionModuleId === module.id;
    const descriptionAction = renderDescriptionAction(module, hasDescription, isDescriptionActive);
    const permission = HubAuth.access(module.id);
    const actions = !permission.allowed
      ? `${descriptionAction}<button type="button" disabled title="${escapeHtml(permission.message)}">Bloqueado</button><button type="button" data-access-id="${escapeHtml(module.id)}">Verificar acesso</button>${module.type === 'user_script' && userScriptStates.get(module.id)?.enabled ? `<button type="button" data-disable-id="${escapeHtml(module.id)}">Desativar</button>` : ''}`
      : module.type === 'user_script'
      ? `${descriptionAction}${renderUserScriptSwitch(module)}`
      : `${descriptionAction}<button class="open-button" type="button" data-module-id="${escapeHtml(module.id)}">Abrir</button>`;

    return `
      <article class="module-card${permission.allowed ? '' : ' is-restricted'}${permission.loading ? ' is-loading' : ''}" aria-busy="${Boolean(permission.loading)}" ${permission.loading ? 'inert' : ''} data-module-card="${escapeHtml(module.id)}">
        <div class="module-icon">${renderModuleIcon(module)}</div>
        <h2>${escapeHtml(module.name)}</h2>
        <p>${escapeHtml(module.description || 'Módulo operacional publicado no hub.')}</p>
        ${renderModuleAccess(module, permission)}
        <div class="module-footer">
          <span class="module-version">v${escapeHtml(module.version)}</span>
          <div class="module-actions">${actions}</div>
        </div>
      </article>
    `;
  }).join('');

  const modulesById = new Map(currentModules.map(module => [module.id, module]));

  for (const button of grid.querySelectorAll('[data-module-id]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (await HubAuth.authorize(button.dataset.moduleId)) LoaderBridge.openModule(button.dataset.moduleId);
        else status.textContent = HubAuth.access(button.dataset.moduleId).message;
      } finally { renderModules(); }
    });
  }

  for (const button of grid.querySelectorAll('[data-access-id]')) {
    button.addEventListener('click', async () => {
      await HubAuth.authorize(button.dataset.accessId);
      status.textContent = HubAuth.access(button.dataset.accessId).message;
    });
  }
  for (const button of grid.querySelectorAll('[data-disable-id]')) {
    button.addEventListener('click', () => {
      const module = modulesById.get(button.dataset.disableId);
      if (module) void toggleUserScript(module, false);
    });
  }

  for (const button of grid.querySelectorAll('[data-description-id]')) {
    button.addEventListener('click', () => {
      const module = modulesById.get(button.dataset.descriptionId);
      if (module) openDescription(module);
    });
  }

  for (const input of grid.querySelectorAll('[data-user-script-toggle]')) {
    input.addEventListener('change', () => {
      const module = modulesById.get(input.dataset.userScriptToggle);
      if (module) toggleUserScript(module, input.checked);
    });
  }
}

function renderDescriptionAction(module, hasDescription, isDescriptionActive) {
  return `
    <button
      class="description-button${isDescriptionActive ? ' is-active' : ''}"
      type="button"
      data-description-id="${escapeHtml(module.id)}"
      aria-pressed="${isDescriptionActive}"
      ${hasDescription ? '' : 'disabled title="PDF de descrição não publicado"'}
    >Descrição</button>
  `;
}

function renderUserScriptSwitch(module) {
  const state = userScriptStates.get(module.id) || {
    loading: true,
    enabled: false,
    message: 'Consultando estado do módulo...'
  };
  const loaderSupported = compareVersions(currentLoaderVersion, USER_SCRIPT_SWITCH_MIN_LOADER_VERSION) >= 0;
  const disabled = state.loading || state.busy || state.unavailable || !loaderSupported;
  const message = !loaderSupported
    ? `Clique em “Atualizar loader” no topo para instalar a versão atual.`
    : state.message || (state.enabled ? activeScriptMessage(module) : 'Desativado.');

  return `
    <label class="module-toggle${state.enabled ? ' is-enabled' : ''}${state.error ? ' has-error' : ''}">
      <input
        type="checkbox"
        data-user-script-toggle="${escapeHtml(module.id)}"
        ${state.enabled ? 'checked' : ''}
        ${disabled ? 'disabled' : ''}
        aria-label="Ligar ou desligar ${escapeHtml(module.name)}"
      >
      <span class="module-toggle-track" aria-hidden="true"><span></span></span>
      <span class="module-toggle-copy">
        <strong>${state.busy ? 'Aplicando...' : state.enabled ? 'Ligado' : 'Desligado'}</strong>
        <small>${escapeHtml(message)}</small>
      </span>
    </label>
  `;
}

function waitForUserScriptStatus(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function loadUserScriptStates() {
  const modules = currentModules.filter(module => module.type === 'user_script');
  if (!modules.length) return;
  const generation = ++userScriptStatusGeneration;

  if (compareVersions(currentLoaderVersion, USER_SCRIPT_SWITCH_MIN_LOADER_VERSION) < 0) {
    for (const module of modules) {
      userScriptStates.set(module.id, {
        enabled: false,
        unavailable: true,
        message: 'Clique em “Atualizar loader” no topo para instalar a versão atual.'
      });
    }
    renderModules();
    return;
  }

  await Promise.all(modules.map(async module => {
    const original = userScriptStates.get(module.id);
    if (!original?.busy) {
      userScriptStates.set(module.id, {
        ...original,
        loading: true,
        unavailable: false,
        error: false,
        message: 'Verificando estado dos scripts...'
      });
    }
    renderModules();

    for (let attempt = 0; attempt < 4; attempt++) {
      if (generation !== userScriptStatusGeneration) return;
      try {
        const response = await LoaderBridge.requestForModule(module.id, 'userscripts.status');
        if (!response?.ok) throw new Error(response?.error || 'Não foi possível consultar o estado do módulo.');
        if (generation !== userScriptStatusGeneration || userScriptStates.get(module.id)?.busy) return;
        userScriptStates.set(module.id, {
          enabled: response.enabled === true,
          registered: response.registered === true,
          message: response.enabled ? activeScriptMessage(module) : 'Desativado.'
        });
        renderModules();
        return;
      } catch (error) {
        if (generation !== userScriptStatusGeneration) return;
        if (attempt < 3) {
          await waitForUserScriptStatus([400, 950, 1850][attempt]);
          continue;
        }
        if (userScriptStates.get(module.id)?.busy) return;
        userScriptStates.set(module.id, {
          ...original,
          enabled: original?.enabled === true,
          unavailable: true,
          error: true,
          loading: false,
          message: 'Não foi possível confirmar o estado. Clique em “Atualizar lista” para tentar novamente.'
        });
        renderModules();
      }
    }
  }));
}

async function toggleUserScript(module, enabled) {
  if (userScriptStates.get(module.id)?.busy) return;
  const original = userScriptStates.get(module.id) || { enabled: false };
  userScriptStates.set(module.id, { ...original, busy: true });
  if (enabled && !(await HubAuth.authorize(module.id))) {
    userScriptStates.set(module.id, original);
    status.textContent = HubAuth.access(module.id).message;
    renderModules();
    return;
  }
  const previous = original;
  userScriptStates.set(module.id, {
    ...previous,
    enabled,
    busy: true,
    error: false,
    message: enabled ? 'Ativando e recarregando páginas compatíveis...' : 'Desativando e recarregando páginas compatíveis...'
  });
  renderModules();

  try {
    const response = await LoaderBridge.requestForModule(
      module.id,
      'userscripts.setEnabled',
      { enabled }
    );

    if (!response?.ok) {
      throw new Error(response?.error || 'Não foi possível alterar o módulo.');
    }

    userScriptStates.set(module.id, {
      enabled: response.enabled === true,
      registered: response.registered === true,
      message: response.enabled
        ? `Ligado. ${formatReloadedTabs(response.reloadedTabs, module)}`
        : `Desligado. ${formatReloadedTabs(response.reloadedTabs, module)}`
    });
    status.textContent = `${module.name} ${enabled ? 'ativado' : 'desativado'} com sucesso.`;
  } catch (error) {
    userScriptStates.set(module.id, {
      ...previous,
      busy: false,
      error: true,
      message: normalizeSwitchError(error)
    });
    status.textContent = normalizeSwitchError(error);
  }

  renderModules();
}

function activeScriptMessage(module) {
  return module.id === 'importador-de-planilhas' ? 'Ativo no Google Sheets.' : 'Ativo nas páginas compatíveis do SPX.';
}

function formatReloadedTabs(value, module) {
  const count = Number(value || 0);
  if (module?.id === 'importador-de-planilhas') {
    return count ? `${count} página${count === 1 ? '' : 's'} compatível${count === 1 ? '' : 'is'} recarregada${count === 1 ? '' : 's'}.` : 'Abra ou recarregue o Google Sheets para aplicar.';
  }
  if (!count) return 'Abra ou recarregue a página de recebimento para aplicar.';
  return `${count} aba${count === 1 ? '' : 's'} do SPX recarregada${count === 1 ? '' : 's'}.`;
}

function normalizeSwitchError(error) {
  const message = String(error?.message || error || 'Falha desconhecida.');
  const guidance = 'Clique em “Atualizar loader” no topo, substitua os arquivos e recarregue a extensão.';
  if (/permissões necessárias|acesso não possa ser liberado|launcher não pode|capability/i.test(message)) {
    return `O módulo não pôde ser iniciado. ${guidance}`;
  }
  return `${message} ${guidance}`;
}

function compareVersions(left, right) {
  const a = String(left || '').split('.').map(value => Number.parseInt(value, 10) || 0);
  const b = String(right || '').split('.').map(value => Number.parseInt(value, 10) || 0);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }

  return 0;
}

function resolveDescriptionPdf(module) {
  const configuredPdf = String(module.descriptionPdf || '').trim();
  if (configuredPdf) return configuredPdf;

  try {
    if (module.type === 'web_app' && module.entry) {
      return new URL('descricao.pdf', module.entry).toString();
    }
    if (module.type === 'user_script') {
      return new URL(`../modules/${encodeURIComponent(module.id)}/descricao.pdf`, window.location.href).toString();
    }
    return '';
  } catch {
    return '';
  }
}

async function openDescription(module) {
  if (!module.descriptionPdf) return;

  let pdfUrl;

  try {
    pdfUrl = new URL(module.descriptionPdf, window.location.href);
    if (pdfUrl.protocol !== 'https:') {
      throw new Error('O PDF precisa usar HTTPS.');
    }
  } catch (error) {
    showDescriptionError(module.name, error.message);
    return;
  }

  const renderToken = ++pdfRenderToken;
  activeDescriptionModuleId = module.id;
  activePdfUrl = pdfUrl.toString();
  descriptionTitle.textContent = module.name;
  descriptionError.hidden = true;
  descriptionLoading.hidden = false;
  descriptionToolbar.hidden = true;
  descriptionViewer.replaceChildren();

  workspace.classList.add('is-description-open');
  descriptionSidebar.setAttribute('aria-hidden', 'false');
  syncDescriptionButtons();

  pdfUrl.searchParams.set('moduleVersion', module.version || 'latest');

  try {
    const pdfJs = await loadPdfJs();
    if (renderToken !== pdfRenderToken) return;

    const loadingTask = pdfJs.getDocument({
      url: pdfUrl.toString(),
      withCredentials: false
    });
    const pdf = await loadingTask.promise;
    if (renderToken !== pdfRenderToken) {
      await pdf.destroy();
      return;
    }

    descriptionPageCount.textContent = `${pdf.numPages} página${pdf.numPages === 1 ? '' : 's'}`;
    descriptionToolbar.hidden = false;
    descriptionLoading.hidden = true;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (renderToken !== pdfRenderToken) break;
      await renderPdfPage(pdf, pageNumber, renderToken);
    }
  } catch (error) {
    if (renderToken !== pdfRenderToken) return;
    showDescriptionError(
      module.name,
      error?.message || 'Não foi possível carregar o PDF deste módulo.'
    );
  }
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(PDFJS_MODULE_URL).then(pdfJs => {
      pdfJs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfJs;
    });
  }

  return pdfJsPromise;
}

async function renderPdfPage(pdf, pageNumber, renderToken) {
  const page = await pdf.getPage(pageNumber);
  if (renderToken !== pdfRenderToken) return;

  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(280, descriptionViewer.clientWidth - 28);
  const cssScale = availableWidth / baseViewport.width;
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  const renderViewport = page.getViewport({ scale: cssScale * outputScale });

  const pageElement = document.createElement('section');
  pageElement.className = 'pdf-page';

  const pageLabel = document.createElement('span');
  pageLabel.className = 'pdf-page-label';
  pageLabel.textContent = `Página ${pageNumber}`;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  canvas.style.width = `${Math.floor(baseViewport.width * cssScale)}px`;
  canvas.style.height = `${Math.floor(baseViewport.height * cssScale)}px`;

  pageElement.append(pageLabel, canvas);
  descriptionViewer.append(pageElement);

  const context = canvas.getContext('2d', { alpha: false });
  await page.render({
    canvasContext: context,
    viewport: renderViewport
  }).promise;
}

function showDescriptionError(moduleName, message) {
  pdfRenderToken += 1;
  activePdfUrl = null;
  descriptionTitle.textContent = moduleName || 'Descrição';
  descriptionLoading.hidden = true;
  descriptionToolbar.hidden = true;
  descriptionError.hidden = false;
  descriptionError.textContent = message || 'Não foi possível abrir a descrição deste módulo.';
  descriptionViewer.replaceChildren();
  workspace.classList.add('is-description-open');
  descriptionSidebar.setAttribute('aria-hidden', 'false');
  syncDescriptionButtons();
}

function closeDescription() {
  pdfRenderToken += 1;
  activeDescriptionModuleId = null;
  activePdfUrl = null;
  workspace.classList.remove('is-description-open');
  descriptionSidebar.setAttribute('aria-hidden', 'true');
  descriptionTitle.textContent = 'Descrição';
  descriptionLoading.hidden = false;
  descriptionError.hidden = true;
  descriptionToolbar.hidden = true;
  descriptionViewer.replaceChildren();
  syncDescriptionButtons();
}

function syncDescriptionButtons() {
  for (const button of grid.querySelectorAll('[data-description-id]')) {
    const isActive = button.dataset.descriptionId === activeDescriptionModuleId;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
}

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = String(value || '');
  return element.innerHTML;
}
