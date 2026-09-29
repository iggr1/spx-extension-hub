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
  const STATION_URL = 'https://spx.shopee.com.br/api/admin/basicserver/current_user/station_list/?count=50&status_list=0';
  const PLANNED_URL = 'https://spx.shopee.com.br/spx_delivery/admin/assignment/assignment_task/detail/planned_order/search';
  const CACHE_TTL_MS = 60 * 1000;
  const countCache = new Map();
  let stationCache = { id: 0, expiresAt: 0 };
  let frame = 0;

  initialize();

  function initialize() {
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('click', event => {
      if (event.target.closest('.dock-card[data-dock-id]')) scheduleSync();
    }, true);
    scheduleSync();
  }

  function scheduleSync() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void syncAutoAddCount();
    });
  }

  async function syncAutoAddCount() {
    const dialog = document.querySelector('.dock-details-dialog[open]');
    const list = dialog?.querySelector('.dock-details-body dl');
    if (!list) return;

    const assignmentTaskId = readAssignmentTaskId(list);
    if (!assignmentTaskId) return;

    const row = ensureRow(list);
    const value = row.querySelector('dd');
    const cached = countCache.get(assignmentTaskId);

    if (cached?.status === 'ready' && cached.expiresAt > Date.now()) {
      value.textContent = String(cached.count);
      return;
    }

    if (cached?.status === 'loading') {
      value.textContent = '...';
      return;
    }

    if (cached?.status === 'error' && cached.expiresAt > Date.now()) {
      value.textContent = '—';
      return;
    }

    value.textContent = '...';
    countCache.set(assignmentTaskId, { status: 'loading' });

    try {
      const count = await fetchAutoAddCount(assignmentTaskId);
      countCache.set(assignmentTaskId, { status: 'ready', count, expiresAt: Date.now() + CACHE_TTL_MS });
    } catch {
      countCache.set(assignmentTaskId, { status: 'error', expiresAt: Date.now() + 15000 });
    }

    scheduleSync();
  }

  function readAssignmentTaskId(list) {
    for (const row of list.querySelectorAll(':scope > div')) {
      if (row.querySelector('dt')?.textContent?.trim() !== 'AT') continue;
      const value = row.querySelector('dd')?.textContent?.trim() || '';
      return /^AT[A-Z0-9]+$/i.test(value) ? value.toUpperCase() : '';
    }
    return '';
  }

  function ensureRow(list) {
    let row = list.querySelector('[data-autoadd-count]');
    if (row) return row;

    row = document.createElement('div');
    row.dataset.autoaddCount = 'true';
    row.innerHTML = '<dt>AutoAdd</dt><dd>...</dd>';

    const orderRow = [...list.querySelectorAll(':scope > div')].find(item => item.querySelector('dt')?.textContent?.trim() === 'Pedidos da AT');
    if (orderRow?.nextSibling) list.insertBefore(row, orderRow.nextSibling);
    else list.appendChild(row);
    return row;
  }

  async function fetchAutoAddCount(assignmentTaskId) {
    const stationId = await getStationId();
    const response = await LoaderBridge.request('network.fetchBatch', {
      profileId: 'spx',
      requests: [{
        key: 'autoadd-count',
        url: PLANNED_URL,
        method: 'POST',
        body: { assignment_task_id: assignmentTaskId, station_id: stationId }
      }]
    });
    const result = response?.results?.['autoadd-count'];
    if (!result?.ok) throw new Error(result?.error || 'Falha ao consultar AutoAdd.');

    const list = Array.isArray(result.data?.data?.list) ? result.data.data.list : [];
    const ids = new Set();
    for (const item of list) {
      if (Number(item?.order_at_linkage) !== 2) continue;
      const shipmentId = String(item?.shipment_id || '').trim();
      if (shipmentId) ids.add(shipmentId);
    }
    return ids.size;
  }

  async function getStationId() {
    if (stationCache.id > 0 && stationCache.expiresAt > Date.now()) return stationCache.id;

    const response = await LoaderBridge.request('network.fetchBatch', {
      profileId: 'spx',
      requests: [{ key: 'autoadd-station', url: STATION_URL, method: 'GET' }]
    });
    const result = response?.results?.['autoadd-station'];
    if (!result?.ok) throw new Error(result?.error || 'Falha ao identificar a estação.');

    const stationId = Number(result.data?.data?.current_station_id || 0);
    if (!Number.isSafeInteger(stationId) || stationId <= 0) throw new Error('Estação inválida.');
    stationCache = { id: stationId, expiresAt: Date.now() + 10 * 60 * 1000 };
    return stationId;
  }
})();
