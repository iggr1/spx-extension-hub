(() => {
  const STORAGE_KEY = 'spxDockFlowShowRouteOrderQuantitiesV1';
  const DEFAULT_VISIBLE = true;

  let showRouteOrderQuantities = loadPreference();
  const originalRenderAssignmentStats = renderAssignmentStats;

  renderAssignmentStats = function configurableRenderAssignmentStats(assignmentTaskId) {
    if (!showRouteOrderQuantities) return '';
    return originalRenderAssignmentStats(assignmentTaskId);
  };

  initialize();

  function initialize() {
    injectSetting();
    syncInput();
    bindEvents();
  }

  function injectSetting() {
    if (document.getElementById('settingShowRouteOrderQuantities')) return;

    const visualSection = [...document.querySelectorAll('.settings-section')].find(section => (
      section.querySelector('.settings-section-title')?.textContent?.trim() === 'Visualização'
    ));
    const grid = visualSection?.querySelector('.settings-grid');
    if (!grid) return;

    const field = document.createElement('label');
    field.className = 'settings-field full-width';
    field.innerHTML = `
      <span class="settings-switch-row">
        <span>
          <span class="settings-field-label">Exibir quantidades de pedidos nas rotas</span>
          <small>Mostra os totais de pedidos e volumosos nos cards. Ao ocultar, essas estatísticas deixam de ser consultadas.</small>
        </span>
        <span class="settings-switch">
          <input id="settingShowRouteOrderQuantities" type="checkbox">
          <span aria-hidden="true"></span>
        </span>
      </span>
    `;

    grid.appendChild(field);
  }

  function bindEvents() {
    document.getElementById('settingsButton')?.addEventListener('click', syncInput);

    document.getElementById('settingsSaveButton')?.addEventListener('click', () => {
      const input = document.getElementById('settingShowRouteOrderQuantities');
      showRouteOrderQuantities = input?.checked !== false;
      savePreference(showRouteOrderQuantities);
      applyPreference();
    });

    document.getElementById('settingsResetButton')?.addEventListener('click', () => {
      showRouteOrderQuantities = DEFAULT_VISIBLE;
      savePreference(showRouteOrderQuantities);
      syncInput();
      applyPreference();
    });

    document.getElementById('settingsCancelButton')?.addEventListener('click', syncInput);
    document.getElementById('settingsCloseButton')?.addEventListener('click', syncInput);

    document.getElementById('settingsModal')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) syncInput();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') syncInput();
    });
  }

  function applyPreference() {
    try {
      renderAll();
      updateLiveTimes();
      scheduleGridFit();
    } catch {
      // A dashboard pode ainda estar concluindo a inicialização.
    }
  }

  function syncInput() {
    const input = document.getElementById('settingShowRouteOrderQuantities');
    if (input) input.checked = showRouteOrderQuantities;
  }

  function loadPreference() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_VISIBLE;
    return stored !== 'false';
  }

  function savePreference(value) {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  }
})();
