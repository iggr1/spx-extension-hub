(function initializeAutoAddAssistant() {
  const MARKER = 'spxAutoAddAssistantV1';
  const PANEL_ID = 'spx-autoadd-assistant-panel';
  const TARGET_HASH_PREFIX = '#/mercadao/audit-list/at-to-detail';
  const STATION_URL = '/api/admin/basicserver/current_user/station_list/?count=50&status_list=0';
  const PLANNED_URL = '/spx_delivery/admin/assignment/assignment_task/detail/planned_order/search';
  const SCANNED_URL = '/api/in-station/lmhub/audit/parcel/list';
  const TRACKING_URL = '/api/fleet_order/order/detail/tracking_info';
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
    const percent = total ? Math.round((loaded / total) * 100) : 100;

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
      nodes.summaryValue.textContent = `${percent}%`;
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
  let overviewReportProgress = { done: 0, total: 0, failed: 0 };
  let overviewReportWindow = null;
  const overviewReasons = new Map();
  let overviewReasonBusy = 0;
  let overviewValidatedOnly = loadOverviewValidatedOnly();

  function overviewContext() {
    if (location.origin !== 'https://spx.shopee.com.br' || !location.hash.startsWith('#/mercadao/audit-list/vt-detail')) return null;
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const vt = String(params.get('vt-task-id') || params.get('vt_task_id') || params.get('task_id') || '').toUpperCase();
    return /^VT[A-Z0-9]+$/.test(vt) ? vt : null;
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
        <label class="ov-filter" title="Desmarque para incluir todas as ATs da VT, mesmo as não validadas">
          <input type="checkbox" data-overview-validated-only ${overviewValidatedOnly ? 'checked' : ''}>
          <span>Apenas rotas validadas</span>
        </label>
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
    host.querySelector('[data-overview-validated-only]').addEventListener('change', event => {
      overviewValidatedOnly = event.currentTarget.checked;
      saveOverviewValidatedOnly(overviewValidatedOnly);
      if (overviewKey) void refreshOverview(overviewKey, true);
    });
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

  function reportData() {
    const rows = overviewReportRows.filter(item => Number.isFinite(item.planned) && Number.isFinite(item.scanned));
    const active = rows.filter(item => item.planned > 0).map(item => ({
      ...item, pending: Math.max(0, item.planned - item.scanned),
      pct: Math.round(Math.min(100, item.scanned / item.planned * 100))
    }));
    const planned = active.reduce((n,item) => n + item.planned, 0);
    const scanned = active.reduce((n,item) => n + item.scanned, 0);
    const missing = rows.flatMap(item => (item.missingIds || []).map(shipmentId => ({
      shipmentId, at: item.at, route: item.route, validationTaskId: overviewKey
    })));
    return { rows, active, missing, planned, scanned, pending: Math.max(0, planned-scanned),
      percent: planned ? Math.round(scanned / planned * 100) : 0,
      red: active.filter(item=>item.pct<60).length,
      yellow: active.filter(item=>item.pct>=60&&item.pct<90).length,
      green: active.filter(item=>item.pct>=90).length };
  }

  function renderOverviewReport() {
    const tab = overviewReportWindow;
    if (!tab || tab.closed || !overviewKey) return;
    try {
      const doc = tab.document;
      if (!doc.getElementById('spx-report-content')) return;
      const data = reportData();
      const { done, total, failed } = overviewReportProgress;
      const isPartial = done < total || failed > 0;
      const color = overviewColor(data.percent);
      const classes = data.active.length;
      const redPercent = classes ? data.red/classes*100 : 0;
      const yellowPercent = classes ? data.yellow/classes*100 : 0;
      const greenPercent = classes ? data.green/classes*100 : 0;
      const ranking = [...data.active].sort((a,b)=>b.pending-a.pending || a.pct-b.pct);
      const offenders = ranking.filter(item=>item.pending>0).slice(0,8);
      const routeCards = [...data.active].sort((a,b)=>a.pct-b.pct || b.pending-a.pending).map(item => `
        <article class="route"><div class="route-title"><strong>${reportEscape(item.route)}</strong><small>${reportEscape(item.at)}</small><b style="color:${overviewColor(item.pct)}">${item.pct}%</b></div>
        <div class="bar"><i style="width:${item.pct}%;background:${overviewColor(item.pct)}"></i></div>
        <div class="route-meta"><span>${item.scanned} de ${item.planned} carregados</span><strong>${item.pending} pendentes</strong></div></article>`).join('');
      const qualityPie = `conic-gradient(#ef4444 0 ${redPercent}%,#f59e0b ${redPercent}% ${redPercent+yellowPercent}%,#22c55e ${redPercent+yellowPercent}% 100%)`;
      const loadedPie = `conic-gradient(#22c55e 0 ${data.percent}%,#ef4444 ${data.percent}% 100%)`;
      const missingDetails = data.missing.map(item =>
        '<tr><td>' + reportEscape(item.shipmentId) + '</td><td>' +
        reportEscape(item.at) + '<small>' + reportEscape(item.route) + '</small></td>' +
        '<td>A classificar</td></tr>'
      ).join('');
      doc.getElementById('spx-report-content').innerHTML = `
        <div class="report-head"><div><div class="eyebrow">DESEMPENHO DA OPERAÇÃO</div><h1>Relatório AutoAdd da VT</h1><p class="muted">${reportEscape(overviewKey)} · ${new Date().toLocaleString('pt-BR')} · ${overviewValidatedOnly ? 'Apenas rotas validadas' : 'Todas as rotas'}</p></div>
        <div class="report-actions"><button type="button" data-csv>Exportar CSV</button><button type="button" data-print>Imprimir / PDF</button></div></div>
        <p class="notice">${isPartial ? 'Relatório parcial: '+done+' de '+total+' ATs verificadas'+(failed?' · '+failed+' falhas de consulta':'')+'. Os percentuais usam somente ATs com dados confirmados.' : 'Relatório consolidado: '+done+' ATs verificadas.'} </p>
        <div class="metrics"><div class="metric"><span>Pedidos AutoAdd</span><strong>${data.planned}</strong></div><div class="metric"><span>Carregados</span><strong class="green">${data.scanned}</strong></div><div class="metric"><span>Pendentes</span><strong class="red">${data.pending}</strong></div><div class="metric"><span>Taxa de carregamento</span><strong style="color:${color}">${data.percent}%</strong></div><div class="metric"><span>Rotas com AutoAdd</span><strong>${classes}</strong></div></div>
        <div class="charts"><section class="panel"><h2>Qualidade por rota</h2><div class="donut-row"><div class="donut" style="background:${qualityPie}"><div>${classes}<small>rotas</small></div></div><div class="legend"><div><i style="background:#ef4444"></i> Críticas (&lt;60%) <b>${data.red}</b></div><div><i style="background:#f59e0b"></i> Atenção (60–89%) <b>${data.yellow}</b></div><div><i style="background:#22c55e"></i> Boas (≥90%) <b>${data.green}</b></div></div></div></section>
        <section class="panel"><h2>Carregamento dos pedidos</h2><div class="donut-row"><div class="donut" style="background:${loadedPie}"><div>${data.percent}%<small>carregado</small></div></div><div class="legend"><div><i style="background:#22c55e"></i> Carregados <b>${data.scanned}</b></div><div><i style="background:#ef4444"></i> Pendentes <b>${data.pending}</b></div></div></div></section></div>
        <div class="sections"><section class="panel"><h2>Rotas ofensoras</h2><p class="muted">Classificadas pela maior quantidade de pedidos AutoAdd pendentes.</p>${offenders.length ? offenders.map((item,i)=>`<div class="offender"><span class="rank">${i+1}</span><div><strong>${reportEscape(item.route)}</strong><small>${reportEscape(item.at)} · ${item.pct}% concluído</small></div><b>${item.pending} pendentes</b></div>`).join('') : '<p class="muted">Nenhuma pendência identificada nas ATs consultadas.</p>'}</section>
        <section class="panel"><h2>Pedidos AutoAdd faltantes</h2><p class="muted">Pedidos não validados nesta AT, aguardando análise do motivo.</p><div class="missing-table-wrap"><table class="missing-table"><thead><tr><th>Pedido</th><th>AT / Rota</th><th>Motivo</th></tr></thead><tbody>${missingDetails || '<tr><td colspan="3">Nenhuma pendência encontrada.</td></tr>'}</tbody></table></div></section></div>
        <section class="panel"><div class="section-header"><h2>${overviewValidatedOnly ? 'Detalhamento das ATs validadas' : 'Detalhamento de todas as ATs'}</h2><span>${classes} rotas com AutoAdd · ${data.rows.length} ATs consultadas</span></div><div class="route-grid">${routeCards || '<p class="muted">Nenhum pedido AutoAdd identificado nos dados consultados.</p>'}</div></section>
        <footer>Fonte: consultas da VT feitas pelo Assistente de AutoAdd. Classificação visual: vermelho &lt;60%, amarelo 60–89%, verde ≥90%. Meta operacional: 100% dos AutoAdd carregados. Status parcial não deve ser interpretado como resultado final.</footer>`;
      doc.querySelector('[data-csv]').onclick=()=> {
        const header=['VT','AT','Rota','AutoAdd','Carregados','Pendentes','Percentual'];
        const lines=[header,...data.active.map(item=>[overviewKey,item.at,item.route,item.planned,item.scanned,item.pending,item.pct+'%'])];
        const csv='\\uFEFF'+lines.map(line=>line.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(';')).join('\\r\\n');
        const url=URL.createObjectURL(new Blob([csv.replace('\\uFEFF','\uFEFF').replaceAll('\\r\\n','\r\n')],{type:'text/csv;charset=utf-8'}));
        const link=doc.createElement('a');link.href=url;link.download='autoadd-'+overviewKey+'.csv';link.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
      doc.querySelector('[data-print]').onclick=()=>tab.print();
    } catch (error) { console.warn('[SPX AutoAdd] Relatório indisponível:',error); }
  }

  function openOverviewReport() {
    if (!overviewKey) return;
    let tab=overviewReportWindow;
    if (!tab || tab.closed) {
      tab=window.open('','_blank');
      if (!tab) { alert('Permita pop-ups para abrir o relatório da VT.'); return; }
      overviewReportWindow=tab;
      tab.document.open();
      tab.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AutoAdd · Relatório da VT</title><style>
        *{box-sizing:border-box}body{margin:0;background:#0b1220;color:#f8fafc;font:13px/1.5 system-ui,Arial,sans-serif}main{max-width:1300px;margin:auto;padding:30px 24px}
        h1{font-size:27px;letter-spacing:-.5px;margin:4px 0}h2{font-size:17px;margin:0 0 12px}p{margin:7px 0}.muted{color:#93a6c1}.eyebrow{font-size:11px;color:#93c5fd;letter-spacing:.12em;font-weight:850}
        .report-head,.report-actions,.donut-row,.section-header{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap}.report-head{margin-bottom:22px}.report-actions{justify-content:flex-end}
        button{border:1px solid #42536f;background:#233955;color:#e8f1ff;padding:10px 14px;border-radius:9px;font-weight:750;cursor:pointer}
        .notice{padding:12px 14px;background:#142944;border:1px solid #2e557f;color:#c7d9f5;border-radius:9px;margin-bottom:18px}
        .metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}.metric,.panel{background:#152136;border:1px solid #31415b;border-radius:14px;padding:19px}.metric span{font-size:11px;color:#99aecb;display:block}.metric strong{display:block;margin-top:7px;font-size:26px}.green{color:#22c55e}.red{color:#ef4444}
        .charts,.sections{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}.donut-row{justify-content:flex-start;gap:30px;min-height:200px}.donut{width:177px;height:177px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto}.donut>div{background:#152136;width:121px;height:121px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column;font-size:24px;font-weight:900}.donut small{font-size:11px;font-weight:400;color:#9fb0c9}
        .legend{flex:1;min-width:170px}.legend div{display:flex;align-items:center;gap:9px;margin:12px 0;color:#b9c9df}.legend i{width:10px;height:10px;border-radius:3px;flex:0 0 auto}.legend b{margin-left:auto;color:#fff}
        .offender{display:flex;align-items:center;gap:12px;border-top:1px solid #31415b;padding:12px 0}.offender>div{flex:1}.offender small{display:block;color:#93a6c1}.offender b{color:#fda4af}.rank{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:#3f2636;color:#fda4af;font-weight:850}
        .missing-table-wrap{overflow-x:auto;max-height:330px;overflow-y:auto}.missing-table{width:100%;border-collapse:collapse;font-size:11px;text-align:left}.missing-table th,.missing-table td{padding:9px 8px;border-bottom:1px solid #30415b;vertical-align:top}.missing-table th{position:sticky;top:0;background:#152136;color:#93a6c1}.missing-table small{display:block;margin-top:3px;color:#93a6c1}
        .opportunity{padding:12px;border-left:3px solid #f59e0b;background:#1d2b40;border-radius:6px;margin:11px 0}.opportunity p{color:#9fb0c9;font-size:12px}.route-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.route{background:#192a42;border:1px solid #304664;border-radius:11px;padding:13px}.route-title{display:grid;grid-template-columns:1fr auto;gap:0 8px}.route-title strong{font-size:15px}.route-title small{grid-column:1;color:#93a6c1}.route-title b{grid-column:2;grid-row:1/3;font-size:17px}.bar{height:8px;border-radius:99px;overflow:hidden;background:#34455f;margin:10px 0}.bar i{display:block;height:100%;border-radius:99px}.route-meta{display:flex;justify-content:space-between;font-size:11px;color:#a6b8d0}.route-meta strong{color:#f8fafc}.section-header span{color:#94a3b8;font-size:11px}
        footer{color:#91a5c0;font-size:11px;margin-top:20px;padding-bottom:25px} @media(max-width:980px){.metrics{grid-template-columns:repeat(3,1fr)}.route-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:680px){main{padding:16px}.metrics{grid-template-columns:repeat(2,1fr)}.charts,.sections,.route-grid{grid-template-columns:1fr}.donut{width:145px;height:145px}.donut>div{width:100px;height:100px}}
        body{font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#0b1220}main{max-width:1260px}
        .panel,.metric{border-radius:14px;background:#152238;border-color:#334155}button{background:#23344d;border:1px solid #3b4a60;border-radius:9px}button:hover{background:#30445d}
        button:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
        .route{border-radius:11px;background:#1b2b43}.eyebrow{color:#93c5fd}
                @media print{body{background:white;color:#172033}.panel,.metric,.route{background:white;color:#172033;border-color:#d0d7e0}button{display:none}.notice{color:#172033;background:white}.muted,footer{color:#475569}}
      </style></head><body><main id="spx-report-content"></main></body></html>`);
      tab.document.close();
    }
    renderOverviewReport();
    tab.focus();
  }

  async function fetchOverviewTargets(vt, signal) {
    const items = new Map();
    for (let page = 1; page <= 100; page++) {
      const url = '/api/in-station/lmhub/audit/target/list?' + new URLSearchParams({ task_id: vt, page_no: String(page), count: '100' });
      const data = (await fetchJson(url, {}, signal))?.data || {};
      const list = Array.isArray(data.list) ? data.list : [];
      for (const item of list) {
        const at = String(item?.target_id || '').toUpperCase();
        if (/^AT[A-Z0-9]+$/.test(at)) items.set(at, { at, route: String(item.binding_entity || '-'), validated: Number(item.validation_status) === 4 });
      }
      if (list.length === 0 || (Number(data.total || data.all_qty || 0) > 0 && items.size >= Number(data.total || data.all_qty || 0))) break;
    }
    return [...items.values()];
  }

  async function overviewAtStats(vt, at, signal) {
    const planned = await fetchPlannedAutoAdd({ assignmentTaskId: at, validationTaskId: vt }, signal);
    if (!planned.length) return { planned: 0, scanned: 0, missingIds: [] };

    const params = new URLSearchParams({ validation_task_id: vt, target_id: at, audit_target_type: '2', page_no: '1', count: '999', parcel_scan_status: '2', shipment_id: '' });
    const scanned = new Set();
    for (let page = 1; page <= 100; page++) {
      params.set('page_no', String(page));
      const data = await fetchJson(SCANNED_URL + '?' + params, {}, signal);
      const list = Array.isArray(data?.data?.list) ? data.data.list : [];
      for (const item of list) scanned.add(String(item.shipment_id || '').toUpperCase());
      if (!list.length || (Number(data?.data?.total || 0) > 0 && scanned.size >= Number(data.data.total)) || list.length < 24) break;
    }

    const missingIds = planned.map(item => item.shipmentId).filter(id => !scanned.has(id));
    return {
      planned: planned.length,
      scanned: planned.length - missingIds.length,
      missingIds
    };
  }


  async function refreshOverview(vt, force = false) {
    if (!vt || overviewKey !== vt) return;
    if (overviewController) {
      if (!force) return;
      overviewController.abort();
    }
    const controller = new AbortController();
    overviewController = controller;
    overviewMessage('<span>Consultando ATs e pedidos AutoAdd da VT...</span>');
    try {
      const allAts = await fetchOverviewTargets(vt, controller.signal);
      if (controller.signal.aborted || overviewKey !== vt) return;
      const ats = overviewValidatedOnly ? allAts.filter(item => item.validated) : allAts;
      const rows = ats.map(item => ({ ...item, planned: null, scanned: null }));
      overviewReportRows = rows;
      overviewReportProgress = { done: 0, total: ats.length, failed: 0 };
      renderOverviewReport();
      let index = 0;
      let done = 0;
      let failed = 0;
      function render() {
        if (controller.signal.aborted || overviewKey !== vt) return;
        const known = rows.filter(x => x.planned !== null);
        const total = known.reduce((n,x) => n + x.planned, 0);
        const loaded = known.reduce((n,x) => n + x.scanned, 0);
        const pct = total ? Math.round(loaded / total * 100) : 0;
        const host = overviewHost();
        host.querySelector('[data-status]').textContent = done + '/' + ats.length + ' ATs ' + (overviewValidatedOnly ? 'validadas consultadas' : 'consultadas') + (failed ? ' · ' + failed + ' falhas' : '');
        host.querySelector('[data-brief]').textContent = total + ' AutoAdd · ' + loaded + ' carregados · ' + (total - loaded) + ' pendentes';
        host.querySelector('[data-percent]').textContent = pct + '%' + (done < ats.length ? ' *' : '');
        const bar = host.querySelector('[data-progress]');
        bar.style.width = pct + '%';
        bar.style.background = overviewColor(pct);
        const items = rows.filter(x => x.planned > 0).sort((x,y) => x.scanned / x.planned - y.scanned / y.planned);
        const cards = items.map(item => {
          const progress = Math.round(item.scanned / item.planned * 100);
          const color = overviewColor(progress);
          return '<article class="ov-route"><div class="ov-route-head"><div><div class="ov-route-name">' + item.route.replace(/[&<>"']/g, '') + '</div><div class="ov-route-id">' + item.at + '</div></div><strong class="ov-route-percent" style="color:' + color + '">' + progress + '%</strong></div>' +
            '<div class="ov-route-meta"><span>' + item.scanned + ' / ' + item.planned + ' carregados</span><span>' + (item.planned-item.scanned) + ' pendentes</span></div><div class="ov-bar"><i style="width:' + progress + '%;background:' + color + '"></i></div></article>';
        }).join('');
        overviewMessage('<div class="ov-metrics"><div class="ov-metric"><span>AutoAdd</span><strong>' + total + '</strong></div><div class="ov-metric"><span>Carregados</span><strong style="color:#22c55e">' + loaded + '</strong></div><div class="ov-metric"><span>Pendentes</span><strong style="color:#f59e0b">' + (total-loaded) + '</strong></div></div>' +
          '<p style="color:#94a3b8;font-size:10px">Vermelho: &lt;60% · Amarelo: 60–89% · Verde: ≥90%. ' + (done < ats.length ? 'Resumo parcial.' : failed ? 'Algumas ATs não puderam ser consultadas.' : '') + '</p>' +
          (cards || '<p style="color:#94a3b8">' + (overviewValidatedOnly && !ats.length ? 'Nenhuma rota validada nesta VT.' : 'Nenhuma AT com AutoAdd identificada até o momento.') + '</p>'));
      }
      render();
      async function worker() {
        while (index < rows.length && !controller.signal.aborted) {
          const item = rows[index++];
          try {
            const stats = await overviewAtStats(vt, item.at, controller.signal);
            item.planned = stats.planned;
            item.scanned = stats.scanned;
            item.missingIds = stats.missingIds;
          } catch (error) {
            if (controller.signal.aborted) break;
            failed++;
          }
          done++;
          overviewReportProgress = { done, total: rows.length, failed };
        if (done % 5 === 0 || done === rows.length) { render(); renderOverviewReport(); }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, rows.length) }, worker));
      render();
    } catch (error) {
      if (!controller.signal.aborted) overviewMessage('<span style="color:#fca5a5">' + String(error.message || error).replace(/[&<>"]/g, '') + '</span>');
    } finally {
      if (overviewController === controller) {
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
    overviewReportProgress = { done: 0, total: 0, failed: 0 };
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
