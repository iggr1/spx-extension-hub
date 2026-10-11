(function initializeAutoAddAssistant() {
  const MARKER = 'spxAutoAddAssistantV1';
  const PANEL_ID = 'spx-autoadd-assistant-panel';
  const TARGET_HASH_PREFIX = '#/mercadao/audit-list/at-to-detail';
  const STATION_URL = '/api/admin/basicserver/current_user/station_list/?count=50&status_list=0';
  const PLANNED_URL = '/spx_delivery/admin/assignment/assignment_task/detail/planned_order/search';
  const SCANNED_URL = '/api/in-station/lmhub/audit/parcel/list';
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
  const OVERVIEW_REFRESH_MS = 120000;
  let overviewKey = '';
  let overviewTimer = 0;
  let overviewController = null;

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
      </style>
      <div class="ov-header" data-toggle role="button" tabindex="0" aria-expanded="false">
        <div class="ov-icon">AA</div><div class="ov-heading"><strong>AutoAdd · Visão geral da VT</strong><small data-status>Buscando pedidos...</small></div>
        <button class="ov-action" type="button" data-overview-refresh title="Atualizar agora">↻</button>
        <button class="ov-action" type="button" data-expand aria-label="Expandir painel">⌄</button>
      </div>
      <div class="ov-summary"><div class="ov-summary-line"><span data-brief>Carregamento AutoAdd</span><strong data-percent>—</strong></div><div class="ov-bar"><i data-progress></i></div></div>
      <div class="ov-details"><div class="ov-body" data-overview-body>Carregando...</div><div class="ov-footer">Atualização automática a cada 2 minutos</div></div>`;
    host.dataset.collapsed = 'true';
    const toggle = () => {
      const collapsed = host.dataset.collapsed !== 'true';
      host.dataset.collapsed = String(collapsed);
      host.querySelector('[data-toggle]').setAttribute('aria-expanded', String(!collapsed));
      host.querySelector('[data-expand]').textContent = collapsed ? '⌄' : '⌃';
    };
    host.querySelector('[data-toggle]').addEventListener('click', e => { if (!e.target.closest('button')) toggle(); });
    host.querySelector('[data-toggle]').addEventListener('keydown', e => { if (e.target === e.currentTarget && ['Enter',' '].includes(e.key)) { e.preventDefault(); toggle(); } });
    host.querySelector('[data-expand]').onclick = toggle;
    host.querySelector('[data-overview-refresh]').onclick = () => void refreshOverview(overviewKey, true);
    document.documentElement.appendChild(host);
    return host;
  }

  function overviewMessage(html) {
    const body = overviewHost().querySelector('[data-overview-body]');
    if (body) body.innerHTML = html;
  }

  async function fetchOverviewTargets(vt, signal) {
    const items = new Map();
    for (let page = 1; page <= 100; page++) {
      const url = '/api/in-station/lmhub/audit/target/list?' + new URLSearchParams({ task_id: vt, page_no: String(page), count: '100' });
      const data = (await fetchJson(url, {}, signal))?.data || {};
      const list = Array.isArray(data.list) ? data.list : [];
      for (const item of list) {
        const at = String(item?.target_id || '').toUpperCase();
        if (/^AT[A-Z0-9]+$/.test(at)) items.set(at, { at, route: String(item.binding_entity || '-'), validated: item.validation_status === 4 });
      }
      if (list.length === 0 || (Number(data.total || data.all_qty || 0) > 0 && items.size >= Number(data.total || data.all_qty || 0))) break;
    }
    return [...items.values()];
  }

  async function overviewAtStats(vt, at, signal) {
    const planned = await fetchPlannedAutoAdd({ assignmentTaskId: at, validationTaskId: vt }, signal);
    if (!planned.length) return { planned: 0, scanned: 0 };
    const params = new URLSearchParams({ validation_task_id: vt, target_id: at, audit_target_type: '2', page_no: '1', count: '999', parcel_scan_status: '2', shipment_id: '' });
    const scanned = new Set();
    for (let page = 1; page <= 100; page++) {
      params.set('page_no', String(page));
      const data = await fetchJson(SCANNED_URL + '?' + params, {}, signal);
      const list = Array.isArray(data?.data?.list) ? data.data.list : [];
      for (const item of list) scanned.add(String(item.shipment_id || '').toUpperCase());
      if (!list.length || (Number(data?.data?.total || 0) > 0 && scanned.size >= Number(data.data.total)) || list.length < 24) break;
    }
    return { planned: planned.length, scanned: planned.filter(item => scanned.has(item.shipmentId)).length };
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
      const ats = await fetchOverviewTargets(vt, controller.signal);
      const rows = ats.map(item => ({ ...item, planned: null, scanned: null }));
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
        host.querySelector('[data-status]').textContent = done + '/' + ats.length + ' ATs consultadas' + (failed ? ' · ' + failed + ' falhas' : '');
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
          (cards || '<p style="color:#94a3b8">Nenhuma AT com AutoAdd identificada até o momento.</p>'));
      }
      render();
      async function worker() {
        while (index < rows.length && !controller.signal.aborted) {
          const item = rows[index++];
          try {
            const stats = await overviewAtStats(vt, item.at, controller.signal);
            item.planned = stats.planned;
            item.scanned = stats.scanned;
          } catch (error) {
            if (controller.signal.aborted) break;
            failed++;
          }
          done++;
          if (done % 5 === 0 || done === rows.length) render();
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
