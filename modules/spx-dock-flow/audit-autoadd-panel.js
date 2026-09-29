(function initializeDockFlowAutoAddPanel() {
  const MARKER = 'spxDockFlowAutoAddPanelV1';
  const PANEL_ID = 'spx-dockflow-autoadd-panel';
  const TARGET_HASH_PREFIX = '#/mercadao/audit-list/at-to-detail';
  const STATION_URL = '/api/admin/basicserver/current_user/station_list/?count=50&status_list=0';
  const PLANNED_URL = '/spx_delivery/admin/assignment/assignment_task/detail/planned_order/search';
  const SCANNED_URL = '/api/in-station/lmhub/audit/parcel/list';
  const SCANNED_PAGE_SIZE = 24;
  const SCANNED_REFRESH_MS = 3500;
  const PLANNED_REFRESH_MS = 20000;
  const LOCATION_WATCH_MS = 800;
  const REQUEST_TIMEOUT_MS = 15000;
  const COLLAPSED_KEY = 'spxDockFlowAutoAddCollapsed';

  if (document.documentElement.dataset[MARKER] === 'active') return;
  document.documentElement.dataset[MARKER] = 'active';

  let routeKey = '';
  let routeContext = null;
  let refreshTimer = null;
  let locationTimer = null;
  let requestController = null;
  let stationCache = { id: 0, expiresAt: 0 };
  let lastPlannedAt = 0;
  let plannedAutoAdd = [];
  let scannedIds = new Set();
  let busy = false;
  let destroyed = false;

  function readCookie(name) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const item = part.trim();
      if (item.startsWith(prefix)) return decodeURIComponent(item.slice(prefix.length));
    }
    return '';
  }

  function requestHeaders(hasBody) {
    const headers = { accept: 'application/json, text/plain, */*', app: 'FMS Portal' };
    const csrf = readCookie('csrftoken');
    const deviceId = readCookie('spx-admin-device-id');
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
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          ...requestHeaders(Boolean(options.body)),
          ...(options.headers || {})
        },
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error('Sessão SPX sem permissão para consultar os pedidos.');
      }
      if (!response.ok) throw new Error(`SPX retornou HTTP ${response.status}.`);

      const data = await response.json();
      if (typeof data?.retcode === 'number' && data.retcode !== 0) {
        throw new Error(data.message || `SPX retornou retcode ${data.retcode}.`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }

  function currentRouteContext() {
    if (location.origin !== 'https://spx.shopee.com.br') return null;
    if (!location.hash.startsWith(TARGET_HASH_PREFIX)) return null;

    const question = location.hash.indexOf('?');
    const query = question >= 0 ? location.hash.slice(question + 1) : '';
    const params = new URLSearchParams(query);
    const values = [...params.values()].map(value => String(value || '').trim());
    const ordered = [
      params.get('target_id'),
      params.get('task_id'),
      params.get('assignment_task_id'),
      params.get('validation_task_id'),
      ...values
    ].filter(Boolean);

    const assignmentTaskId = ordered.find(value => /^AT[A-Z0-9]+$/i.test(value)) || '';
    const validationTaskId = ordered.find(value => /^VT[A-Z0-9]+$/i.test(value)) || '';
    if (!assignmentTaskId || !validationTaskId) return null;

    return {
      assignmentTaskId: assignmentTaskId.toUpperCase(),
      validationTaskId: validationTaskId.toUpperCase(),
      key: `${validationTaskId.toUpperCase()}|${assignmentTaskId.toUpperCase()}`
    };
  }

  async function getStationId(signal) {
    if (stationCache.id > 0 && stationCache.expiresAt > Date.now()) return stationCache.id;
    const response = await fetchJson(STATION_URL, { method: 'GET' }, signal);
    const stationId = Number(response?.data?.current_station_id || 0);
    if (!Number.isSafeInteger(stationId) || stationId <= 0) {
      throw new Error('Não foi possível identificar a estação atual do SPX.');
    }
    stationCache = { id: stationId, expiresAt: Date.now() + 10 * 60 * 1000 };
    return stationId;
  }

  async function fetchPlannedAutoAdd(context, signal) {
    const stationId = await getStationId(signal);
    const response = await fetchJson(PLANNED_URL, {
      method: 'POST',
      body: JSON.stringify({
        assignment_task_id: context.assignmentTaskId,
        station_id: stationId
      })
    }, signal);

    const list = Array.isArray(response?.data?.list) ? response.data.list : [];
    const unique = new Map();

    for (const item of list) {
      if (Number(item?.order_at_linkage) !== 2) continue;
      const shipmentId = String(item?.shipment_id || '').trim().toUpperCase();
      if (!shipmentId) continue;
      unique.set(shipmentId, {
        shipmentId,
        sequence: Number(item?.sequence || 0),
        assignmentStatus: Number(item?.assignment_status || 0),
        operateTime: Number(item?.operate_time || 0)
      });
    }

    return [...unique.values()];
  }

  async function fetchScannedIds(context, signal) {
    const ids = new Set();
    let pageNo = 1;
    let total = Infinity;

    while (ids.size < total && pageNo <= 100) {
      const params = new URLSearchParams({
        validation_task_id: context.validationTaskId,
        target_id: context.assignmentTaskId,
        audit_target_type: '2',
        page_no: String(pageNo),
        count: String(SCANNED_PAGE_SIZE),
        parcel_scan_status: '2',
        shipment_id: ''
      });
      const response = await fetchJson(`${SCANNED_URL}?${params.toString()}`, { method: 'GET' }, signal);
      const data = response?.data || {};
      const list = Array.isArray(data.list) ? data.list : [];
      const responseTotal = Number(data.total);
      total = Number.isFinite(responseTotal) && responseTotal >= 0 ? responseTotal : ids.size + list.length;

      for (const item of list) {
        const shipmentId = String(item?.shipment_id || '').trim().toUpperCase();
        if (shipmentId) ids.add(shipmentId);
      }

      if (!list.length || list.length < SCANNED_PAGE_SIZE || ids.size >= total) break;
      pageNo += 1;
    }

    return ids;
  }

  function isCollapsed() {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  }

  function setCollapsed(value) {
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
        .panel{width:min(360px,calc(100vw - 36px));overflow:hidden;border:1px solid #dbe2ea;border-radius:14px;background:#fff;box-shadow:0 16px 44px rgba(15,23,42,.24);transition:width .18s ease,box-shadow .18s ease}
        .panel.collapsed{width:auto;min-width:190px}
        .header{width:100%;display:flex;align-items:center;gap:10px;padding:11px 12px;border:0;background:#fff;color:#0f172a;text-align:left;cursor:pointer}
        .header:hover{background:#f8fafc}
        .icon{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border-radius:9px;background:#ff6000;color:#fff;font-size:15px;font-weight:900}
        .title{min-width:0;flex:1}
        .title strong{display:block;font-size:13px;line-height:1.15}
        .title small{display:block;margin-top:2px;color:#64748b;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .badge{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 7px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:11px;font-weight:900}
        .badge.done{background:#ecfdf5;color:#15803d}
        .chevron{flex:0 0 auto;width:18px;height:18px;color:#64748b;transition:transform .18s ease}
        .panel.collapsed .chevron{transform:rotate(180deg)}
        .panel.collapsed .body{display:none}
        .body{border-top:1px solid #eef2f7}
        .summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:#f8fafc}
        .summary span{font-size:11px;color:#64748b}.summary strong{font-size:12px;color:#0f172a;white-space:nowrap}
        .progress{height:4px;background:#e2e8f0}.progress>i{display:block;height:100%;background:#22c55e;transition:width .2s ease}
        .list{max-height:min(330px,42vh);overflow:auto;padding:7px}
        .row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 7px;border-radius:9px}
        .row+ .row{margin-top:2px}.row.pending{background:#fff7ed}.row.done{background:#f8fafc}
        .status{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;font-size:13px;font-weight:900}
        .pending .status{background:#ffedd5;color:#c2410c}.done .status{background:#dcfce7;color:#15803d}
        .shipment{min-width:0;font:700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .state{font-size:10px;font-weight:800}.pending .state{color:#c2410c}.done .state{color:#15803d}
        .message{padding:18px 14px;color:#64748b;font-size:11px;line-height:1.45;text-align:center}
        .message.error{color:#b91c1c;background:#fef2f2}
        .footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-top:1px solid #eef2f7;color:#94a3b8;font-size:9px}
        .retry{border:0;background:transparent;color:#ea580c;font:800 10px Arial,sans-serif;cursor:pointer;padding:2px 0}
        @media(max-width:620px){:host{right:10px;bottom:10px}.panel{width:min(340px,calc(100vw - 20px))}}
      </style>
      <section class="panel" aria-label="Dockflow - Pedidos AutoAdd">
        <button class="header" type="button" aria-expanded="true">
          <span class="icon">DF</span>
          <span class="title"><strong>Dockflow · Pedidos AutoAdd</strong><small>Carregamento da AT</small></span>
          <span class="badge">...</span>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="body">
          <div class="summary"><span>Consultando...</span><strong>—</strong></div>
          <div class="progress"><i style="width:0%"></i></div>
          <div class="content"><div class="message">Buscando pedidos AutoAdd...</div></div>
          <div class="footer"><span class="updated">Aguardando atualização</span><button class="retry" type="button">Atualizar agora</button></div>
        </div>
      </section>
    `;

    const panel = shadow.querySelector('.panel');
    const header = shadow.querySelector('.header');
    const retry = shadow.querySelector('.retry');
    panel.classList.toggle('collapsed', isCollapsed());
    header.setAttribute('aria-expanded', String(!panel.classList.contains('collapsed')));
    header.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      header.setAttribute('aria-expanded', String(!collapsed));
      setCollapsed(collapsed);
    });
    retry.addEventListener('click', () => scheduleRefresh(0, true));

    document.documentElement.appendChild(host);
    return host;
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function panelNodes() {
    const host = ensurePanel();
    const root = host.shadowRoot;
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

  function renderLoading(context, text = 'Atualizando pedidos...') {
    const nodes = panelNodes();
    nodes.titleSmall.textContent = context.assignmentTaskId;
    nodes.summaryLabel.textContent = text;
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

    nodes.titleSmall.textContent = `${context.assignmentTaskId} · ${pending ? `${pending} pendente${pending === 1 ? '' : 's'}` : 'completo'}`;
    nodes.badge.textContent = pending ? String(pending) : '✓';
    nodes.badge.classList.toggle('done', pending === 0);
    nodes.summaryLabel.textContent = total ? `${loaded} de ${total} AutoAdd carregado${loaded === 1 ? '' : 's'}` : 'Nenhum AutoAdd planejado';
    nodes.summaryValue.textContent = total ? `${percent}%` : 'OK';
    nodes.progress.style.width = `${percent}%`;

    if (!total) {
      nodes.content.innerHTML = '<div class="message">Não há pedidos com <strong>order_at_linkage = 2</strong> nesta AT.</div>';
    } else {
      const list = document.createElement('div');
      list.className = 'list';
      for (const item of rows) {
        const row = document.createElement('div');
        row.className = `row ${item.scanned ? 'done' : 'pending'}`;
        const status = document.createElement('span');
        status.className = 'status';
        status.textContent = item.scanned ? '✓' : '!';
        const shipment = document.createElement('span');
        shipment.className = 'shipment';
        shipment.textContent = item.shipmentId;
        shipment.title = item.shipmentId;
        const state = document.createElement('span');
        state.className = 'state';
        state.textContent = item.scanned ? 'Carregado' : 'Pendente';
        row.append(status, shipment, state);
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
    nodes.summaryLabel.textContent = 'Falha na consulta';
    nodes.summaryValue.textContent = 'Erro';
    nodes.progress.style.width = '0%';
    const message = document.createElement('div');
    message.className = 'message error';
    message.textContent = error?.message || 'Não foi possível consultar os pedidos AutoAdd.';
    nodes.content.replaceChildren(message);
    nodes.updated.textContent = 'Use “Atualizar agora” para tentar novamente';
  }

  function scheduleRefresh(delay = SCANNED_REFRESH_MS, forcePlanned = false) {
    clearTimeout(refreshTimer);
    if (!routeContext || destroyed) return;
    refreshTimer = setTimeout(() => refresh(routeContext, forcePlanned), Math.max(0, delay));
  }

  async function refresh(context, forcePlanned = false) {
    if (busy || !routeContext || context.key !== routeContext.key || destroyed) return;
    busy = true;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;

    try {
      const needsPlanned = forcePlanned || !plannedAutoAdd.length || Date.now() - lastPlannedAt >= PLANNED_REFRESH_MS;
      renderLoading(context, needsPlanned ? 'Atualizando planejamento e leitura...' : 'Atualizando leitura...');

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
    clearTimeout(refreshTimer);
    ensurePanel();
    renderLoading(context, 'Buscando planejamento AutoAdd...');
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
    clearTimeout(refreshTimer);
    refreshTimer = null;
    busy = false;
    removePanel();
  }

  function checkLocation() {
    if (destroyed) return;
    const context = currentRouteContext();
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
    locationTimer = setInterval(checkLocation, LOCATION_WATCH_MS);
  }

  function stop() {
    destroyed = true;
    window.removeEventListener('hashchange', checkLocation);
    window.removeEventListener('popstate', checkLocation);
    clearInterval(locationTimer);
    deactivate();
    delete document.documentElement.dataset[MARKER];
  }

  window.addEventListener('pagehide', stop, { once: true });
  start();
})();
