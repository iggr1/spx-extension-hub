(function initializeAutoAddAssistant() {
  const MARKER = 'spxAutoAddAssistantV1';
  const PANEL_ID = 'spx-autoadd-assistant-panel';
  const TARGET_HASH_PREFIX = '#/mercadao/audit-list/at-to-detail';
  const STATION_URL = '/api/admin/basicserver/current_user/station_list/?count=50&status_list=0';
  const PLANNED_URL = '/spx_delivery/admin/assignment/assignment_task/detail/planned_order/search';
  const SCANNED_URL = '/api/in-station/lmhub/audit/parcel/list';
  const TRACKING_URL = '/api/fleet_order/order/detail/tracking_info';
  const ASSIGNMENT_SEARCH_URL = '/spx_delivery/admin/assignment/assignment_task/search/v2';
  const SCANNED_COUNT = 999;
  const SCANNED_REFRESH_MS = 3500;
  const PLANNED_REFRESH_MS = 20000;
  const LOCATION_WATCH_MS = 800;
  const REQUEST_TIMEOUT_MS = 15000;
  const COLLAPSED_KEY = 'spxAutoAddAssistantCollapsedV1';

  if (document.documentElement.dataset[MARKER] === 'active') return;
  document.documentElement.dataset[MARKER] = 'active';

  let routeContext = null;
  let routeKey = '';
  let refreshTimer = 0;
  let locationTimer = 0;
  let requestController = null;
  let stationCache = { id: 0, expiresAt: 0 };
  let plannedAutoAdd = [];
  let scannedIds = new Set();
  let lastPlannedAt = 0;
  let busy = false;
  let destroyed = false;

  function cookie(name) {
    const prefix = `${name}=`;
    const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    return item ? decodeURIComponent(item.slice(prefix.length)) : '';
  }

  function requestHeaders(hasBody) {
    const headers = { accept: 'application/json, text/plain, */*', app: 'FMS Portal' };
    const csrf = cookie('csrftoken');
    const deviceId = cookie('spx-admin-device-id') || cookie('device-id');
    if (csrf) headers['x-csrftoken'] = csrf;
    if (deviceId) headers['device-id'] = deviceId;
    if (hasBody) headers['content-type'] = 'application/json;charset=UTF-8';
    return headers;
  }

  async function fetchJson(url, options = {}, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: { ...requestHeaders(Boolean(options.body)), ...(options.headers || {}) },
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) throw new Error('Sua sessão do SPX não permite esta consulta.');
      if (!response.ok) throw new Error(`O SPX retornou HTTP ${response.status}.`);

      const data = await response.json();
      if (typeof data?.retcode === 'number' && data.retcode !== 0) throw new Error(data.message || 'O SPX não concluiu a consulta.');
      return data;
    } finally {
      window.clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }

  function getRouteContext() {
    if (location.origin !== 'https://spx.shopee.com.br' || !location.hash.startsWith(TARGET_HASH_PREFIX)) return null;

    const question = location.hash.indexOf('?');
    const params = new URLSearchParams(question >= 0 ? location.hash.slice(question + 1) : '');
    const values = [
      params.get('target_id'),
      params.get('task_id'),
      params.get('assignment_task_id'),
      params.get('validation_task_id'),
      ...params.values()
    ].filter(Boolean).map(value => String(value).trim());

    const assignmentTaskId = values.find(value => /^AT[A-Z0-9]+$/i.test(value))?.toUpperCase() || '';
    const validationTaskId = values.find(value => /^VT[A-Z0-9]+$/i.test(value))?.toUpperCase() || '';
    if (!assignmentTaskId || !validationTaskId) return null;

    return {
      assignmentTaskId,
      validationTaskId,
      key: `${validationTaskId}|${assignmentTaskId}`
    };
  }

  async function getStationId(signal) {
    if (stationCache.id > 0 && stationCache.expiresAt > Date.now()) return stationCache.id;
    const response = await fetchJson(STATION_URL, { method: 'GET' }, signal);
    const stationId = Number(response?.data?.current_station_id || 0);
    if (!Number.isSafeInteger(stationId) || stationId <= 0) throw new Error('Não foi possível identificar a estação atual.');
    stationCache = { id: stationId, expiresAt: Date.now() + 10 * 60 * 1000 };
    return stationId;
  }

  async function fetchPlannedAutoAdd(context, signal) {
    const stationId = await getStationId(signal);
    const response = await fetchJson(PLANNED_URL, {
      method: 'POST',
      body: JSON.stringify({ assignment_task_id: context.assignmentTaskId, station_id: stationId })
    }, signal);

    const list = Array.isArray(response?.data?.list) ? response.data.list : [];
    const unique = new Map();

    for (const item of list) {
      if (Number(item?.order_at_linkage) !== 2) continue;
      const shipmentId = String(item?.shipment_id || '').trim().toUpperCase();
      if (shipmentId) unique.set(shipmentId, { shipmentId });
    }

    return [...unique.values()];
  }

  async function fetchScannedIds(context, signal) {
    const params = new URLSearchParams({
      validation_task_id: context.validationTaskId,
      target_id: context.assignmentTaskId,
      audit_target_type: '2',
      page_no: '1',
      count: String(SCANNED_COUNT),
      parcel_scan_status: '2',
      shipment_id: ''
    });
    const response = await fetchJson(`${SCANNED_URL}?${params.toString()}`, { method: 'GET' }, signal);
    const list = Array.isArray(response?.data?.list) ? response.data.list : [];
    const ids = new Set();

    for (const item of list) {
      const shipmentId = String(item?.shipment_id || '').trim().toUpperCase();
      if (shipmentId) ids.add(shipmentId);
    }

    return ids;
  }

  function isCollapsed() {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  }

  function saveCollapsed(value) {
    try { localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0'); } catch {}
  }

  function ensurePanel() {
    let host = document.getElementById(PANEL_ID);
    if (host) return host;

    host = document.createElement('div');
    host.id = PANEL_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;font-family:Inter,Arial,sans-serif;color:#0f172a}
        *{box-sizing:border-box}
        .panel{width:min(360px,calc(100vw - 36px));overflow:hidden;border:1px solid #dbe2ea;border-radius:14px;background:#fff;box-shadow:0 16px 44px rgba(15,23,42,.24)}
        .panel.collapsed{width:auto;min-width:190px}.panel.collapsed .body{display:none}.panel.collapsed .chevron{transform:rotate(180deg)}
        .header{width:100%;display:flex;align-items:center;gap:10px;padding:11px 12px;border:0;background:#fff;color:#0f172a;text-align:left;cursor:pointer}.header:hover{background:#f8fafc}
        .icon{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border-radius:9px;background:#ff6000;color:#fff;font-size:12px;font-weight:900}
        .title{min-width:0;flex:1}.title strong{display:block;font-size:13px;line-height:1.15}.title small{display:block;margin-top:2px;color:#64748b;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .badge{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 7px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:11px;font-weight:900}.badge.done{background:#ecfdf5;color:#15803d}
        .chevron{flex:0 0 auto;width:18px;height:18px;color:#64748b;transition:transform .18s ease}.body{border-top:1px solid #eef2f7}
        .summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:#f8fafc}.summary span{font-size:11px;color:#64748b}.summary strong{font-size:12px;color:#0f172a;white-space:nowrap}
        .progress{height:4px;background:#e2e8f0}.progress>i{display:block;height:100%;background:#22c55e;transition:width .2s ease}
        .list{max-height:min(330px,42vh);overflow:auto;padding:7px}.row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 7px;border-radius:9px}.row+.row{margin-top:2px}.row.pending{background:#fff7ed}.row.done{background:#f8fafc}
        .status{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;font-size:13px;font-weight:900}.pending .status{background:#ffedd5;color:#c2410c}.done .status{background:#dcfce7;color:#15803d}
        .shipment{min-width:0;font:700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.state{font-size:10px;font-weight:800}.pending .state{color:#c2410c}.done .state{color:#15803d}
        .message{padding:18px 14px;color:#64748b;font-size:11px;line-height:1.45;text-align:center}.message.error{color:#b91c1c;background:#fef2f2}
        .footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-top:1px solid #eef2f7;color:#94a3b8;font-size:9px}.retry{border:0;background:transparent;color:#ea580c;font:800 10px Arial,sans-serif;cursor:pointer;padding:2px 0}

        :host{font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#f8fafc}
        .panel{background:#0f172a;border:1px solid #334155;border-radius:14px;box-shadow:0 18px 55px rgba(2,6,23,.42)}
        .header{background:linear-gradient(120deg,#18263d,#111827);color:#f8fafc;padding:12px 14px;min-height:59px}
        .header:hover{background:#1e293b}
        .icon{background:#2563eb30;border:1px solid #3b82f680;color:#93c5fd}
        .title small{color:#94a3b8}.badge{background:#7c2d1236;color:#fdba74}.badge.done{background:#14532d66;color:#86efac}
        .chevron{color:#94a3b8}.body{border-color:#334155}
        .summary{background:#152238;padding:12px 14px}.summary span{color:#94a3b8}.summary strong{color:#f8fafc}
        .progress{background:#334155;height:6px}
        .list{padding:9px}.row{padding:10px;border:1px solid transparent;border-radius:10px}
        .row.pending{background:#37281766;border-color:#92400e55}.row.done{background:#1e293b;border-color:#334155}
        .pending .status{background:#78350f;color:#fbbf24}.done .status{background:#14532d;color:#86efac}
        .shipment{color:#f8fafc}.pending .state{color:#fbbf24}.done .state{color:#86efac}
        .message{color:#94a3b8}.message.error{color:#fca5a5;background:#7f1d1d20}
        .footer{border-color:#334155;background:#111c2e;color:#94a3b8;padding:10px 14px}
        .retry{color:#93c5fd;font:750 11px Inter,system-ui,sans-serif;border-radius:7px;padding:5px 8px}.retry:hover{background:#26354a}
        button:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
        @media(max-width:620px){:host{right:10px;bottom:10px}.panel{width:min(340px,calc(100vw - 20px))}}
      </style>
      <section class="panel" aria-label="Assistênte de AutoAdd">
        <button class="header" type="button" aria-expanded="true">
          <span class="icon">AA</span>
          <span class="title"><strong>Assistênte de AutoAdd</strong><small>Carregamento da rota</small></span>
          <span class="badge">...</span>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="body">
          <div class="summary"><span>Consultando...</span><strong>—</strong></div>
          <div class="progress"><i style="width:0%"></i></div>
          <div class="content"><div class="message">Buscando AutoAdd...</div></div>
          <div class="footer"><span class="updated">Aguardando atualização</span><button class="retry" type="button">Atualizar agora</button></div>
        </div>
      </section>`;

    const panel = shadow.querySelector('.panel');
    const header = shadow.querySelector('.header');
    panel.classList.toggle('collapsed', isCollapsed());
    header.setAttribute('aria-expanded', String(!panel.classList.contains('collapsed')));
    header.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      header.setAttribute('aria-expanded', String(!collapsed));
      saveCollapsed(collapsed);
    });
    shadow.querySelector('.retry').addEventListener('click', () => scheduleRefresh(0, true));
    document.documentElement.appendChild(host);
    return host;
  }

  function panelNodes() {
    const root = ensurePanel().shadowRoot;
    return {
      titleSmall: root.querySelector('.title small'),
      badge: root.querySelector('.badge'),
      summaryLabel: root.querySelector('.summary span'),
      summaryValue: root.querySelector('.summary strong'),
      progress: root.querySelector('.progress i'),
      content: root.querySelector('.content'),
      updated: root.querySelector('.updated')
    };
  }

  function renderLoading(context, message) {
    const nodes = panelNodes();
    nodes.titleSmall.textContent = context.assignmentTaskId;
    nodes.summaryLabel.textContent = message || 'Atualizando...';
    nodes.updated.textContent = 'Consultando SPX...';
  }

  function renderState(context) {
    const nodes = panelNodes();
    const rows = plannedAutoAdd.map(item => ({ ...item, scanned: scannedIds.has(item.shipmentId) }));
    rows.sort((a, b) => Number(a.scanned) - Number(b.scanned) || a.shipmentId.localeCompare(b.shipmentId));
    const loaded = rows.filter(item => item.scanned).length;
    const total = rows.length;
    const pending = Math.max(0, total - loaded);
    const percent = total ? loaded / total * 100 : 100;

    nodes.titleSmall.textContent = `${context.assignmentTaskId}${total ? ` · ${pending ? `${pending} pendente${pending === 1 ? '' : 's'}` : 'completo'}` : ''}`;
    nodes.badge.textContent = total ? (pending ? String(pending) : '✓') : '0';
    nodes.badge.classList.toggle('done', pending === 0);
    nodes.progress.style.width = `${percent}%`;

    if (!total) {
      nodes.summaryLabel.textContent = 'Rota sem AutoAdd';
      nodes.summaryValue.textContent = '—';
      nodes.content.innerHTML = '<div class="message">Rota sem AutoAdd</div>';
    } else {
      nodes.summaryLabel.textContent = `${loaded} de ${total} carregado${loaded === 1 ? '' : 's'}`;
      nodes.summaryValue.textContent = formatPercent(percent);
      const list = document.createElement('div');
      list.className = 'list';
      for (const item of rows) {
        const row = document.createElement('div');
        row.className = `row ${item.scanned ? 'done' : 'pending'}`;
        row.innerHTML = `<span class="status">${item.scanned ? '✓' : '!'}</span><span class="shipment"></span><span class="state">${item.scanned ? 'Carregado' : 'Pendente'}</span>`;
        row.querySelector('.shipment').textContent = item.shipmentId;
        row.querySelector('.shipment').title = item.shipmentId;
        list.appendChild(row);
      }
      nodes.content.replaceChildren(list);
    }

    nodes.updated.textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }

  function renderError(context, error) {
    const nodes = panelNodes();
    nodes.titleSmall.textContent = context.assignmentTaskId;
    nodes.badge.textContent = '!';
    nodes.badge.classList.remove('done');
    nodes.summaryLabel.textContent = 'Não foi possível atualizar';
    nodes.summaryValue.textContent = 'Erro';
    nodes.progress.style.width = '0%';
    const message = document.createElement('div');
    message.className = 'message error';
    message.textContent = error?.message || 'Tente novamente.';
    nodes.content.replaceChildren(message);
    nodes.updated.textContent = 'Use “Atualizar agora” para tentar novamente';
  }

  function scheduleRefresh(delay = SCANNED_REFRESH_MS, forcePlanned = false) {
    window.clearTimeout(refreshTimer);
    if (!routeContext || destroyed) return;
    refreshTimer = window.setTimeout(() => refresh(routeContext, forcePlanned), Math.max(0, delay));
  }

  async function refresh(context, forcePlanned = false) {
    if (busy || !routeContext || context.key !== routeContext.key || destroyed) return;
    busy = true;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;

    try {
      const needsPlanned = forcePlanned || !lastPlannedAt || Date.now() - lastPlannedAt >= PLANNED_REFRESH_MS;
      renderLoading(context, needsPlanned ? 'Atualizando AutoAdd...' : 'Atualizando carregamento...');

      if (needsPlanned) {
        plannedAutoAdd = await fetchPlannedAutoAdd(context, controller.signal);
        lastPlannedAt = Date.now();
      }

      if (context.key !== routeContext?.key) return;
      scannedIds = await fetchScannedIds(context, controller.signal);
      if (context.key !== routeContext?.key) return;
      renderState(context);
    } catch (error) {
      if (error?.name !== 'AbortError' && context.key === routeContext?.key) renderError(context, error);
    } finally {
      if (requestController === controller) requestController = null;
      busy = false;
      if (context.key === routeContext?.key) scheduleRefresh();
    }
  }

  function activate(context) {
    routeContext = context;
    routeKey = context.key;
    plannedAutoAdd = [];
    scannedIds = new Set();
    lastPlannedAt = 0;
    requestController?.abort();
    window.clearTimeout(refreshTimer);
    ensurePanel();
    renderLoading(context, 'Buscando AutoAdd...');
    scheduleRefresh(0, true);
  }

  function deactivate() {
    routeContext = null;
    routeKey = '';
    plannedAutoAdd = [];
    scannedIds = new Set();
    lastPlannedAt = 0;
    requestController?.abort();
    requestController = null;
    window.clearTimeout(refreshTimer);
    refreshTimer = 0;
    busy = false;
    document.getElementById(PANEL_ID)?.remove();
  }


  const OVERVIEW_ID = 'spx-autoadd-vt-overview';
  const OVERVIEW_VALIDATED_ONLY_KEY = 'spxAutoAddVtValidatedOnlyV1';

  function loadOverviewValidatedOnly() {
    try { return localStorage.getItem(OVERVIEW_VALIDATED_ONLY_KEY) !== 'false'; }
    catch { return true; }
  }

  function saveOverviewValidatedOnly(checked) {
    try { localStorage.setItem(OVERVIEW_VALIDATED_ONLY_KEY, checked ? 'true' : 'false'); }
    catch {}
  }
  const OVERVIEW_REFRESH_MS = 120000;
  let overviewKey = '';
  let overviewTimer = 0;
  let overviewController = null;
  let overviewReportRows = [];
  let overviewAllTargets = [];
  let reportSelectedVts = new Set();
  let reportVtCatalog = [];
  let reportVtResults = new Map();
  let reportVtShown = 6;
  let reportVtPage = 1;
  let reportVtHasMore = true;
  let reportVtCatalogLoading = false;
  let reportVtCatalogBusy = null;
  let reportVtLoadChain = Promise.resolve();
  let reportVtGeneration = 0;
  const REPORT_VT_PAGE_SIZE = 24;
  const REPORT_MAX_SELECTED_VTS = 6;

  let overviewReportProgress = { done: 0, total: 0, failed: 0 };
  let overviewLoadingTargets = false;
  let overviewReportWindow = null;
  const overviewReasons = new Map();
  let overviewReasonBusy = 0;
  let overviewValidatedOnly = true;
  const overviewTrackingCache = new Map();
  const overviewVehicleCache = new Map();
  let overviewVehicleNextRequestAt = 0;
  const overviewAtStatsCache = new Map();
  const OVERVIEW_TRACK_CACHE_MS = 20 * 60 * 1000;
  const OVERVIEW_VEHICLE_CACHE_MS = 30 * 60 * 1000;
  const OVERVIEW_STATS_CACHE_MS = 3 * 60 * 1000;
  const OVERVIEW_REASON_CACHE_MS = 20 * 60 * 1000;
  let overviewReasonNextRequestAt = 0;
  let overviewLastManualRefreshAt = 0;

  function overviewContext() {
    if (location.origin !== 'https://spx.shopee.com.br' || !location.hash.startsWith('#/mercadao/audit-list/vt-detail')) return null;
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const vt = String(params.get('vt-task-id') || params.get('vt_task_id') || params.get('task_id') || '').toUpperCase();
    return /^VT[A-Z0-9]+$/.test(vt) ? vt : null;
  }

  const percentFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function formatPercent(value) {
    return percentFormatter.format(Number.isFinite(Number(value)) ? Number(value) : 0) + '%';
  }

  function overviewColor(p) {
    return p >= 90 ? '#22c55e' : p >= 60 ? '#f59e0b' : '#ef4444';
  }

  function overviewHost() {
    let host = document.getElementById(OVERVIEW_ID);
    if (host) return host;
    host = document.createElement('section');
    host.id = OVERVIEW_ID;
    host.style.cssText = 'position:fixed;z-index:2147483644;bottom:18px;right:18px;width:min(510px,calc(100vw - 36px));max-height:85vh;display:flex;flex-direction:column;overflow:hidden;background:#101827;color:#f8fafc;border:1px solid #334155;border-radius:16px;box-shadow:0 18px 60px #02061777;font:12px Arial,sans-serif';
    host.innerHTML = `
      <style>
        #${OVERVIEW_ID} *{box-sizing:border-box}
        #${OVERVIEW_ID} .ov-header{display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;background:linear-gradient(120deg,#18263d,#111827)}
        #${OVERVIEW_ID} .ov-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:#2563eb30;color:#93c5fd;font-weight:900;flex-shrink:0}
        #${OVERVIEW_ID} .ov-heading{flex:1;min-width:0}
        #${OVERVIEW_ID} .ov-heading strong{display:block;font-size:13px}
        #${OVERVIEW_ID} .ov-heading small{display:block;margin-top:4px;color:#94a3b8;font-size:10px}
        #${OVERVIEW_ID} .ov-action{background:#26354a;color:#e2e8f0;border:1px solid #3b4a60;border-radius:8px;padding:7px 10px;cursor:pointer}
        #${OVERVIEW_ID} .ov-summary{padding:0 16px 14px}
        #${OVERVIEW_ID} .ov-summary-line{display:flex;justify-content:space-between;gap:8px;margin-bottom:9px;align-items:center}
        #${OVERVIEW_ID} .ov-summary-line span{color:#cbd5e1;font-size:11px}
        #${OVERVIEW_ID} .ov-summary-line strong{font-size:15px;white-space:nowrap}
        #${OVERVIEW_ID} .ov-bar{height:8px;background:#334155;border-radius:99px;overflow:hidden}
        #${OVERVIEW_ID} .ov-bar i{display:block;height:100%;border-radius:99px;transition:width .3s ease}
        #${OVERVIEW_ID} .ov-filter{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:11px;color:#cbd5e1;font-size:11px;cursor:pointer;user-select:none}
        #${OVERVIEW_ID} .ov-filter input{width:16px;height:16px;margin:0;flex-shrink:0;accent-color:#3b82f6;cursor:pointer}
        #${OVERVIEW_ID} .ov-filter span{flex:1}
        #${OVERVIEW_ID} .ov-details{min-height:0;overflow-y:auto;border-top:1px solid #334155}
        #${OVERVIEW_ID}[data-collapsed="true"] .ov-details{display:none}
        #${OVERVIEW_ID} .ov-body{padding:14px 16px}
        #${OVERVIEW_ID} .ov-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:14px}
        #${OVERVIEW_ID} .ov-metric{padding:11px;border-radius:10px;border:1px solid #334155;background:#1e293b}
        #${OVERVIEW_ID} .ov-metric span{display:block;font-size:10px;color:#94a3b8;margin-bottom:6px}
        #${OVERVIEW_ID} .ov-metric strong{font-size:18px}
        #${OVERVIEW_ID} .ov-route{padding:12px;margin-top:8px;border-radius:11px;background:#182436;border:1px solid #30415a}
        #${OVERVIEW_ID} .ov-route-head,.ov-route-meta{display:flex;justify-content:space-between;align-items:center;gap:10px}
        #${OVERVIEW_ID} .ov-route-name{font-size:13px;font-weight:800}
        #${OVERVIEW_ID} .ov-route-id{font-size:10px;color:#94a3b8;margin-top:4px}
        #${OVERVIEW_ID} .ov-route-percent{font-size:16px;font-weight:900}
        #${OVERVIEW_ID} .ov-route-meta{font-size:10px;color:#94a3b8;margin:9px 0}
        #${OVERVIEW_ID} .ov-footer{padding:10px 16px;border-top:1px solid #334155;color:#94a3b8;font-size:10px}
        #${OVERVIEW_ID}{font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif!important;border-radius:14px!important;background:#0f172a!important}
        #${OVERVIEW_ID} .ov-header{min-height:62px;padding:12px 14px}
        #${OVERVIEW_ID} .ov-action{border-radius:9px;padding:8px 10px;font-weight:700}
        #${OVERVIEW_ID} .ov-action:hover{background:#30445d}
        #${OVERVIEW_ID} .ov-action:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
        #${OVERVIEW_ID} .ov-metric,#${OVERVIEW_ID} .ov-route{border-radius:11px}
        #${OVERVIEW_ID} .ov-report-button{background:#1d4ed835;color:#bfdbfe;border-color:#3b82f680}

      </style>
      <div class="ov-header" data-toggle role="button" tabindex="0" aria-expanded="false">
        <div class="ov-icon">AA</div><div class="ov-heading"><strong>AutoAdd · Visão geral da VT</strong><small data-status>Buscando pedidos...</small></div>
        <button class="ov-action ov-report-button" type="button" data-overview-report title="Abrir relatório da VT">Relatório</button>
        <button class="ov-action" type="button" data-overview-refresh aria-label="Atualizar agora" title="Atualizar agora"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>
        <button class="ov-action" type="button" data-expand aria-label="Expandir painel"><svg style="transform:rotate(180deg)" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
      </div>
      <div class="ov-summary">
        <div class="ov-summary-line"><span data-brief>Carregamento AutoAdd</span><strong data-percent>—</strong></div>
        <div class="ov-bar"><i data-progress></i></div>
        <div class="ov-filter"><span>Somente ATs validadas até o momento</span></div>
      </div>
      <div class="ov-details"><div class="ov-body" data-overview-body>Carregando...</div><div class="ov-footer">Atualização automática a cada 2 minutos</div></div>`;
    host.dataset.collapsed = 'true';
    const toggle = () => {
      const collapsed = host.dataset.collapsed !== 'true';
      host.dataset.collapsed = String(collapsed);
      host.querySelector('[data-toggle]').setAttribute('aria-expanded', String(!collapsed));
      const expand = host.querySelector('[data-expand]');
      expand.setAttribute('aria-label', collapsed ? 'Expandir painel' : 'Recolher painel');
      expand.querySelector('svg').style.transform = collapsed ? 'rotate(180deg)' : '';
    };
    host.querySelector('[data-toggle]').addEventListener('click', e => { if (!e.target.closest('button')) toggle(); });
    host.querySelector('[data-toggle]').addEventListener('keydown', e => { if (e.target === e.currentTarget && ['Enter',' '].includes(e.key)) { e.preventDefault(); toggle(); } });
    host.querySelector('[data-expand]').addEventListener('click', event => { event.stopPropagation(); toggle(); });
    host.querySelector('[data-overview-report]').onclick = () => openOverviewReport();
    host.querySelector('[data-overview-refresh]').onclick = () => void refreshOverview(overviewKey, true);
    document.documentElement.appendChild(host);
    return host;
  }

  function overviewMessage(html) {
    const body = overviewHost().querySelector('[data-overview-body]');
    if (body) body.innerHTML = html;
  }


  function reportEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }

  function reportVtTimestamp(vt) {
    const item = reportVtCatalog.find(entry => entry.vt === vt);
    if (item?.dateMs) return item.dateMs;
    const match = String(vt).match(/^VT(20\d{2})(\d{2})(\d{2})/i);
    if (!match) return 0;
    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sortedReportVts(ids = [...reportSelectedVts]) {
    return [...ids].sort((a, b) =>
      reportVtTimestamp(b) - reportVtTimestamp(a) || b.localeCompare(a));
  }

  function reportRows() {
    if (!overviewReportWindow || overviewReportWindow.closed) return overviewReportRows;
    const rows = [];
    for (const vt of sortedReportVts()) {
      if (vt === overviewKey) {
        const known = new Map(overviewReportRows.map(item => [item.at, item]));
        for (const item of overviewAllTargets) {
          rows.push({ ...item, ...(known.get(item.at) || {}), validationTaskId: vt });
        }
        if (!overviewAllTargets.length) {
          rows.push(...overviewReportRows.map(item => ({ ...item, validationTaskId: vt })));
        }
      } else {
        const state = reportVtResults.get(vt);
        if (state) rows.push(...(state.rows || []).map(item => ({ ...item, validationTaskId: vt })));
      }
    }
    const byAt = new Map();
    for (const item of rows) if (!byAt.has(item.at)) byAt.set(item.at, item);
    return [...byAt.values()];
  }

  function reportCurrentProgress() {
    const selected = overviewReportWindow && !overviewReportWindow.closed ?
      reportSelectedVts : new Set([overviewKey]);
    let done = 0, total = 0, failed = 0, loadingTargets = false;
    for (const vt of selected) {
      if (vt === overviewKey) {
        done += overviewReportProgress.done;
        total += overviewReportProgress.total;
        failed += overviewReportProgress.failed;
        loadingTargets ||= overviewLoadingTargets;
      } else {
        const state = reportVtResults.get(vt);
        if (!state || state.status === 'targets') loadingTargets = true;
        if (state) {
          done += state.done || 0;
          total += state.total || 0;
          failed += state.failed || 0;
        }
      }
    }
    return { done, total, failed, loadingTargets };
  }

  function reportData() {
    const rows = reportRows().filter(item => item.validated === true && Number.isFinite(item.planned) && Number.isFinite(item.scanned));
    const active = rows.filter(item => item.planned > 0).map(item => ({
      ...item, pending: Math.max(0, item.planned - item.scanned),
      pct: Math.min(100, item.scanned / item.planned * 100)
    }));
    const planned = active.reduce((n,item) => n + item.planned, 0);
    const scanned = active.reduce((n,item) => n + item.scanned, 0);
    const missing = rows.flatMap(item => (item.missingIds || []).map(shipmentId => ({
      shipmentId, at: item.at, route: item.route, validationTaskId: item.validationTaskId || overviewKey
    })));
    return { rows, active, missing, planned, scanned, pending: Math.max(0, planned-scanned),
      percent: planned ? scanned / planned * 100 : 0,
      red: active.filter(item=>item.pct<60).length,
      yellow: active.filter(item=>item.pct>=60&&item.pct<90).length,
      green: active.filter(item=>item.pct>=90).length };
  }

  function previousAutoAddOnHold(events, originIndex) {
    const origin = events[originIndex];
    if (!origin) return { fromOnHold: false, onHoldEvent: null, receivedEvent: null };
    const before = events.slice(0, originIndex);
    const receivedIndex = before.findLastIndex(event =>
      Number(event.status) === 1 && Number(event.station_id) === Number(origin.station_id));
    const receivedEvent = receivedIndex < 0 ? null : before[receivedIndex];
    if (!receivedEvent) return { fromOnHold: false, onHoldEvent: null, receivedEvent: null };
    const preceding = before.slice(0, receivedIndex);
    const holdIndex = preceding.findLastIndex(event => Number(event.status) === 5);
    const onHoldEvent = holdIndex < 0 ? null : preceding[holdIndex];
    const newOperation = onHoldEvent && before.slice(holdIndex + 1).some(event =>
      [2, 4, 49, 50].includes(Number(event.status)));
    return {
      fromOnHold: Boolean(onHoldEvent && !newOperation),
      onHoldEvent: onHoldEvent && !newOperation ? onHoldEvent : null,
      receivedEvent
    };
  }

  function overviewEhaReason(message) {
    const value = String(message || '').replace(/\s+/g, ' ').trim();
    const plain = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/\bsolicitacao\s+de\s+rts\b/i.test(plain)) return 'Solicitação de RTS — encaminhado ao EHA';
    return value.replace(/\s*[—-]\s*encaminhado\s+ao\s+eha\.?$/i, '').replace(/\s*\.?$/, '') + ' — encaminhado ao EHA';
  }

  function overviewEhaException(events, origin, at, getAts, build) {
    const nextAt = events.findIndex(event =>
      [49, 50].includes(Number(event.status)) && getAts(event).some(other => other !== at));
    const inAt = nextAt < 0 ? events : events.slice(0, nextAt);
    if (inAt.some(event => Number(event.status) === 2)) return null;
    const firstMissing = inAt.findIndex(event =>
      Number(event.status) === 581 || /order marked as missing/i.test(String(event.message || '')));
    const cycle = firstMissing < 0 ? inAt : inAt.slice(0, firstMissing);
    const ehaEvent = cycle.find(event =>
      Number(event.status) === 580 &&
      Number(event.station_id) === Number(origin.station_id) &&
      /\beha\b/i.test(String(event.message || '')));
    if (!ehaEvent) return null;
    const reasons = cycle.filter(event =>
      [650, 574, 646].includes(Number(event.status)) &&
      Number(event.station_id) === Number(origin.station_id) &&
      String(event.message || '').trim() &&
      !/^(?:ticket submitted|all exceptions have been resolved|exception,?\s*put in eha\.?|-|resolved)$/i.test(String(event.message || '').trim()));
    reasons.sort((a, b) => {
      const rank = event => Number(event.status) === 650 ? 0 : Number(event.status) === 574 ? 1 : 2;
      return rank(a) - rank(b) || Number(a.timestamp) - Number(b.timestamp);
    });
    const cause = reasons[0];
    if (!cause) return { ...build('EHA_SEM_MOTIVO',
      'Encaminhado ao EHA — motivo não informado no histórico', ehaEvent, 'probable'), ehaEvent };
    const message = String(cause.message).trim();
    const plain = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const code = /\bsolicitacao\s+de\s+rts\b/i.test(plain) ? 'RTS_EHA' :
      /pacote\s+nao\s+coube\s+no\s+veiculo/i.test(plain) ? 'CAPACIDADE' :
      /etiqueta\s+avariada/i.test(plain) ? 'ETIQUETA' : 'EHA_EXCECAO';
    return { ...build(code, overviewEhaReason(message), cause), exceptionEvent: cause, ehaEvent };
  }

  // Um Missing comprova a ocorrência (581), mas não a etapa física da falha.
  // A recuperação só é considerada expedição quando há saída para entrega (2).
  function classifyOverviewMissing(after, missingIndex, at, sourceContext, build) {
    const missing = after[missingIndex];
    const later = after.slice(missingIndex + 1);
    const getAts = event => String(event?.message || '').toUpperCase().match(/\bAT[A-Z0-9]+\b/g) || [];
    const missingCount = after.filter(event =>
      Number(event.status) === 581 || /order marked as missing/i.test(String(event.message || ''))).length;
    const departureIndex = later.findIndex(event => Number(event.status) === 2);
    const departure = departureIndex < 0 ? null : later[departureIndex];
    const considered = departureIndex < 0 ? later : later.slice(0, departureIndex + 1);
    const confirmations = considered.filter(event => Number(event.status) === 50 && getAts(event).length);
    const lastConfirmation = confirmations.at(-1) || null;
    const confirmedAt = lastConfirmation ? getAts(lastConfirmation)[0] : '';
    const replanning = considered.filter(event =>
      Number(event.status) === 49 && getAts(event).some(value => value !== at)).at(-1) || null;
    const plannedAt = replanning ? getAts(replanning).find(value => value !== at) : '';
    const targetAt = confirmedAt || plannedAt || '';
    const dayNumber = timestamp => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date(Number(timestamp) * 1000));
      const value = key => Number(parts.find(part => part.type === key)?.value || 0);
      return Date.UTC(value('year'), value('month') - 1, value('day')) / 86400000;
    };
    let code, reason, outcome, confidence = 'confirmed';
    if (departure && confirmedAt === at) {
      code = 'MISSING_RECUPERADO_MESMA_AT';
      reason = 'Missing — expedido na AT original';
      outcome = 'Saída para entrega após regularização na própria AT';
    } else if (departure && targetAt && targetAt !== at) {
      const days = Math.max(0, dayNumber(departure.timestamp) - dayNumber(missing.timestamp));
      code = days === 0 ? 'MISSING_REPLANEJADO_D0' : days === 1 ? 'MISSING_REPLANEJADO_D1' : 'MISSING_REPLANEJADO_DN';
      reason = days === 0 ? 'Missing — expedido em outra AT no mesmo dia' :
        days === 1 ? 'Missing — expedido em outra AT em D+1' : 'Missing — expedido em outra AT após D+1';
      outcome = 'Saída para entrega em ' + targetAt + (days === 0 ? ' no mesmo dia' : ' após ' + days + ' dia(s)');
      if (!confirmedAt) confidence = 'probable'; // AT planejada, mas sem evento 50.
    } else if (departure) {
      code = 'MISSING_SAIDA_SEM_AT';
      reason = 'Missing — saída posterior sem AT confirmada';
      outcome = 'Saída para entrega registrada; AT de expedição não identificada';
    } else if (confirmedAt === at) {
      code = 'MISSING_REGULARIZADO_SEM_SAIDA';
      reason = 'Missing — adicionado à AT original sem saída registrada';
      outcome = 'Adicionado à AT original; saída para entrega não encontrada';
    } else if (targetAt && targetAt !== at) {
      code = 'MISSING_OUTRA_AT_SEM_SAIDA';
      reason = 'Missing — replanejado sem saída registrada';
      outcome = (confirmedAt ? 'Adicionado' : 'Planejado') + ' em ' + targetAt + '; saída para entrega não encontrada';
    } else {
      code = 'MISSING_SEM_DESFECHO';
      reason = 'Missing — sem regularização posterior identificada';
      outcome = 'Sem replanejamento ou saída para entrega identificados';
    }
    if (!departure) confidence = 'probable'; // Histórico sem saída não prova que ela não ocorreu.
    const resolution = departure || lastConfirmation || replanning || null;
    return {
      ...build(code, reason, missing, confidence, targetAt !== at ? targetAt : ''),
      details: 'Missing (581) registrado após AutoAdd. Causa física da falha não comprovada pelo rastreamento.',
      origin: sourceContext.fromOnHold ? 'Retorno de On Hold' : 'Recebimento sem On Hold associado',
      occurrence: 'Missing após AutoAdd',
      outcome,
      physicalCause: 'Não comprovada pelo histórico',
      physicalCauseConfidence: 'unknown',
      missingCount,
      resolutionEvent: resolution,
      resolutionTimestamp: resolution?.timestamp || null
    };
  }

  function classifyAutoAddHistory(events, assignmentTaskId) {
    const at = String(assignmentTaskId || '').toUpperCase();
    const getAts = event => String(event?.message || '').toUpperCase().match(/\bAT[A-Z0-9]+\b/g) || [];
    const includesAt = (event, id) => getAts(event).includes(id);
    const isPolygon = event => /polygon|auto\s*add/i.test(String(event?.operator || ''));
    const isManual = event => Number(event?.status) === 49 && !/admin\(|polygon|auto\s*add|dynamic\s*routing/i.test(String(event?.operator || ''));
    const sorted = [...(events || [])].sort((a,b) =>
      Number(a.timestamp) - Number(b.timestamp) ||
      (Number(a.status) === 1 ? -1 : Number(a.status) === 49 ? 0 : 1) -
      (Number(b.status) === 1 ? -1 : Number(b.status) === 49 ? 0 : 1));
    const index = sorted.findIndex(event => Number(event.status) === 49 && includesAt(event, at) && isPolygon(event));
    const origin = index >= 0 ? sorted[index] : null;
    const sourceContext = previousAutoAddOnHold(sorted, index);
    const unknown = (details, after = []) => ({ code: 'UNMAPPED', reason: 'A classificar', confidence: 'unknown', details, originEvent: origin, evidenceEvent: null, destinationAt: '', elapsedMinutes: null, eventsAfterOrigin: after, sourceContext });
    if (!origin) return unknown('AutoAdd (Polygon) na AT informada não localizado no histórico.');
    const after = sorted.slice(index + 1);
    let firstRemoval = null;
    const localTime = ts => new Date(Number(ts)*1000).toLocaleDateString('en-CA', {timeZone:'America/Sao_Paulo'});
    const build = (code, reason, evidence, confidence = 'confirmed', destinationAt = '') => ({
      code, reason, confidence, details: String(evidence?.message || ''), originEvent: origin,
      evidenceEvent: evidence, destinationAt,
      elapsedMinutes: Math.max(0, Math.round((Number(evidence?.timestamp) - Number(origin.timestamp)) / 60 * 10) / 10),
      eventsAfterOrigin: after, sourceContext
    });
    const ehaClassification = overviewEhaException(after, origin, at, getAts, build);
    if (ehaClassification) return ehaClassification;
    for (let i = 0; i < after.length; i++) {
      const event = after[i];
      const status = Number(event.status);
      const message = String(event.message || '');
      if (status === 1 && Number(event.timestamp) > Number(origin.timestamp) &&
          Number(event.station_id) === Number(origin.station_id) && !firstRemoval) firstRemoval = event;
      if (status === 581 || /order marked as missing/i.test(message)) {
        return classifyOverviewMissing(after, i, at, sourceContext, build);
      }
      if (/pacote n[aã]o coube no ve[ií]culo/i.test(message)) return build('CAPACIDADE', 'Não coube no veículo — capacidade insuficiente', event);
      if (/etiqueta avariada/i.test(message)) return build('ETIQUETA', 'Etiqueta avariada', event);
      const mentioned = getAts(event);
      if (status === 49 && mentioned.includes(at) && !isPolygon(event) && localTime(event.timestamp) !== localTime(origin.timestamp)) {
        const nextNewRoute = after.slice(i + 1).findIndex(item => Number(item.status) === 49 && getAts(item).some(x => x !== at));
        const window = nextNewRoute === -1 ? after.slice(i + 1) : after.slice(i + 1, i + 1 + nextNewRoute);
        const revalidated = window.some(item => Number(item.status) === 50 && includesAt(item, at));
        return build(revalidated ? 'NO_SHOW_REVALIDADA' : 'NO_SHOW_REMOVIDA',
          revalidated ? 'Rota No-show — revalidada no dia seguinte' : 'Rota No-show — removido ou faltante na rota', event);
      }
      if (status === 49 && mentioned.some(x => x !== at)) {
        const destinationAt = mentioned.find(x => x !== at) || '';
        if (isPolygon(event)) return build('NOVO_AUTOADD', 'Removido da AT e novo AutoAdd em outra AT', event, 'confirmed', destinationAt);
        if (isManual(event)) return build('MANUAL', 'Removido e realocado manualmente em outra AT', event, 'confirmed', destinationAt);
        return firstRemoval ? build('REMOVIDO_EXPEDICAO', 'Removido na bancada de expedição', firstRemoval) :
          unknown('Nova roteirização automática sem causa anterior comprovada.', after);
      }
      if (status === 50 && mentioned.some(x => x !== at)) return firstRemoval ?
        build('REALOCADO_DIRETO', 'Realocado em outra rota', event, 'confirmed', mentioned.find(x => x !== at)) :
        unknown('Vinculado a outra AT sem novo processamento registrado; verificar se houve realocação direta.', after);
    }
    return firstRemoval ? build('REMOVIDO_EXPEDICAO', 'Removido na bancada de expedição', firstRemoval) :
      unknown('Nenhuma causa conclusiva após o AutoAdd original.', after);
  }

  function flattenOverviewTracking(list) {
    const output = [], seen = new Set();
    const stack = [...(Array.isArray(list) ? list : [])];
    while (stack.length) {
      const e = stack.pop();
      if (!e || typeof e !== 'object') continue;
      const k = String(e.id) + '|' + String(e.timestamp) + '|' + String(e.message);
      if (!seen.has(k)) {
        seen.add(k);
        output.push({
          id: e.id ?? null, timestamp: Number(e.timestamp) || 0, status: e.status ?? null,
          station_id: e.station_id ?? null, station_name: e.station_name || '',
          message: e.message || '', operator: e.operator || '',
          on_hold_reason: e.on_hold_reason || '', tags: e.tags || null
        });
      }
      stack.push(...(e.children || []), ...(e.event_children || []));
    }
    return output.sort((a,b) => a.timestamp - b.timestamp);
  }

  function overviewTrackingFor(shipmentId) {
    const current = overviewTrackingCache.get(shipmentId);
    if (current && current.expiresAt > Date.now()) return current.promise;
    const url = TRACKING_URL + '?' + new URLSearchParams({ shipment_id: shipmentId });
    const promise = fetchJson(url, { method: 'GET' }).then(result => {
      if (!Array.isArray(result.data?.tracking_list)) throw new Error('Histórico de rastreio indisponível.');
      return flattenOverviewTracking(result.data.tracking_list);
    }).catch(error => { overviewTrackingCache.delete(shipmentId); throw error; });
    overviewTrackingCache.set(shipmentId, { promise, expiresAt: Date.now() + OVERVIEW_TRACK_CACHE_MS });
    if (overviewTrackingCache.size > 600) overviewTrackingCache.delete(overviewTrackingCache.keys().next().value);
    return promise;
  }


  function overviewVehicleCategory(record) {
    if (!record || typeof record !== 'object') return { type: '', raw: '', field: '' };
    const candidates = [
      ['vehicle_type_name', record.vehicle_type_name],
      ['vehicle_type', record.vehicle_type],
      ['vehicle_category', record.vehicle_category],
      ['planned_vehicle_type', record.planned_vehicle_type],
      ['vehicle_name', record.vehicle_name],
      ['vehicle.type_name', record.vehicle?.type_name],
      ['vehicle.type', record.vehicle?.type]
    ];
    for (const [field, raw] of candidates) {
      if (raw == null || raw === '') continue;
      const value = String(raw).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase().replace(/[_-]+/g, ' ').trim();
      if (/\b(MOTO|MOTOCICLETA|MOTORCYCLE|MOTORBIKE|MOTOR BIKE|2W|2 WHEELS?|2 RODAS)\b/.test(value)) {
        return { type: 'Moto', raw, field };
      }
      if (/\b(PASSEIO|PASSENGER CAR|PASSENGER VEHICLE|CARRO|AUTOMOVEL|SEDAN|HATCH|HATCHBACK|CAR|4W|4 WHEELS?|4 RODAS)\b/.test(value)) {
        return { type: 'Passeio', raw, field };
      }
    }
    return { type: '', raw: candidates.find(([, value]) => value != null && value !== '')?.[1] ?? '', field: '' };
  }

  function overviewAtIdentifier(record) {
    const candidates = [
      record?.assignment_task_id, record?.assignmentTaskId, record?.assignment_task_code,
      record?.task_id, record?.taskId, record?.task_code, record?.code
    ];
    return String(candidates.find(v => /^AT[A-Z0-9]+$/i.test(String(v || ''))) || '').toUpperCase();
  }

  function overviewVehicleFor(at) {
    const id = String(at || '').toUpperCase();
    const cached = overviewVehicleCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const promise = (async () => {
      const now = Date.now();
      const delay = Math.max(0, overviewVehicleNextRequestAt - now);
      overviewVehicleNextRequestAt = Math.max(now, overviewVehicleNextRequestAt) + 1000;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const response = await fetchJson(ASSIGNMENT_SEARCH_URL, {
        method: 'POST',
        body: JSON.stringify({ assignment_task_id: id, pageno: 1, count: 20, search_type: 0 })
      });
      const body = response?.data || {};
      const list = Array.isArray(body.list) ? body.list :
        Array.isArray(body.assignment_task_list) ? body.assignment_task_list :
        Array.isArray(body.items) ? body.items : [];
      const record = list.find(item => overviewAtIdentifier(item) === id);
      const vehicle = overviewVehicleCategory(record);
      return { ...vehicle, source: record ? 'assignment_task/search/v2' : '', exactAtMatch: Boolean(record) };
    })().catch(error => ({
      type: '', raw: '', field: '', source: '', exactAtMatch: false,
      error: String(error?.message || error)
    }));
    overviewVehicleCache.set(id, { promise, expiresAt: Date.now() + OVERVIEW_VEHICLE_CACHE_MS });
    promise.then(data => {
      const current = overviewVehicleCache.get(id);
      if (current?.promise === promise && !data.type) current.expiresAt = Date.now() + 2 * 60 * 1000;
    });
    if (overviewVehicleCache.size > 400) overviewVehicleCache.delete(overviewVehicleCache.keys().next().value);
    return promise;
  }

  function queueOverviewReasonLookup() {
    if (!overviewReportWindow || overviewReportWindow.closed || overviewReasonBusy >= 2) return;
    const vt = overviewKey;
    for (const item of reportData().missing) {
      if (overviewReasonBusy >= 2) break;
      const key = item.shipmentId + '|' + item.at;
      const current = overviewReasons.get(key);
      if (current && (current.loading || current.expiresAt > Date.now())) continue;
      overviewReasons.set(key, { reason: 'Consultando histórico...', loading: true, expiresAt: Date.now() + 60000 });
      renderOverviewLoadingPopup();
      overviewReasonBusy++;
      const now = Date.now();
      const delay = Math.max(0, overviewReasonNextRequestAt - now);
      overviewReasonNextRequestAt = Math.max(now, overviewReasonNextRequestAt) + 900;
      (async () => {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (vt !== overviewKey || !overviewReportWindow || overviewReportWindow.closed) return;
        const events = await overviewTrackingFor(item.shipmentId);
        const classified = classifyAutoAddHistory(events, item.at);
        if (classified.code === 'CAPACIDADE') {
          const vehicle = await overviewVehicleFor(item.at);
          classified.vehicleType = vehicle.type || '';
          classified.vehicleSource = vehicle.source || '';
          classified.vehicleRaw = vehicle.raw || '';
          classified.vehicleField = vehicle.field || '';
          classified.vehicleLookupError = vehicle.error || '';
          classified.reason = 'Pacote não coube no veículo - Veículo: ' + (vehicle.type || 'não identificado') +
            (classified.ehaEvent ? ' — encaminhado ao EHA' : '');
        }
        overviewReasons.set(key, { ...classified, loading: false, analyzedAt: Date.now(), expiresAt: Date.now() + OVERVIEW_REASON_CACHE_MS });
      })().catch(error => overviewReasons.set(key, {
        reason: 'Consulta indisponível', code: 'FETCH_ERROR', confidence: 'unknown',
        details: String(error?.message || error), loading: false, expiresAt: Date.now() + 2 * 60 * 1000
      })).finally(() => {
        if (overviewReasons.get(key)?.loading) overviewReasons.delete(key);
        overviewReasonBusy--;
        if (vt === overviewKey) {
          renderOverviewReport();
          queueOverviewReasonLookup();
        }
      });
    }
  }


  function overviewReasonReady(state) {
    return Boolean(state && !state.loading && state.code &&
      !['UNMAPPED', 'FETCH_ERROR'].includes(state.code) && state.reason);
  }

  function overviewLoadStats() {
    const missing = reportData().missing;
    const now = Date.now();
    const historiesDone = missing.filter(item => {
      const state = overviewReasons.get(item.shipmentId + '|' + item.at);
      return state && !state.loading && Number(state.expiresAt) > now;
    }).length;
    const classified = missing.filter(item =>
      overviewReasonReady(overviewReasons.get(item.shipmentId + '|' + item.at))).length;
    const { done, total, failed, loadingTargets } = reportCurrentProgress();
    const active = reportVtCatalogLoading || loadingTargets || done < total || historiesDone < missing.length;
    return {
      active, targetsLoading: loadingTargets, catalogLoading: reportVtCatalogLoading, atsDone: done, atsTotal: total,
      failed, historiesDone, historiesTotal: missing.length, classified,
      historiesPending: missing.length - historiesDone
    };
  }

  function renderOverviewLoadingPopup() {
    const tab = overviewReportWindow;
    if (!tab || tab.closed) return;
    const popup = tab.document.getElementById('spx-report-loading-popup');
    if (!popup) return;
    const p = overviewLoadStats();
    popup.hidden = !p.active;
    if (!p.active) return;
    const percent = p.targetsLoading ? 0 :
      Math.min(99, Math.floor((p.atsDone + p.historiesDone) /
      Math.max(1, p.atsTotal + p.historiesTotal) * 100));
    const stage = p.catalogLoading ? 'Buscando VTs disponíveis...' :
      p.targetsLoading ? 'Localizando ATs validadas...' :
      p.atsDone < p.atsTotal ? 'Consultando ATs e pedidos...' :
      'Analisando históricos dos pedidos...';
    popup.innerHTML = `<div class="loading-title"><span class="loading-spinner" aria-hidden="true"></span>Carregando relatório AutoAdd</div>
      <p class="loading-subtitle">${stage}</p>
      <div class="loading-row"><span>ATs consultadas</span><strong>${p.atsTotal ? p.atsDone + '/' + p.atsTotal : '—'}</strong></div>
      <div class="loading-row"><span>Históricos analisados</span><strong>${p.historiesDone}/${p.historiesTotal}</strong></div>
      <div class="loading-row"><span>Motivos classificados</span><strong>${p.classified}</strong></div>
      <div class="loading-row"><span>Históricos pendentes</span><strong>${p.historiesPending}</strong></div>
      ${p.failed ? '<div class="loading-row loading-warning"><span>Falhas nas ATs</span><strong>' + p.failed + '</strong></div>' : ''}
      <div class="loading-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <i style="width:${percent}%"></i>
      </div>${p.targetsLoading ? '<small class="loading-indeterminate">Identificando o total de ATs...</small>' : ''}`;
  }


  function reportVtEntry(item) {
    const vt = String(item?.validation_task_id || item?.validationTaskId || item?.task_id || item?.taskId || '').toUpperCase();
    if (!/^VT[A-Z0-9]+$/.test(vt)) return null;
    const raw = item.validation_start_time || item.start_time || item.ctime ||
      item.create_time || item.created_at || item.validation_end_time || 0;
    let dateMs = 0;
    if (typeof raw === 'number' || /^\d+$/.test(String(raw))) {
      const value = Number(raw);
      dateMs = value > 1e12 ? value : value > 1e9 ? value * 1000 : 0;
    } else if (raw) dateMs = Date.parse(raw) || 0;
    return { vt, dateMs: dateMs || reportVtTimestamp(vt) };
  }

  function reportVtChoices() {
    const sorted = [...reportVtCatalog].sort((a,b) =>
      b.dateMs - a.dateMs || b.vt.localeCompare(a.vt));
    const visible = sorted.slice(0, reportVtShown);
    const current = sorted.find(item => item.vt === overviewKey);
    if (current && !visible.some(item => item.vt === current.vt)) {
      if (visible.length >= reportVtShown) visible.pop();
      visible.push(current);
    }
    return visible;
  }

  function renderReportVtFilters() {
    const tab = overviewReportWindow;
    if (!tab || tab.closed) return;
    const doc = tab.document;
    const el = doc.getElementById('spx-report-vt-filters');
    if (!el) return;
    const choices = reportVtChoices();
    const allChecked = choices.length > 0 && choices.length <= REPORT_MAX_SELECTED_VTS &&
      choices.every(item => reportSelectedVts.has(item.vt));
    const anyChecked = choices.some(item => reportSelectedVts.has(item.vt));
    const html = '<div class="vt-filter-head"><div><h2>Selecionar VTs</h2><p class="muted">Selecione até 6 VTs para comparar. ATs repetidas contam somente na VT mais recente.</p></div>' +
      '<span class="vt-selected-count">' + reportSelectedVts.size + '/6 selecionadas</span></div>' +
      '<div class="vt-filter-options">' +
      '<label class="vt-option vt-all"><input type="checkbox" data-vt-all ' +
      (allChecked ? 'checked ' : '') + (anyChecked && !allChecked ? 'data-indeterminate="true" ' : '') +
      '><span>' + (choices.length > 6 ? 'Selecionar as 6 primeiras' : 'Todas as exibidas') + '</span></label>' +
      choices.map(item => '<label class="vt-option"><input type="checkbox" data-report-vt="' +
        reportEscape(item.vt) + '" ' + (reportSelectedVts.has(item.vt) ? 'checked' : '') + '>' +
        '<span><strong>' + reportEscape(item.vt) + '</strong><small>' +
        (item.dateMs ? new Date(item.dateMs).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}) : 'Data não informada') +
        '</small></span></label>').join('') + '</div>' +
      '<div class="vt-filter-actions">' +
      (reportVtHasMore || reportVtShown < reportVtCatalog.length ?
        '<button type="button" data-vt-more ' + (reportVtCatalogLoading ? 'disabled' : '') +
        '>' + (reportVtCatalogLoading ? 'Carregando...' : 'Mais antigas') + '</button>' : '') +
      '<span class="vt-selection-note" id="vt-selection-note"></span></div>';
    if (el.dataset.signature === html) return;
    el.dataset.signature = html;
    el.innerHTML = html;
    const all = el.querySelector('[data-vt-all]');
    if (all) {
      all.indeterminate = anyChecked && !allChecked;
      all.onchange = () => {
        if (all.checked) {
          const six = choices.slice(0, REPORT_MAX_SELECTED_VTS).map(item => item.vt);
          reportSelectedVts = new Set(six);
          for (const vt of six) if (vt !== overviewKey) queueReportVtLoad(vt);
        } else reportSelectedVts.clear();
        renderOverviewReport(); queueOverviewReasonLookup();
      };
    }
    el.querySelectorAll('[data-report-vt]').forEach(input => {
      input.onchange = () => {
        const vt = input.dataset.reportVt;
        if (input.checked) {
          if (reportSelectedVts.size >= REPORT_MAX_SELECTED_VTS) {
            input.checked = false;
            const note = el.querySelector('#vt-selection-note');
            if (note) note.textContent = 'Limite de 6 VTs. Desmarque uma antes de adicionar outra.';
            return;
          }
          reportSelectedVts.add(vt);
          if (vt !== overviewKey) queueReportVtLoad(vt);
        } else reportSelectedVts.delete(vt);
        renderOverviewReport(); queueOverviewReasonLookup();
      };
    });
    const more = el.querySelector('[data-vt-more]');
    if (more) more.onclick = async () => {
      reportVtShown += 6;
      await loadReportVtCatalog();
      renderReportVtFilters();
    };
  }

  async function loadReportVtCatalog() {
    if (!overviewReportWindow || overviewReportWindow.closed || !reportVtHasMore) return;
    if (reportVtCatalogBusy) return reportVtCatalogBusy;
    if (reportVtCatalog.length >= reportVtShown && reportVtPage !== 1) return;
    const generation = reportVtGeneration;
    reportVtCatalogLoading = true;
    renderReportVtFilters();
    renderOverviewLoadingPopup();
    const pending = (async () => {
      try {
        while (reportVtHasMore && (reportVtPage === 1 || reportVtCatalog.length < reportVtShown)) {
          const until = Math.ceil(Date.now() / 1000) + 86400;
          const since = until - 365 * 86400;
          const params = new URLSearchParams({
            page_no: String(reportVtPage), count: String(REPORT_VT_PAGE_SIZE),
            validation_start_time: String(since), validation_end_time: String(until)
          });
          const result = await fetchJson('/api/in-station/lmhub/audit/task/list?' + params);
          if (generation !== reportVtGeneration) return;
          const body = result?.data || {};
          const list = Array.isArray(body.list) ? body.list :
            Array.isArray(body.task_list) ? body.task_list : [];
          const seen = new Set(reportVtCatalog.map(item => item.vt));
          let added = 0;
          for (const task of list) {
            const entry = reportVtEntry(task);
            if (entry && !seen.has(entry.vt)) {
              reportVtCatalog.push(entry);
              seen.add(entry.vt);
              added++;
            } else if (entry?.dateMs) {
              const old = reportVtCatalog.find(item => item.vt === entry.vt);
              if (old && !old.dateMs) old.dateMs = entry.dateMs;
            }
          }
          reportVtPage++;
          if (list.length < REPORT_VT_PAGE_SIZE || !added || reportVtPage > 50) reportVtHasMore = false;
        }
      } catch(error) {
        console.warn('[SPX AutoAdd] Não foi possível listar VTs:', error);
        reportVtHasMore = false;
      } finally {
        if (generation === reportVtGeneration) {
          reportVtCatalogLoading = false;
          reportVtCatalogBusy = null;
          renderReportVtFilters();
          renderOverviewLoadingPopup();
        }
      }
    })();
    reportVtCatalogBusy = pending;
    return pending;
  }

  function queueReportVtLoad(vt) {
    const current = reportVtResults.get(vt);
    if (current && ['targets','loading','done'].includes(current.status)) return;
    const generation = reportVtGeneration;
    reportVtResults.set(vt, { status:'targets', rows:[], done:0, total:0, failed:0 });
    reportVtLoadChain = reportVtLoadChain.catch(() => {}).then(async () => {
      if (generation !== reportVtGeneration || !reportSelectedVts.has(vt)) {
        reportVtResults.delete(vt);
        return;
      }
      const state = reportVtResults.get(vt);
      try {
        const targets = await fetchOverviewTargets(vt);
        if (generation !== reportVtGeneration) return;
        state.rows = targets.map(item => ({ ...item, planned:null, scanned:null, missingIds:[] }));
        const validRows = state.rows.filter(item => item.validated === true);
        state.total = validRows.length;
        state.status = 'loading';
        renderOverviewReport();
        let cursor = 0;
        async function worker() {
          while (cursor < validRows.length && generation === reportVtGeneration && reportSelectedVts.has(vt)) {
            const row = validRows[cursor++];
            try {
              const result = await overviewAtStats(vt, row.at);
              row.planned = result.planned; row.scanned = result.scanned; row.missingIds = result.missingIds;
            } catch(error) {
              state.failed++;
              console.warn('[SPX AutoAdd] AT não consultada:',vt,row.at,error);
            }
            state.done++;
            renderOverviewReport();
            queueOverviewReasonLookup();
          }
        }
        await Promise.all(Array.from({ length: Math.min(2, validRows.length) }, worker));
        state.status = reportSelectedVts.has(vt) ? 'done' : 'cancelled';
      } catch(error) {
        state.status = 'error';
        state.failed++;
        console.warn('[SPX AutoAdd] Falha na VT:',vt,error);
      } finally {
        if (generation === reportVtGeneration) {
          renderOverviewReport();
          queueOverviewReasonLookup();
        }
      }
    });
  }

  function overviewDate(timestamp) {
    const time = Number(timestamp);
    return time ? new Date(time * 1000).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo', hour12:false}) : '';
  }

  function overviewMissingBatchCounts(rows) {
    const counts = new Map();
    for (const item of rows) {
      const state = item.state;
      if (!String(state?.code || '').startsWith('MISSING_') ||
          Number(state?.evidenceEvent?.status) !== 581) continue;
      const key = item.at + '|' + Number(state.evidenceEvent.timestamp);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const item of rows) {
      const state = item.state;
      const key = item.at + '|' + Number(state?.evidenceEvent?.timestamp);
      item.missingBatchCount = String(state?.code || '').startsWith('MISSING_') ?
        (counts.get(key) || 1) : 0;
    }
    return rows;
  }

  function downloadOverviewMissing(doc, vt, rows, format) {
    const records = rows.map(item => {
      const state = item.state || {};
      return {
        vt: item.validationTaskId || vt, shipmentId: item.shipmentId, at: item.at, route: item.route,
        validated: true, reason: state.reason || 'Aguardando consulta',
        reasonCode: state.code || 'PENDING', confidence: state.confidence || 'unknown',
        origin: state.origin || '', occurrence: state.occurrence || '',
        outcome: state.outcome || '', physicalCause: state.physicalCause || '',
        physicalCauseConfidence: state.physicalCauseConfidence || '',
        missingRepeatCount: state.missingCount || 0,
        missingBatchCount: item.missingBatchCount || 0,
        patterns: [
          ...(Number(state.missingCount) > 1 ? ['Missing reincidente'] : []),
          ...(Number(item.missingBatchCount) > 1 ? ['Missing em lote'] : [])
        ].join(' | '),
        resolutionTimestamp: state.resolutionTimestamp || null,
        resolutionDateTime: overviewDate(state.resolutionTimestamp),
        resolutionEvent: state.resolutionEvent || null,
        explanation: state.details || '', generatedAt: new Date().toISOString(),
        autoAddTimestamp: state.originEvent?.timestamp || null,
        autoAddDateTime: overviewDate(state.originEvent?.timestamp),
        causeTimestamp: state.evidenceEvent?.timestamp || null,
        causeDateTime: overviewDate(state.evidenceEvent?.timestamp),
        elapsedMinutes: state.elapsedMinutes ?? null,
        sourceFromOnHold: Boolean(state.sourceContext?.fromOnHold),
        priorOnHoldTimestamp: state.sourceContext?.onHoldEvent?.timestamp || null,
        priorOnHoldDateTime: overviewDate(state.sourceContext?.onHoldEvent?.timestamp),
        priorOnHoldReason: state.sourceContext?.onHoldEvent?.on_hold_reason || '',
        priorOnHoldOperator: state.sourceContext?.onHoldEvent?.operator || '',
        priorReceiptTimestamp: state.sourceContext?.receivedEvent?.timestamp || null,
        priorReceiptDateTime: overviewDate(state.sourceContext?.receivedEvent?.timestamp),
        sourceContext: state.sourceContext || null,
        operator: state.evidenceEvent?.operator || '', eventStatus: state.evidenceEvent?.status ?? '',
        eventMessage: state.evidenceEvent?.message || '',
        onHoldReason: state.evidenceEvent?.on_hold_reason || '',
        stationId: state.evidenceEvent?.station_id ?? '',
        stationName: state.evidenceEvent?.station_name || '',
        destinationAt: state.destinationAt || '',
        vehicleType: state.vehicleType || '',
        vehicleSource: state.vehicleSource || '',
        vehicleField: state.vehicleField || '',
        vehicleRaw: state.vehicleRaw || '',
        vehicleLookupError: state.vehicleLookupError || '',
        analysisDateTime: state.analyzedAt ? new Date(state.analyzedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '',
        subsequentEvents: state.eventsAfterOrigin || [],
        originalAutoAddEvent: state.originEvent || null,
        causeEvent: state.evidenceEvent || null
      };
    });
    const timestamp = new Date().toISOString().slice(0,19).replace(/[T:]/g,'-');
    const filename = 'autoadd-faltantes-' + vt + '-' + timestamp;
    let content, type, extension;
    if (format === 'json') {
      content = JSON.stringify({
        schema:'spx-autoadd-vt-missing-v5', exportedAt:new Date().toISOString(),
        timezone:'America/Sao_Paulo', validatedATsOnly:true, selectedVTs:sortedReportVts(),
        total:records.length, records
      },null,2);
      type = 'application/json;charset=utf-8'; extension = 'json';
    } else {
      const cols = [
        ['vt','VT'], ['shipmentId','BR'], ['at','AT original'], ['route','Rota'],
        ['validated','AT validada'], ['reason','Motivo principal'], ['reasonCode','Código motivo'],
        ['confidence','Confiança'], ['origin','Origem'], ['occurrence','Ocorrência'],
        ['outcome','Desfecho posterior'], ['physicalCause','Causa física'],
        ['physicalCauseConfidence','Confiança causa física'], ['patterns','Padrões'],
        ['missingRepeatCount','Marcações Missing'], ['missingBatchCount','Missing simultâneos na AT'],
        ['resolutionDateTime','Última regularização/saída'],
        ['autoAddDateTime','AutoAdd data/hora'], ['causeDateTime','Causa data/hora'],
        ['elapsedMinutes','Intervalo minutos'], ['sourceFromOnHold','Veio de On Hold'],
        ['priorOnHoldDateTime','On Hold anterior data/hora'], ['priorOnHoldReason','Motivo On Hold anterior'],
        ['priorOnHoldOperator','Motorista do On Hold'], ['priorReceiptDateTime','Recebido antes AutoAdd'],
        ['operator','Operador do evento'],
        ['eventStatus','Status'], ['eventMessage','Evento principal'],
        ['onHoldReason','Motivo on-hold'], ['stationId','ID hub'], ['stationName','Hub'],
        ['destinationAt','AT posterior'], ['vehicleType','Veículo AT original'],
        ['vehicleSource','Fonte veículo'], ['vehicleField','Campo veículo'], ['vehicleRaw','Valor original veículo'],
        ['vehicleLookupError','Erro consulta veículo'], ['analysisDateTime','Consulta data/hora'],
        ['explanation','Observações'], ['subsequentEvents','Linha do tempo completa']
      ];
      const lines = [cols.map(c=>c[1]),...records.map(r=>cols.map(c=>c[0] === 'subsequentEvents' ?
        r.subsequentEvents.map(e=>overviewDate(e.timestamp)+' [status '+e.status+'] '+e.message+' ('+e.operator+')').join(' | ') : r[c[0]]))];
      content = '\uFEFF' + lines.map(line=>line.map(value=>'"'+String(value ?? '').replace(/"/g,'""')+'"').join(';')).join('\r\n');
      type = 'text/csv;charset=utf-8'; extension = 'csv';
    }
    const url = URL.createObjectURL(new Blob([content], {type}));
    const a = doc.createElement('a');
    a.href=url; a.download=filename+'.'+extension; doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }

  function renderOverviewReport() {
    const tab = overviewReportWindow;
    if (!tab || tab.closed || !overviewKey) return;
    try {
      const doc = tab.document;
      if (!doc.getElementById('spx-report-content')) return;
      const data = reportData();
      const { done, total, failed, loadingTargets } = reportCurrentProgress();
      const isPartial = loadingTargets || done < total || failed > 0;
      const color = overviewColor(data.percent);
      const classes = data.active.length;
      const redPercent = classes ? data.red/classes*100 : 0;
      const yellowPercent = classes ? data.yellow/classes*100 : 0;
      const greenPercent = classes ? data.green/classes*100 : 0;
      const ranking = [...data.active].sort((a,b)=>b.pending-a.pending || a.pct-b.pct);
      const offenders = ranking.filter(item=>item.pending>0).slice(0,8);
      const routeCards = [...data.active].sort((a,b)=>a.pct-b.pct || b.pending-a.pending).map(item => `
        <article class="route"><div class="route-title"><strong>${reportEscape(item.route)}</strong><small>${reportEscape(item.at)}</small><b style="color:${overviewColor(item.pct)}">${formatPercent(item.pct)}</b></div>
        <div class="bar"><i style="width:${item.pct}%;background:${overviewColor(item.pct)}"></i></div>
        <div class="route-meta"><span>${item.scanned} de ${item.planned} carregados</span><strong>${item.pending} pendentes</strong></div></article>`).join('');
      const qualityPie = `conic-gradient(#ef4444 0 ${redPercent}%,#f59e0b ${redPercent}% ${redPercent+yellowPercent}%,#22c55e ${redPercent+yellowPercent}% 100%)`;
      const loadedPie = `conic-gradient(#22c55e 0 ${data.percent}%,#ef4444 ${data.percent}% 100%)`;
      const missingRows = overviewMissingBatchCounts(data.missing.map(item => ({
        ...item, state: overviewReasons.get(item.shipmentId + '|' + item.at) || null
      })));
      const reasonCounts = new Map();
      missingRows.forEach(item => {
        if (!overviewReasonReady(item.state)) return;
        const name = item.state.reason;
        reasonCounts.set(name, (reasonCounts.get(name) || 0) + 1);
      });
      const reasonsSorted = [...reasonCounts].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
      const maxReason = Math.max(1,...reasonsSorted.map(x=>x[1]));
      const reasonGraph = reasonsSorted.map(([name,quantity]) =>
        '<div class="reason-row"><div class="reason-info"><span>' + reportEscape(name) +
        '</span><strong>' + quantity + '</strong></div><div class="reason-track"><i style="width:' +
        Math.max(2,quantity/maxReason*100) + '%"></i></div></div>'
      ).join('');
      const classifiedCount = missingRows.filter(item => overviewReasonReady(item.state)).length;
      const missingDetails = missingRows.map(item => {
        const state = item.state;
        return '<tr><td><strong>' + reportEscape(item.shipmentId) + '</strong></td><td>' +
          reportEscape(item.at) + '<small>' + reportEscape(item.route) + '</small></td>' +
          '<td>' + reportEscape(state?.reason || 'Aguardando consulta...') +
          (state?.destinationAt ? '<small>AT posterior: ' + reportEscape(state.destinationAt) + '</small>' : '') +
          (state?.sourceContext?.fromOnHold ? '<small>On Hold anterior: ' +
            reportEscape(overviewDate(state.sourceContext.onHoldEvent?.timestamp)) + '</small>' : '') +
          (state?.origin ? '<small>Origem: ' + reportEscape(state.origin) + '</small>' : '') +
          (state?.occurrence ? '<small>Ocorrência: ' + reportEscape(state.occurrence) + '</small>' : '') +
          (state?.outcome ? '<small>Desfecho: ' + reportEscape(state.outcome) + '</small>' : '') +
          (state?.physicalCause ? '<small>Causa física: ' + reportEscape(state.physicalCause) + '</small>' : '') +
          (Number(item.missingBatchCount) > 1 ? '<small>Missing em lote: ' + reportEscape(item.missingBatchCount) + ' pedidos na mesma AT/segundo</small>' : '') +
          (Number(state?.missingCount) > 1 ? '<small>Missing reincidente: ' + reportEscape(state.missingCount) + ' marcações</small>' : '') +
          (state?.elapsedMinutes != null ? '<small>Tempo até ocorrência: ' + reportEscape(state.elapsedMinutes) + ' min</small>' : '') +
          '</td><td><small>AutoAdd: ' + reportEscape(overviewDate(state?.originEvent?.timestamp) || '—') + '</small>' +
          '<small>Causa: ' + reportEscape(overviewDate(state?.evidenceEvent?.timestamp) || '—') +
          '</small></td></tr>';
      }).join('');
      doc.getElementById('spx-report-content').innerHTML = `
        <div class="report-head"><div><div class="eyebrow">DESEMPENHO DA OPERAÇÃO</div><h1>Relatório AutoAdd das VTs</h1><p class="muted">${reportEscape(sortedReportVts().join(' · '))} · ${new Date().toLocaleString('pt-BR')} · Apenas ATs validadas</p></div>
        <div class="report-actions"><span class="muted">Somente ATs validadas</span></div></div>
        <p class="notice">${isPartial ? 'Relatório parcial: '+done+' de '+total+' ATs verificadas'+(failed?' · '+failed+' falhas de consulta':'')+'. Os percentuais usam somente ATs com dados confirmados.' : 'Relatório consolidado: '+done+' ATs verificadas.'} </p>
        <div class="metrics"><div class="metric"><span>Pedidos AutoAdd</span><strong>${data.planned}</strong></div><div class="metric"><span>Carregados</span><strong class="green">${data.scanned}</strong></div><div class="metric"><span>Pendentes</span><strong class="red">${data.pending}</strong></div><div class="metric"><span>Taxa de carregamento</span><strong style="color:${color}">${formatPercent(data.percent)}</strong></div><div class="metric"><span>Rotas com AutoAdd</span><strong>${classes}</strong></div></div>
        <div class="charts"><section class="panel"><h2>Qualidade por rota</h2><div class="donut-row"><div class="donut" style="background:${qualityPie}"><div>${classes}<small>rotas</small></div></div><div class="legend"><div><i style="background:#ef4444"></i> Críticas (&lt;60,00%) <b>${data.red}</b></div><div><i style="background:#f59e0b"></i> Atenção (60,00–89,99%) <b>${data.yellow}</b></div><div><i style="background:#22c55e"></i> Boas (≥90,00%) <b>${data.green}</b></div></div></div></section>
        <section class="panel"><h2>Carregamento dos pedidos</h2><div class="donut-row"><div class="donut" style="background:${loadedPie}"><div>${formatPercent(data.percent)}<small>carregado</small></div></div><div class="legend"><div><i style="background:#22c55e"></i> Carregados <b>${data.scanned}</b></div><div><i style="background:#ef4444"></i> Pendentes <b>${data.pending}</b></div></div></div></section></div>
        <div class="sections"><section class="panel"><h2>Rotas ofensoras</h2><p class="muted">Classificadas pela maior quantidade de pedidos AutoAdd pendentes.</p>${offenders.length ? offenders.map((item,i)=>`<div class="offender"><span class="rank">${i+1}</span><div><strong>${reportEscape(item.route)}</strong><small>${reportEscape(item.at)} · ${formatPercent(item.pct)} concluído</small></div><b>${item.pending} pendentes</b></div>`).join('') : '<p class="muted">Nenhuma pendência identificada nas ATs consultadas.</p>'}</section>
        <section class="panel"><div class="section-header"><h2>Pedidos AutoAdd faltantes</h2><div class="report-actions"><button type="button" data-missing-csv>Exportar CSV</button><button type="button" data-missing-json>Exportar JSON</button></div></div><p class="muted">Somente ATs validadas · ${missingRows.length} pedidos pendentes · ${classifiedCount} com motivo mapeado. Datas e horários de Brasília.</p>${reasonGraph ? '<div class="missing-reasons"><div class="section-header"><h3>Ocorrências e desfechos dos AutoAdd faltantes</h3><span>' + classifiedCount + '/' + missingRows.length + ' classificados</span></div><div class="reason-list">' + reasonGraph + '</div></div>' : ''}<div class="missing-table-wrap"><table class="missing-table"><thead><tr><th>Pedido</th><th>AT / Rota</th><th>Ocorrência / desfecho</th><th>Quando</th></tr></thead><tbody>${missingDetails || '<tr><td colspan="4">Nenhuma pendência encontrada nas ATs validadas.</td></tr>'}</tbody></table></div></section></div>
        <section class="panel"><div class="section-header"><h2>Detalhamento das ATs validadas</h2><span>${classes} rotas com AutoAdd · ${data.rows.length} ATs consultadas</span></div><div class="route-grid">${routeCards || '<p class="muted">Nenhum pedido AutoAdd identificado nos dados consultados.</p>'}</div></section>
        <footer>Fonte: consultas da VT feitas pelo Assistente de AutoAdd. Classificação visual: vermelho &lt;60,00%, amarelo 60,00–89,99%, verde ≥90,00%. Meta operacional: 100% dos AutoAdd carregados. Status parcial não deve ser interpretado como resultado final. Missing (581) não comprova falha física de alocação em gaiola.</footer>`;
      doc.querySelector('[data-missing-csv]').onclick = () => downloadOverviewMissing(doc, overviewKey, missingRows, 'csv');
      doc.querySelector('[data-missing-json]').onclick = () => downloadOverviewMissing(doc, overviewKey, missingRows, 'json');
      renderReportVtFilters();
      renderOverviewLoadingPopup();
    } catch (error) { console.warn('[SPX AutoAdd] Relatório indisponível:',error); }
  }

  function openOverviewReport() {
    if (!overviewKey) return;
    let tab=overviewReportWindow;
    if (!tab || tab.closed) {
      tab=window.open('','_blank');
      if (!tab) { alert('Permita pop-ups para abrir o relatório da VT.'); return; }
      overviewReportWindow=tab;
      reportVtGeneration++;
      reportSelectedVts = new Set([overviewKey]);
      reportVtCatalog = [{ vt: overviewKey, dateMs: reportVtTimestamp(overviewKey) }];
      reportVtShown = 6;
      reportVtPage = 1;
      reportVtHasMore = true;
      reportVtCatalogLoading = false;
      reportVtResults = new Map();
      reportVtCatalogBusy = null;
      reportVtLoadChain = Promise.resolve();
      tab.document.open();
      tab.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AutoAdd · Relatório da VT</title><style>
        *{box-sizing:border-box}body{margin:0;background:#0b1220;color:#f8fafc;font:13px/1.5 system-ui,Arial,sans-serif}main{max-width:1300px;margin:auto;padding:30px 24px}
        h1{font-size:27px;letter-spacing:-.5px;margin:4px 0}h2{font-size:17px;margin:0 0 12px}p{margin:7px 0}.muted{color:#93a6c1}.eyebrow{font-size:11px;color:#93c5fd;letter-spacing:.12em;font-weight:850}
        .report-head,.report-actions,.donut-row,.section-header{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap}.report-head{margin-bottom:22px}.report-actions{justify-content:flex-end}
        button{border:1px solid #42536f;background:#233955;color:#e8f1ff;padding:10px 14px;border-radius:9px;font-weight:750;cursor:pointer}
        .vt-filters{margin-bottom:18px;padding:16px 18px}.vt-filter-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.vt-filter-head h2{margin:0;font-size:15px}.vt-filter-head p{font-size:11px}.vt-selected-count{font-size:11px;color:#bfdbfe;background:#2563eb26;border-radius:20px;padding:5px 10px}
        .vt-filter-options{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:14px 0}.vt-option{display:flex;align-items:center;gap:9px;min-width:0;cursor:pointer;background:#1c2d45;border:1px solid #394c67;border-radius:10px;padding:10px 9px;font-size:11px}.vt-option:has(input:checked){background:#1c3b59;border-color:#60a5fa}.vt-option input{accent-color:#3b82f6;flex:none}.vt-option span{min-width:0}.vt-option strong{display:block;overflow-wrap:anywhere;font-size:10.5px}.vt-option small{display:block;margin-top:3px;color:#9ab0c8}.vt-all{background:#253650;font-weight:750}.vt-filter-actions{display:flex;align-items:center;gap:12px}.vt-filter-actions button{font-size:11px;padding:8px 12px}.vt-selection-note{color:#fbbf24;font-size:11px}
        @media(max-width:850px){.vt-filter-options{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:460px){.vt-filter-options{grid-template-columns:1fr}}
        .notice{padding:12px 14px;background:#142944;border:1px solid #2e557f;color:#c7d9f5;border-radius:9px;margin-bottom:18px}
        .metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}.metric,.panel{background:#152136;border:1px solid #31415b;border-radius:14px;padding:19px}.metric span{font-size:11px;color:#99aecb;display:block}.metric strong{display:block;margin-top:7px;font-size:26px}.green{color:#22c55e}.red{color:#ef4444}
        .charts,.sections{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}.donut-row{justify-content:flex-start;gap:30px;min-height:200px}.donut{width:177px;height:177px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto}.donut>div{background:#152136;width:121px;height:121px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column;font-size:24px;font-weight:900}.donut small{font-size:11px;font-weight:400;color:#9fb0c9}
        .legend{flex:1;min-width:170px}.legend div{display:flex;align-items:center;gap:9px;margin:12px 0;color:#b9c9df}.legend i{width:10px;height:10px;border-radius:3px;flex:0 0 auto}.legend b{margin-left:auto;color:#fff}
        .offender{display:flex;align-items:center;gap:12px;border-top:1px solid #31415b;padding:12px 0}.offender>div{flex:1}.offender small{display:block;color:#93a6c1}.offender b{color:#fda4af}.rank{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:#3f2636;color:#fda4af;font-weight:850}
        .missing-table-wrap{overflow-x:auto;max-height:330px;overflow-y:auto}.missing-table{width:100%;border-collapse:collapse;font-size:11px;text-align:left}.missing-table th,.missing-table td{padding:9px 8px;border-bottom:1px solid #30415b;vertical-align:top}.missing-table th{position:sticky;top:0;background:#152136;color:#93a6c1}.missing-table small{display:block;margin-top:3px;color:#93a6c1}
        .missing-reasons{padding:14px 0 18px;margin:14px 0 16px;border-top:1px solid #30415b;border-bottom:1px solid #30415b}.missing-reasons .section-header{margin-bottom:13px}.missing-reasons h3{font-size:13px;font-weight:750;margin:0}.reason-list{display:grid;grid-template-columns:minmax(0,1fr);gap:13px}.reason-row{min-width:0}.reason-info{display:flex;align-items:start;justify-content:space-between;gap:12px;font-size:12px;margin-bottom:6px;color:#d7e5f7}.reason-info strong{font-size:13px;color:#f8fafc}.reason-track{height:9px;background:#30435f;border-radius:20px;overflow:hidden}.reason-track i{display:block;background:linear-gradient(90deg,#2563eb,#60a5fa);height:100%;border-radius:20px}.reason-row:last-child .reason-track i{background:#64748b}.route-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.route{background:#192a42;border:1px solid #304664;border-radius:11px;padding:13px}.route-title{display:grid;grid-template-columns:1fr auto;gap:0 8px}.route-title strong{font-size:15px}.route-title small{grid-column:1;color:#93a6c1}.route-title b{grid-column:2;grid-row:1/3;font-size:17px}.bar{height:8px;border-radius:99px;overflow:hidden;background:#34455f;margin:10px 0}.bar i{display:block;height:100%;border-radius:99px}.route-meta{display:flex;justify-content:space-between;font-size:11px;color:#a6b8d0}.route-meta strong{color:#f8fafc}.section-header span{color:#94a3b8;font-size:11px}
        #spx-report-loading-popup{position:fixed;right:18px;bottom:18px;z-index:9999;width:min(306px,calc(100vw - 36px));padding:17px;border-radius:14px;background:#14243b;border:1px solid #36516f;color:#eef5ff;box-shadow:0 18px 54px #0009}
        #spx-report-loading-popup[hidden]{display:none!important}
        .loading-title{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:800}
        .loading-spinner{width:16px;height:16px;flex:none;border:2px solid #466587;border-top-color:#60a5fa;border-radius:50%;animation:spin .85s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .loading-subtitle{font-size:11px;color:#a5bfdf;margin:7px 0 12px}
        .loading-row{display:flex;justify-content:space-between;gap:16px;font-size:11px;color:#c4d3e6;margin:7px 0}
        .loading-row strong{color:#fff;font-size:12px}
        .loading-warning strong{color:#fbbf24}
        .loading-progress{height:7px;overflow:hidden;background:#304560;border-radius:99px;margin-top:13px}
        .loading-progress i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#2563eb,#60a5fa);transition:width .3s ease}
        .loading-indeterminate{display:block;margin-top:6px;font-size:10px;color:#a5bfdf}
        footer{color:#91a5c0;font-size:11px;margin-top:20px;padding-bottom:25px} @media(max-width:980px){.metrics{grid-template-columns:repeat(3,1fr)}.route-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:680px){main{padding:16px}.metrics{grid-template-columns:repeat(2,1fr)}.charts,.sections,.route-grid{grid-template-columns:1fr}.donut{width:145px;height:145px}.donut>div{width:100px;height:100px}}
        body{font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#0b1220}main{max-width:1260px}
        .panel,.metric{border-radius:14px;background:#152238;border-color:#334155}button{background:#23344d;border:1px solid #3b4a60;border-radius:9px}button:hover{background:#30445d}
        button:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
        .route{border-radius:11px;background:#1b2b43}.eyebrow{color:#93c5fd}
                @media print{#spx-report-loading-popup{display:none!important}body{background:white;color:#172033}.panel,.metric,.route{background:white;color:#172033;border-color:#d0d7e0}button{display:none}.notice{color:#172033;background:white}.muted,footer{color:#475569}}
      </style></head><body><main><section id="spx-report-vt-filters" class="panel vt-filters"></section><div id="spx-report-content"></div></main><aside id="spx-report-loading-popup" role="status" aria-live="off" hidden></aside></body></html>`);
      tab.document.close();
    }
    renderOverviewReport();
    queueOverviewReasonLookup();
    renderOverviewLoadingPopup();
    if (reportVtPage === 1 && !reportVtCatalogLoading) void loadReportVtCatalog();
    tab.focus();
  }

  async function fetchOverviewTargets(vt, signal) {
    const items = new Map();
    for (let page = 1; page <= 100; page++) {
      const url = '/api/in-station/lmhub/audit/target/list?' + new URLSearchParams({ task_id: vt, page_no: String(page), count: '100' });
      const data = (await fetchJson(url, {}, signal))?.data || {};
      const list = Array.isArray(data.list) ? data.list : [];
      const previousCount = items.size;
      for (const item of list) {
        const at = String(item?.target_id || '').toUpperCase();
        if (/^AT[A-Z0-9]+$/.test(at)) items.set(at, { at, route: String(item.binding_entity || '-'), validated: Number(item.validation_status) === 4 });
      }
      if (list.length === 0 || items.size === previousCount || (Number(data.total || data.all_qty || 0) > 0 && items.size >= Number(data.total || data.all_qty || 0))) break;
    }
    return [...items.values()];
  }

  async function overviewAtStats(vt, at, signal, force = false) {
    const cacheKey = vt + '|' + at;
    const existing = overviewAtStatsCache.get(cacheKey);
    if (!force && existing && existing.expiresAt > Date.now()) return existing.data;
    const planned = await fetchPlannedAutoAdd({ assignmentTaskId: at, validationTaskId: vt }, signal);
    if (!planned.length) {
      const empty = { planned: 0, scanned: 0, missingIds: [] };
      overviewAtStatsCache.set(cacheKey, { data: empty, expiresAt: Date.now() + OVERVIEW_STATS_CACHE_MS });
      return empty;
    }

    const params = new URLSearchParams({ validation_task_id: vt, target_id: at, audit_target_type: '2', page_no: '1', count: '999', parcel_scan_status: '2', shipment_id: '' });
    const scanned = new Set();
    for (let page = 1; page <= 100; page++) {
      params.set('page_no', String(page));
      const data = await fetchJson(SCANNED_URL + '?' + params, {}, signal);
      const list = Array.isArray(data?.data?.list) ? data.data.list : [];
      const beforeCount = scanned.size;
      for (const item of list) scanned.add(String(item.shipment_id || '').toUpperCase());
      if (!list.length || scanned.size === beforeCount || (Number(data?.data?.total || 0) > 0 && scanned.size >= Number(data.data.total))) break;
    }

    const missingIds = planned.map(item => item.shipmentId).filter(id => !scanned.has(id));
    const result = { planned: planned.length, scanned: planned.length - missingIds.length, missingIds };
    overviewAtStatsCache.set(cacheKey, { data: result, expiresAt: Date.now() + OVERVIEW_STATS_CACHE_MS });
    if (overviewAtStatsCache.size > 1000) overviewAtStatsCache.delete(overviewAtStatsCache.keys().next().value);
    return result;
  }


  async function refreshOverview(vt, force = false) {
    if (!vt || overviewKey !== vt) return;
    if (force && Date.now() - overviewLastManualRefreshAt < 30000) return;
    if (force) overviewLastManualRefreshAt = Date.now();
    if (overviewController) {
      if (!force) return;
      overviewController.abort();
    }
    const controller = new AbortController();
    overviewController = controller;
    overviewLoadingTargets = true;
    renderOverviewLoadingPopup();
    overviewMessage('<span>Consultando ATs e pedidos AutoAdd da VT...</span>');
    try {
      const allAts = await fetchOverviewTargets(vt, controller.signal);
      if (controller.signal.aborted || overviewKey !== vt) return;
      overviewAllTargets = allAts;
      const ats = allAts.filter(item => item.validated === true);
      const rows = ats.map(item => ({ ...item, planned: null, scanned: null }));
      overviewReportRows = rows;
      overviewReportProgress = { done: 0, total: ats.length, failed: 0 };
      overviewLoadingTargets = false;
      renderOverviewReport();
      let index = 0;
      let done = 0;
      let failed = 0;
      function render() {
        if (controller.signal.aborted || overviewKey !== vt) return;
        const known = rows.filter(x => x.planned !== null);
        const total = known.reduce((n,x) => n + x.planned, 0);
        const loaded = known.reduce((n,x) => n + x.scanned, 0);
        const pct = total ? loaded / total * 100 : 0;
        const host = overviewHost();
        host.querySelector('[data-status]').textContent = done + '/' + ats.length + ' ATs ' + (overviewValidatedOnly ? 'validadas consultadas' : 'consultadas') + (failed ? ' · ' + failed + ' falhas' : '');
        host.querySelector('[data-brief]').textContent = total + ' AutoAdd · ' + loaded + ' carregados · ' + (total - loaded) + ' pendentes';
        host.querySelector('[data-percent]').textContent = formatPercent(pct) + (done < ats.length ? ' *' : '');
        const bar = host.querySelector('[data-progress]');
        bar.style.width = pct + '%';
        bar.style.background = overviewColor(pct);
        const items = rows.filter(x => x.planned > 0).sort((x,y) => x.scanned / x.planned - y.scanned / y.planned);
        const cards = items.map(item => {
          const progress = item.scanned / item.planned * 100;
          const color = overviewColor(progress);
          return '<article class="ov-route"><div class="ov-route-head"><div><div class="ov-route-name">' + item.route.replace(/[&<>"']/g, '') + '</div><div class="ov-route-id">' + item.at + '</div></div><strong class="ov-route-percent" style="color:' + color + '">' + formatPercent(progress) + '</strong></div>' +
            '<div class="ov-route-meta"><span>' + item.scanned + ' / ' + item.planned + ' carregados</span><span>' + (item.planned-item.scanned) + ' pendentes</span></div><div class="ov-bar"><i style="width:' + progress + '%;background:' + color + '"></i></div></article>';
        }).join('');
        overviewMessage('<div class="ov-metrics"><div class="ov-metric"><span>AutoAdd</span><strong>' + total + '</strong></div><div class="ov-metric"><span>Carregados</span><strong style="color:#22c55e">' + loaded + '</strong></div><div class="ov-metric"><span>Pendentes</span><strong style="color:#f59e0b">' + (total-loaded) + '</strong></div></div>' +
          '<p style="color:#94a3b8;font-size:10px">Vermelho: &lt;60,00% · Amarelo: 60,00–89,99% · Verde: ≥90,00%. ' + (done < ats.length ? 'Resumo parcial.' : failed ? 'Algumas ATs não puderam ser consultadas.' : '') + '</p>' +
          (cards || '<p style="color:#94a3b8">' + (overviewValidatedOnly && !ats.length ? 'Nenhuma rota validada nesta VT.' : 'Nenhuma AT com AutoAdd identificada até o momento.') + '</p>'));
      }
      render();
      async function worker() {
        while (index < rows.length && !controller.signal.aborted) {
          const item = rows[index++];
          try {
            const stats = await overviewAtStats(vt, item.at, controller.signal, force);
            item.planned = stats.planned;
            item.scanned = stats.scanned;
            item.missingIds = stats.missingIds;
          } catch (error) {
            if (controller.signal.aborted) break;
            failed++;
          }
          done++;
          overviewReportProgress = { done, total: rows.length, failed };
        if (done % 5 === 0 || done === rows.length) { render(); renderOverviewReport(); queueOverviewReasonLookup(); }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, rows.length) }, worker));
      render();
    } catch (error) {
      if (!controller.signal.aborted) overviewMessage('<span style="color:#fca5a5">' + String(error.message || error).replace(/[&<>"]/g, '') + '</span>');
    } finally {
      if (overviewController === controller) {
        overviewLoadingTargets = false;
        renderOverviewLoadingPopup();
        overviewController = null;
        clearTimeout(overviewTimer);
        if (overviewKey === vt) overviewTimer = setTimeout(() => refreshOverview(vt), OVERVIEW_REFRESH_MS);
      }
    }
  }

  function checkOverview() {
    const vt = overviewContext();
    if (vt === overviewKey) return;
    clearTimeout(overviewTimer);
    overviewController?.abort();
    overviewController = null;
    document.getElementById(OVERVIEW_ID)?.remove();
    overviewKey = vt || '';
    overviewReportRows = [];
    overviewAllTargets = [];
    reportSelectedVts = new Set();
    reportVtCatalog = [];
    reportVtResults = new Map();
    reportVtGeneration++;
    reportVtShown = 6;
    reportVtPage = 1;
    reportVtHasMore = true;
    reportVtCatalogLoading = false;
    reportVtCatalogBusy = null;
    overviewReportProgress = { done: 0, total: 0, failed: 0 };
    overviewLoadingTargets = false;
    if (overviewReportWindow && !overviewReportWindow.closed) { overviewReportWindow.close(); }
    overviewReportWindow = null;
    if (vt) void refreshOverview(vt);
  }

  function checkLocation() {
    checkOverview();
    if (destroyed) return;
    const context = getRouteContext();
    if (!context) {
      if (routeContext) deactivate();
      return;
    }
    if (context.key !== routeKey) activate(context);
  }

  function start() {
    checkLocation();
    window.addEventListener('hashchange', checkLocation);
    window.addEventListener('popstate', checkLocation);
    locationTimer = window.setInterval(checkLocation, LOCATION_WATCH_MS);
  }

  function stop() {
    reportVtGeneration++;
    destroyed = true;
    window.removeEventListener('hashchange', checkLocation);
    window.removeEventListener('popstate', checkLocation);
    window.clearInterval(locationTimer);
    clearTimeout(overviewTimer);
    overviewController?.abort();
    document.getElementById(OVERVIEW_ID)?.remove();
    deactivate();
    delete document.documentElement.dataset[MARKER];
  }

  window.addEventListener('pagehide', stop, { once: true });
  start();
})();
