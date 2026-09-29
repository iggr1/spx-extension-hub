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
    injectRouteLayoutStyle();
    injectSetting();
    syncInput();
    bindEvents();
  }

  function injectRouteLayoutStyle() {
    if (document.getElementById('dockFlowRouteLayoutStyle')) return;

    const style = document.createElement('style');
    style.id = 'dockFlowRouteLayoutStyle';
    style.textContent = `
      .route-block.route-ready {
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }

      .dock-card.available {
        grid-template-rows: auto minmax(0, 1fr) auto;
      }

      .dock-card.available .route-block {
        display: none;
      }

      .dock-card.available .dock-name-block,
      .dock-card.available .status-badge,
      .dock-card.available .driver-block,
      .dock-card.available .times-grid {
        opacity: 1;
      }

      .dock-card.available .driver-block {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        text-align: center;
      }

      .dock-card.available .driver-block strong {
        color: var(--muted);
        font-size: clamp(12px, min(1.15vw, 1.9vh), 18px);
        font-weight: 850;
        line-height: 1.15;
      }

      .dock-card.available .time-item {
        opacity: 1;
      }
    `;

    document.head.appendChild(style);
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

(() => {
  const MODULE_ID = 'spx-dock-flow-autoadd';
  const STORAGE_KEY = 'spxDockFlowAutoAddPanelEnabledV1';
  const DEFAULT_ENABLED = true;
  const FIELD_ID = 'settingDockFlowAutoAddPanel';
  const STATUS_ID = 'settingDockFlowAutoAddPanelStatus';

  let enabled = loadPreference();
  let busy = false;

  initialize();

  function initialize() {
    injectSetting();
    syncInput();
    bindEvents();
    window.setTimeout(() => void reconcileScriptState(), 250);
  }

  function injectSetting() {
    if (document.getElementById(FIELD_ID)) return;

    const form = document.querySelector('#settingsModal .settings-form');
    const actions = form?.querySelector('.settings-actions');
    if (!form || !actions) return;

    const section = document.createElement('section');
    section.className = 'settings-section';
    section.dataset.dockflowAutoaddSettings = 'true';
    section.innerHTML = `
      <h3 class="settings-section-title">Tela de conferência</h3>
      <div class="settings-grid">
        <label class="settings-field full-width">
          <span class="settings-switch-row">
            <span>
              <span class="settings-field-label">Painel AutoAdd na conferência</span>
              <small id="${STATUS_ID}">Exibe o painel Dockflow de pedidos AutoAdd no canto inferior direito da tela de conferência.</small>
            </span>
            <span class="settings-switch">
              <input id="${FIELD_ID}" type="checkbox">
              <span aria-hidden="true"></span>
            </span>
          </span>
        </label>
      </div>
    `;

    form.insertBefore(section, actions);
  }

  function bindEvents() {
    document.getElementById('settingsButton')?.addEventListener('click', () => {
      syncInput();
      void refreshStatus();
    });

    document.getElementById('settingsSaveButton')?.addEventListener('click', () => {
      const input = document.getElementById(FIELD_ID);
      enabled = input?.checked !== false;
      savePreference(enabled);
      void reconcileScriptState(true);
    });

    document.getElementById('settingsResetButton')?.addEventListener('click', () => {
      enabled = DEFAULT_ENABLED;
      savePreference(enabled);
      syncInput();
      void reconcileScriptState(true);
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

  async function reconcileScriptState(showReloadCount = false) {
    if (busy || !window.LoaderBridge?.requestForModule) return;
    busy = true;
    setBusy(true);

    try {
      const status = await LoaderBridge.requestForModule(MODULE_ID, 'userscripts.status');
      if (!status?.ok) throw new Error(status?.error || 'Não foi possível consultar o painel AutoAdd.');

      if (status.enabled !== enabled) {
        const response = await LoaderBridge.requestForModule(MODULE_ID, 'userscripts.setEnabled', { enabled });
        if (!response?.ok) throw new Error(response?.error || 'Não foi possível alterar o painel AutoAdd.');
        renderStatus(response.enabled === true, showReloadCount ? Number(response.reloadedTabs || 0) : 0);
      } else {
        renderStatus(status.enabled === true, 0);
      }
    } catch (error) {
      renderError(error);
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  async function refreshStatus() {
    if (busy || !window.LoaderBridge?.requestForModule) return;
    busy = true;
    setBusy(true);

    try {
      const status = await LoaderBridge.requestForModule(MODULE_ID, 'userscripts.status');
      if (!status?.ok) throw new Error(status?.error || 'Não foi possível consultar o painel AutoAdd.');
      renderStatus(status.enabled === true, 0);
    } catch (error) {
      renderError(error);
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  function renderStatus(actualEnabled, reloadedTabs) {
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    const reloadText = reloadedTabs > 0
      ? ` ${reloadedTabs} aba${reloadedTabs === 1 ? '' : 's'} do SPX recarregada${reloadedTabs === 1 ? '' : 's'}.`
      : '';
    status.textContent = actualEnabled
      ? `Ativo. O painel Dockflow aparece no canto inferior direito da tela de conferência.${reloadText}`
      : `Desativado. O Dockflow não adiciona o painel AutoAdd à tela de conferência.${reloadText}`;
  }

  function renderError(error) {
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    const message = String(error?.message || error || 'Falha desconhecida.');
    status.textContent = `Não foi possível aplicar esta opção: ${message}`;
  }

  function setBusy(value) {
    const input = document.getElementById(FIELD_ID);
    if (input) input.disabled = value;
  }

  function syncInput() {
    const input = document.getElementById(FIELD_ID);
    if (input) input.checked = enabled;
  }

  function loadPreference() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_ENABLED;
    return stored !== 'false';
  }

  function savePreference(value) {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  }
})();
