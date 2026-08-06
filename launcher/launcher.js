const PDFJS_MODULE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const USER_SCRIPT_SWITCH_MIN_LOADER_VERSION = '1.1.0';

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

document.getElementById('refreshButton').addEventListener('click', () => loadModules(true));
closeDescriptionButton.addEventListener('click', closeDescription);
openPdfButton.addEventListener('click', () => {
  if (activePdfUrl) window.open(activePdfUrl, '_blank', 'noopener,noreferrer');
});
loadModules(false);

async function loadModules(forceRefresh) {
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
      .filter(module => module.enabled)
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

    await loadUserScriptStates();
  } catch (error) {
    status.textContent = error.message || String(error);
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
    const actions = module.type === 'user_script'
      ? `${descriptionAction}${renderUserScriptSwitch(module)}`
      : `${descriptionAction}<button class="open-button" type="button" data-module-id="${escapeHtml(module.id)}">Abrir</button>`;

    return `
      <article class="module-card" data-module-card="${escapeHtml(module.id)}">
        <div class="module-icon">${escapeHtml(module.name.slice(0, 2).toUpperCase())}</div>
        <h2>${escapeHtml(module.name)}</h2>
        <p>${escapeHtml(module.description || 'Módulo operacional publicado no hub.')}</p>
        <div class="module-footer">
          <span class="module-version">v${escapeHtml(module.version)}</span>
          <div class="module-actions">${actions}</div>
        </div>
      </article>
    `;
  }).join('');

  const modulesById = new Map(currentModules.map(module => [module.id, module]));

  for (const button of grid.querySelectorAll('[data-module-id]')) {
    button.addEventListener('click', () => LoaderBridge.openModule(button.dataset.moduleId));
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
    ? `Atualize o loader para a versão ${USER_SCRIPT_SWITCH_MIN_LOADER_VERSION} ou superior.`
    : state.message || (state.enabled ? 'Ativo nas páginas compatíveis do SPX.' : 'Desativado.');

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

async function loadUserScriptStates() {
  const modules = currentModules.filter(module => module.type === 'user_script');
  if (!modules.length) return;

  if (compareVersions(currentLoaderVersion, USER_SCRIPT_SWITCH_MIN_LOADER_VERSION) < 0) {
    for (const module of modules) {
      userScriptStates.set(module.id, {
        enabled: false,
        unavailable: true,
        message: `Atualize o loader para a versão ${USER_SCRIPT_SWITCH_MIN_LOADER_VERSION} ou superior.`
      });
    }
    renderModules();
    return;
  }

  await Promise.all(modules.map(async module => {
    try {
      const response = await LoaderBridge.requestForModule(module.id, 'userscripts.status');
      if (!response?.ok) {
        throw new Error(response?.error || 'Não foi possível consultar o estado do módulo.');
      }

      userScriptStates.set(module.id, {
        enabled: response.enabled === true,
        registered: response.registered === true,
        message: response.enabled
          ? 'Ativo nas páginas compatíveis do SPX.'
          : 'Desativado.'
      });
    } catch (error) {
      userScriptStates.set(module.id, {
        enabled: false,
        unavailable: true,
        error: true,
        message: normalizeSwitchError(error)
      });
    }
  }));

  renderModules();
}

async function toggleUserScript(module, enabled) {
  const previous = userScriptStates.get(module.id) || { enabled: !enabled };
  userScriptStates.set(module.id, {
    ...previous,
    enabled,
    busy: true,
    error: false,
    message: enabled ? 'Ativando e recarregando abas SPX...' : 'Desativando e recarregando abas SPX...'
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
        ? `Ligado. ${formatReloadedTabs(response.reloadedTabs)}`
        : `Desligado. ${formatReloadedTabs(response.reloadedTabs)}`
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

function formatReloadedTabs(value) {
  const count = Number(value || 0);
  if (!count) return 'Abra ou recarregue a página de recebimento para aplicar.';
  return `${count} aba${count === 1 ? '' : 's'} do SPX recarregada${count === 1 ? '' : 's'}.`;
}

function normalizeSwitchError(error) {
  const message = String(error?.message || error || 'Falha desconhecida.');
  if (/Permitir scripts de usuário/i.test(message)) return message;
  if (/launcher não pode|operação|capability/i.test(message)) {
    return `Atualize o loader para a versão ${USER_SCRIPT_SWITCH_MIN_LOADER_VERSION} ou superior.`;
  }
  return message;
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
