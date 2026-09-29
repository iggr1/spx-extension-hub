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
  const inFlight = new Map();
  let stationCache = { id: 0, expiresAt: 0 };
  let frame = 0;

  initialize();

  function initialize() {
    injectAutoAddStyles();

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });

    document.addEventListener('click', event => {
      if (event.target.closest('.dock-card[data-dock-id]')) scheduleSync();
    }, true);

    window.setInterval(scheduleSync, 1000);
    scheduleSync();
  }

  function injectAutoAddStyles() {
    if (document.getElementById('dockFlowAutoAddStyles')) return;

    const style = document.createElement('style');
    style.id = 'dockFlowAutoAddStyles';
    style.textContent = `
      .assignment-stats {
        grid-template-columns: 1fr !important;
      }

      .dock-autoadd-highlight {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
        margin: 4px 0 16px;
        padding: 16px 18px;
        border: 1px solid color-mix(in srgb, var(--orange, #ee4d2d) 45%, var(--line));
        border-radius: 16px;
        background: color-mix(in srgb, var(--orange, #ee4d2d) 10%, var(--panel, #111827));
      }

      .dock-autoadd-highlight .autoadd-copy {
        min-width: 0;
      }

      .dock-autoadd-highlight .autoadd-label {
        display: block;
        margin-bottom: 4px;
        color: var(--orange, #ee4d2d);
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .04em;
      }

      .dock-autoadd-highlight .autoadd-status {
        display: block;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }

      .dock-autoadd-highlight strong {
        color: var(--ink);
        font-size: 26px;
        font-weight: 950;
        line-height: 1;
        white-space: nowrap;
      }

      .dock-autoadd-highlight.complete strong {
        color: var(--green, #22c55e);
      }

      .dock-autoadd-highlight.pending strong {
        color: var(--orange, #ee4d2d);
      }
    `;

    document.head.appendChild(style);
  }

  function scheduleSync() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void syncAutoAddUi();
    });
  }

  async function syncAutoAddUi() {
    removeRouteLoadingMessage();

    const validationTaskId = readValidationTaskId();
    const cycleAt = Number(state?.fetchedAt || 0);
    const assignments = collectVisibleAssignments();

    for (const assignmentTaskId of assignments) {
      const key = validationTaskId ? `${validationTaskId}|${assignmentTaskId}` : '';
      const cached = key ? progressCache.get(key) : null;

      renderCardProgress(assignmentTaskId, cached);
      renderModalProgress(assignmentTaskId, cached);

      if (!validationTaskId || !cycleAt) continue;
      if (cached?.status === 'ready' && cached.cycleAt === cycleAt) continue;
      if (cached?.status === 'loading' && cached.cycleAt === cycleAt) continue;
      if (inFlight.has(key)) continue;

      progressCache.set(key, { status: 'loading', cycleAt });
      renderCardProgress(assignmentTaskId, progressCache.get(key));
      renderModalProgress(assignmentTaskId, progressCache.get(key));

      const request = fetchAutoAddProgress(assignmentTaskId, validationTaskId)
        .then(progress => {
          progressCache.set(key, { status: 'ready', cycleAt, ...progress });
        })
        .catch(() => {
          progressCache.set(key, { status: 'error', cycleAt });
        })
        .finally(() => {
          inFlight.delete(key);
          scheduleSync();
        });

      inFlight.set(key, request);
    }
  }

  function collectVisibleAssignments() {
    const assignments = new Set();

    document.querySelectorAll('.assignment-stats[data-assignment-task-id]').forEach(element => {
      const assignmentTaskId = normalizeAssignmentId(element.dataset.assignmentTaskId);
      if (assignmentTaskId) assignments.add(assignmentTaskId);
    });

    const modalAssignment = readModalAssignmentTaskId();
    if (modalAssignment) assignments.add(modalAssignment);

    return [...assignments];
  }

  function normalizeAssignmentId(value) {
    const assignmentTaskId = String(value || '').trim().toUpperCase();
    return /^AT[A-Z0-9]+$/i.test(assignmentTaskId) ? assignmentTaskId : '';
  }

  function readValidationTaskId() {
    const value = String(state?.validationProgress?.taskId || '').trim().toUpperCase();
    return /^VT[A-Z0-9]+$/i.test(value) ? value : '';
  }

  function readModalAssignmentTaskId() {
    const list = document.querySelector('.dock-details-dialog[open] .dock-details-body dl');
    if (!list) return '';

    for (const row of list.querySelectorAll(':scope > div')) {
      if (row.querySelector('dt')?.textContent?.trim() !== 'AT') continue;
      return normalizeAssignmentId(row.querySelector('dd')?.textContent);
    }

    return '';
  }

  function renderCardProgress(assignmentTaskId, progress) {
    document.querySelectorAll('.assignment-stats[data-assignment-task-id]').forEach(container => {
      if (normalizeAssignmentId(container.dataset.assignmentTaskId) !== assignmentTaskId) return;

      let stat = container.querySelector('.assignment-stat.autoadd');
      if (!stat) {
        stat = document.createElement('div');
        stat.className = 'assignment-stat autoadd';
        stat.innerHTML = '<span>AUTOADD</span><b>…</b>';
        container.appendChild(stat);
      }

      stat.classList.remove('pending', 'complete');
      const value = stat.querySelector('b');

      if (progress?.status === 'ready') {
        value.textContent = `${progress.loaded}/${progress.total}`;
        stat.classList.add(progress.pending > 0 ? 'pending' : 'complete');
        stat.title = progress.total
          ? `${progress.loaded} bipado${progress.loaded === 1 ? '' : 's'} · ${progress.pending} faltando`
          : 'Rota sem AutoAdd';
        return;
      }

      value.textContent = progress?.status === 'error' ? '—/—' : '…/…';
      stat.title = progress?.status === 'error' ? 'AutoAdd indisponível' : 'Atualizando AutoAdd';
    });
  }

  function renderModalProgress(assignmentTaskId, progress) {
    const body = document.querySelector('.dock-details-dialog[open] .dock-details-body');
    if (!body || readModalAssignmentTaskId() !== assignmentTaskId) return;

    body.querySelectorAll('[data-autoadd-progress]').forEach(element => element.remove());

    let highlight = body.querySelector('.dock-autoadd-highlight');
    if (!highlight) {
      highlight = document.createElement('section');
      highlight.className = 'dock-autoadd-highlight';
      highlight.innerHTML = `
        <div class="autoadd-copy">
          <span class="autoadd-label">AUTOADD</span>
          <span class="autoadd-status">Atualizando...</span>
        </div>
        <strong>…/…</strong>
      `;
    }

    const sizeSummary = body.querySelector('.dock-size-summary');
    if (sizeSummary) body.insertBefore(highlight, sizeSummary);
    else body.prepend(highlight);

    highlight.classList.remove('pending', 'complete');
    const status = highlight.querySelector('.autoadd-status');
    const value = highlight.querySelector('strong');

    if (progress?.status === 'ready') {
      if (!progress.total) {
        status.textContent = 'Rota sem AutoAdd';
        value.textContent = '0/0';
        highlight.classList.add('complete');
        return;
      }

      const loadedLabel = progress.loaded === 1 ? 'bipado' : 'bipados';
      status.textContent = `${progress.loaded} ${loadedLabel} · ${progress.pending} faltando`;
      value.textContent = `${progress.loaded}/${progress.total}`;
      highlight.classList.add(progress.pending > 0 ? 'pending' : 'complete');
      return;
    }

    status.textContent = progress?.status === 'error' ? 'Não foi possível atualizar' : 'Atualizando...';
    value.textContent = progress?.status === 'error' ? '—/—' : '…/…';
  }

  function removeRouteLoadingMessage() {
    document.querySelectorAll('.dock-details-dialog[open] .dock-details-body > p').forEach(element => {
      if (element.textContent?.trim() === 'Atualizando informações da rota…') element.remove();
    });
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

    if (!plannedResult?.ok || !scannedResult?.ok) throw new Error('Não foi possível atualizar o AutoAdd.');

    const plannedList = Array.isArray(plannedResult.data?.data?.list) ? plannedResult.data.data.list : [];
    const scannedList = Array.isArray(scannedResult.data?.data?.list) ? scannedResult.data.data.list : [];
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