const grid = document.getElementById('moduleGrid');
const status = document.getElementById('status');
const loaderVersion = document.getElementById('loaderVersion');
const workspace = document.getElementById('workspace');
const descriptionSidebar = document.getElementById('descriptionSidebar');
const descriptionTitle = document.getElementById('descriptionTitle');
const descriptionFrame = document.getElementById('descriptionFrame');
const descriptionLoading = document.getElementById('descriptionLoading');
const descriptionError = document.getElementById('descriptionError');
const closeDescriptionButton = document.getElementById('closeDescriptionButton');

let activeDescriptionModuleId = null;
let descriptionLoadTimeout = null;

document.getElementById('refreshButton').addEventListener('click', () => loadModules(true));
closeDescriptionButton.addEventListener('click', closeDescription);
descriptionFrame.addEventListener('load', handleDescriptionLoaded);
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

function openDescription(module) {
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

  activeDescriptionModuleId = module.id;
  descriptionTitle.textContent = module.name;
  descriptionError.hidden = true;
  descriptionError.textContent = 'Não foi possível exibir o PDF. Verifique se o arquivo está publicado no repositório.';
  descriptionLoading.hidden = false;
  descriptionFrame.classList.remove('is-ready');

  pdfUrl.searchParams.set('moduleVersion', module.version || 'latest');
  pdfUrl.hash = 'toolbar=1&navpanes=0&view=FitH';

  workspace.classList.add('is-description-open');
  descriptionSidebar.setAttribute('aria-hidden', 'false');
  descriptionFrame.src = pdfUrl.toString();
  syncDescriptionButtons();

  clearTimeout(descriptionLoadTimeout);
  descriptionLoadTimeout = setTimeout(() => {
    if (!descriptionFrame.classList.contains('is-ready')) {
      descriptionLoading.hidden = true;
      descriptionError.hidden = false;
    }
  }, 12000);
}

function handleDescriptionLoaded() {
  if (!activeDescriptionModuleId) return;

  clearTimeout(descriptionLoadTimeout);
  descriptionLoading.hidden = true;
  descriptionError.hidden = true;
  descriptionFrame.classList.add('is-ready');
}

function showDescriptionError(moduleName, message) {
  activeDescriptionModuleId = null;
  descriptionTitle.textContent = moduleName || 'Descrição';
  descriptionLoading.hidden = true;
  descriptionError.hidden = false;
  descriptionError.textContent = message || 'Não foi possível abrir a descrição deste módulo.';
  workspace.classList.add('is-description-open');
  descriptionSidebar.setAttribute('aria-hidden', 'false');
  descriptionFrame.removeAttribute('src');
  descriptionFrame.classList.remove('is-ready');
  syncDescriptionButtons();
}

function closeDescription() {
  clearTimeout(descriptionLoadTimeout);
  activeDescriptionModuleId = null;
  workspace.classList.remove('is-description-open');
  descriptionSidebar.setAttribute('aria-hidden', 'true');
  descriptionTitle.textContent = 'Descrição';
  descriptionLoading.hidden = false;
  descriptionError.hidden = true;
  descriptionFrame.removeAttribute('src');
  descriptionFrame.classList.remove('is-ready');
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
