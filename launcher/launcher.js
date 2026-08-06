const grid = document.getElementById('moduleGrid');
const status = document.getElementById('status');
const loaderVersion = document.getElementById('loaderVersion');

document.getElementById('refreshButton').addEventListener('click', () => loadModules(true));
loadModules(false);

async function loadModules(forceRefresh) {
  status.textContent = 'Atualizando catálogo...';

  try {
    const [catalogResponse, loaderResponse] = await Promise.all([
      LoaderBridge.request(forceRefresh ? 'catalog.refresh' : 'catalog.get'),
      LoaderBridge.request('loader.info')
    ]);

    if (!catalogResponse?.ok) throw new Error(catalogResponse?.error || 'Catálogo indisponível.');
    renderModules(catalogResponse.catalog.modules.filter(module => module.enabled));
    status.textContent = `${catalogResponse.catalog.modules.filter(module => module.enabled).length} módulo(s) disponível(is)`;
    loaderVersion.textContent = loaderResponse?.ok ? `Loader ${loaderResponse.version}` : '';
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

  grid.innerHTML = modules.map(module => `
    <article class="module-card">
      <div class="module-icon">${escapeHtml(module.name.slice(0, 2).toUpperCase())}</div>
      <h2>${escapeHtml(module.name)}</h2>
      <p>${escapeHtml(module.description || 'Módulo operacional publicado no hub.')}</p>
      <div class="module-footer">
        <span class="module-version">v${escapeHtml(module.version)}</span>
        <button class="open-button" type="button" data-module-id="${escapeHtml(module.id)}">Abrir</button>
      </div>
    </article>
  `).join('');

  for (const button of grid.querySelectorAll('[data-module-id]')) {
    button.addEventListener('click', () => LoaderBridge.openModule(button.dataset.moduleId));
  }
}

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = String(value || '');
  return element.innerHTML;
}
