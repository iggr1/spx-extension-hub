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
  const SCANNED_URL = 'https://spx.shopee.com.br/api/in-station/lmhub/audit/parcel/list';
  const progressCache = new Map();
  let stationCache = { id: 0, expiresAt: 0 };
  let frame = 0;

  initialize();

  function initialize() {
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });

    document.addEventListener('click', event => {
      if (event.target.closest('.dock-card[data-dock-id]')) scheduleSync();
    }, true);

    window.setInterval(scheduleSync, 1000);
    scheduleSync();
  }

  function scheduleSync() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void syncAutoAddProgress();
    });
  }

  async function syncAutoAddProgress() {
    const dialog = document.querySelector('.dock-details-dialog[open]');
    const list = dialog?.querySelector('.dock-details-body dl');
    if (!list) return;

    const assignmentTaskId = readAssignmentTaskId(list);
    if (!assignmentTaskId) return;

    const row = ensureRow(list);
    const value = row.querySelector('dd');
    const validationTaskId = readValidationTaskId();

    if (!validationTaskId) {
      value.textContent = '—';
      return;
    }

    const cycleAt = Number(state?.fetchedAt || 0);
    const key = `${validationTaskId}|${assignmentTaskId}`;
    const cached = progressCache.get(key);

    if (cached?.status === 'ready' && cached.cycleAt === cycleAt) {
      renderProgress(value, cached);
      return;
    }

    if (cached?.status === 'loading' && cached.cycleAt === cycleAt) {
      value.textContent = 'Atualizando...';
      return;
    }

    value.textContent = 'Atualizando...';
    progressCache.set(key, { status: 'loading', cycleAt });

    try {
      const progress = await fetchAutoAddProgress(assignmentTaskId, validationTaskId);
      progressCache.set(key, { status: 'ready', cycleAt, ...progress });
    } catch {
      progressCache.set(key, { status: 'error', cycleAt });
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

  function readValidationTaskId() {
    const value = String(state?.validationProgress?.taskId || '').trim();
    return /^VT[A-Z0-9]+$/i.test(value) ? value.toUpperCase() : '';
  }

  function ensureRow(list) {
    let row = list.querySelector('[data-autoadd-progress]');
    if (row) return row;

    row = document.createElement('div');
    row.dataset.autoaddProgress = 'true';
    row.innerHTML = '<dt>AutoAdd</dt><dd>Atualizando...</dd>';

    const orderRow = [...list.querySelectorAll(':scope > div')]
      .find(item => item.querySelector('dt')?.textContent?.trim() === 'Pedidos da AT');

    if (orderRow?.nextSibling) list.insertBefore(row, orderRow.nextSibling);
    else list.appendChild(row);

    return row;
  }

  function renderProgress(value, progress) {
    if (!progress.total) {
      value.textContent = 'Rota sem AutoAdd';
      return;
    }

    const loadedLabel = progress.loaded === 1 ? 'bipado' : 'bipados';
    value.textContent = `${progress.loaded} ${loadedLabel} · ${progress.pending} faltando`;
  }

  async function fetchAutoAddProgress(assignmentTaskId, validationTaskId) {
    const stationId = await getStationId();

    const scannedParams = new URLSearchParams({
      validation_task_id: validationTaskId,
      target_id: assignmentTaskId,
      audit_target_type: '2',
      page_no: '1',
      count: '999',
      parcel_scan_status: '2',
      shipment_id: ''
    });

    const response = await LoaderBridge.request('network.fetchBatch', {
      profileId: 'spx',
      requests: [
        {
          key: 'autoadd-planned',
          url: PLANNED_URL,
          method: 'POST',
          body: { assignment_task_id: assignmentTaskId, station_id: stationId }
        },
        {
          key: 'autoadd-scanned',
          url: `${SCANNED_URL}?${scannedParams.toString()}`,
          method: 'GET'
        }
      ]
    });

    const plannedResult = response?.results?.['autoadd-planned'];
    const scannedResult = response?.results?.['autoadd-scanned'];

    if (!plannedResult?.ok || !scannedResult?.ok) {
      throw new Error('Não foi possível atualizar o AutoAdd.');
    }

    const plannedList = Array.isArray(plannedResult.data?.data?.list)
      ? plannedResult.data.data.list
      : [];
    const scannedList = Array.isArray(scannedResult.data?.data?.list)
      ? scannedResult.data.data.list
      : [];

    const plannedIds = new Set();
    const scannedIds = new Set();

    for (const item of plannedList) {
      if (Number(item?.order_at_linkage) !== 2) continue;
      const shipmentId = String(item?.shipment_id || '').trim().toUpperCase();
      if (shipmentId) plannedIds.add(shipmentId);
    }

    for (const item of scannedList) {
      const shipmentId = String(item?.shipment_id || '').trim().toUpperCase();
      if (shipmentId) scannedIds.add(shipmentId);
    }

    let loaded = 0;
    for (const shipmentId of plannedIds) {
      if (scannedIds.has(shipmentId)) loaded += 1;
    }

    return {
      total: plannedIds.size,
      loaded,
      pending: Math.max(0, plannedIds.size - loaded)
    };
  }

  async function getStationId() {
    if (stationCache.id > 0 && stationCache.expiresAt > Date.now()) return stationCache.id;

    const response = await LoaderBridge.request('network.fetchBatch', {
      profileId: 'spx',
      requests: [{ key: 'autoadd-station', url: STATION_URL, method: 'GET' }]
    });
    const result = response?.results?.['autoadd-station'];

    if (!result?.ok) throw new Error('Não foi possível identificar a estação.');

    const stationId = Number(result.data?.data?.current_station_id || 0);
    if (!Number.isSafeInteger(stationId) || stationId <= 0) throw new Error('Estação inválida.');

    stationCache = { id: stationId, expiresAt: Date.now() + 10 * 60 * 1000 };
    return stationId;
  }
})();
