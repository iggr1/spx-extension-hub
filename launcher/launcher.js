const PDFJS_MODULE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

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

    const modules = catalogResponse.catalog.modules.filter(module => module.enabled);
    renderModules(modules);
    status.textContent = `${modules.length} módulo(s) disponível(is)`;
    loaderVersion.textContent = loaderResponse?.ok ? `Loader ${loaderResponse.version}` : '';

    if (activeDescriptionModuleId && !modules.some(module => module.id === activeDescriptionModuleId)) {
      closeDescription();
    }
  } catch (error) {
    status.textContent = error.message || String(error);
    grid.innerHTML = '<div class="empty">Não foi possível carregar a lista de módulos.</div>';
  }
}

function renderModules(modules) {
  if (!modules.length) {
    grid.innerHTML = '<div class="empty">Nenhum módulo está publicado no momento.</div>';
    return;
  }

  const modulesWithDescription = modules.map(module => ({
    ...module,
    descriptionPdf: resolveDescriptionPdf(module)
  }));

  grid.innerHTML = modulesWithDescription.map(module => {
    const hasDescription = Boolean(module.descriptionPdf);
    const isDescriptionActive = activeDescriptionModuleId === module.id;

    return `
      <article class="module-card">
        <div class="module-icon">${escapeHtml(module.name.slice(0, 2).toUpperCase())}</div>
        <h2>${escapeHtml(module.name)}</h2>
        <p>${escapeHtml(module.description || 'Módulo operacional publicado no hub.')}</p>
        <div class="module-footer">
          <span class="module-version">v${escapeHtml(module.version)}</span>
          <div class="module-actions">
            <button
              class="description-button${isDescriptionActive ? ' is-active' : ''}"
              type="button"
              data-description-id="${escapeHtml(module.id)}"
              aria-pressed="${isDescriptionActive}"
              ${hasDescription ? '' : 'disabled title="PDF de descrição não publicado"'}
            >Descrição</button>
            <button class="open-button" type="button" data-module-id="${escapeHtml(module.id)}">Abrir</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  const modulesById = new Map(modulesWithDescription.map(module => [module.id, module]));

  for (const button of grid.querySelectorAll('[data-module-id]')) {
    button.addEventListener('click', () => LoaderBridge.openModule(button.dataset.moduleId));
  }

  for (const button of grid.querySelectorAll('[data-description-id]')) {
    button.addEventListener('click', () => {
      const module = modulesById.get(button.dataset.descriptionId);
      if (module) openDescription(module);
    });
  }
}

function resolveDescriptionPdf(module) {
  const configuredPdf = String(module.descriptionPdf || '').trim();
  if (configuredPdf) return configuredPdf;

  if (module.type !== 'web_app' || !module.entry) return '';

  try {
    return new URL('descricao.pdf', module.entry).toString();
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
