const DOCK_API_URL = 'https://spx.shopee.com.br/api/in-station/dock_management/dock/list';
const QUEUE_API_URL = 'https://spx.shopee.com.br/api/in-station/dock_management/dock/truck/list';
const ASSIGNMENT_API_URL = 'https://spx.shopee.com.br/spx_delivery/admin/assignment/assignment_task/search/v2';
const ASSIGNMENT_ORDERS_API_URL = 'https://spx.shopee.com.br/spx_delivery/admin/assignment/assignment_task/detail/order/search';
const ORDER_TRACKING_API_URL = 'https://spx.shopee.com.br/api/fleet_order/order/tracking_list/search';
const VALIDATION_TASK_API_URL = 'https://spx.shopee.com.br/api/in-station/lmhub/audit/task/list';
const VALIDATION_TARGET_API_URL = 'https://spx.shopee.com.br/api/in-station/lmhub/audit/target/list';
const VT_ASSIGNMENTS_CACHE_KEY = 'spxDockFlowVtAssignmentsV1';
const VT_ASSIGNMENTS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const VT_ASSIGNMENTS_PAGE_SIZE = 100;
const VT_ASSIGNMENTS_MAX_PAGES = 60;
const SPX_HOME = 'https://spx.shopee.com.br/';
const ASSIGNMENT_STATS_CACHE_KEY = 'spxAssignmentStatsCacheV2';
const ASSIGNMENT_STATS_CACHE_TTL_MS = 30 * 60 * 1000;
const ASSIGNMENT_STATS_CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;
const ASSIGNMENT_STATS_MAX_PAGES = 100;
const ORDER_TRACKING_PAGE_SIZE = 50;

const assignmentStatsInFlight = new Map();
let assignmentStatsCachePromise = null;
let vtAssignmentsCachePromise = null;
const vtAssignmentsInFlight = new Map();
const vtAssignmentsFailedUntil = new Map();

async function handleModuleMessage(message) {
  if (!message?.type) return { ok: false, error: 'Mensagem inválida.' };

  try {
    switch (message.type) {
      case 'FETCH_DOCKS':
        return await fetchDocks(message.payload || {});
      case 'FETCH_DOCKS_FALLBACK':
        return await fetchDocksDirect(message.payload || {});
      case 'FETCH_DOCK_QUEUES':
        return await fetchDockQueues(message.payload || {});
      case 'FETCH_DRIVER_ROUTES':
        return await fetchDriverRoutes(message.payload || {});
      case 'FETCH_ASSIGNMENT_STATS':
        return await getAssignmentStats(message.payload || {});
      case 'FETCH_VALIDATION_PROGRESS':
        return await fetchValidationProgress(message.payload || {});
      case 'GET_CONNECTION_STATUS':
        return await getConnectionStatus();
      case 'OPEN_SPX':
        return await LoaderBridge.request('tabs.open', { url: SPX_HOME });
      case 'CLEAR_CAPTURED_HEADERS':
        return await LoaderBridge.request('network.clearAuth', { profileId: 'spx' });
      default:
        return { ok: false, error: `Operação desconhecida: ${message.type}` };
    }
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function fetchDocks(payload) {
  const requestBody = {
    dock_active_status: Number(payload.dockActiveStatus ?? 1),
    pageno: Number(payload.pageno ?? 1),
    count: Number(payload.count ?? 100)
  };

  const batch = await fetchBatch([{
    key: 'docks',
    url: DOCK_API_URL,
    method: 'POST',
    body: requestBody
  }]);

  const result = batch.results.docks;

  if (result?.ok) {
    return {
      ok: true,
      source: result.source,
      httpStatus: result.httpStatus,
      data: result.data
    };
  }

  const status = await getConnectionStatus();

  return {
    ok: false,
    source: result?.source || batch.source || 'service-worker',
    error: result?.error || 'Não foi possível consultar as bancadas.',
    details: {
      hasSpxTab: status.hasSpxTab,
      hasCsrfToken: status.hasCsrfToken,
      hasDeviceId: status.hasDeviceId,
      hasSapHeaders: status.hasSapHeaders,
      capturedAt: status.capturedAt || null
    }
  };
}

async function fetchDocksDirect(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const status = await Promise.race([
      LoaderBridge.request('network.connectionStatus', { profileId: 'spx' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Sessão do loader indisponível.')), 4000))
    ]);
    if (!status?.ok) throw new Error('Não foi possível consultar a sessão do loader.');
    const headers = { 'content-type': 'application/json;charset=UTF-8', app: 'FMS Portal' };
    const captured = status.headers || {};
    for (const name of ['x-csrftoken', 'device-id', 'x-sap-ri', 'x-sap-sec']) {
      if (typeof captured[name] === 'string' && captured[name]) headers[name] = captured[name];
    }
    const response = await fetch(DOCK_API_URL, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        dock_active_status: Number(payload.dockActiveStatus ?? 1),
        pageno: Number(payload.pageno ?? 1),
        count: Number(payload.count ?? 100)
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (data?.retcode !== 0) throw new Error(data?.message || 'Resposta inválida da SPX.');
    return { ok: true, source: 'direct-session', httpStatus: response.status, data };
  } catch (error) {
    return { ok: false, source: 'direct-session', error: error?.name === 'AbortError'
      ? 'Tempo limite da consulta direta atingido.'
      : error instanceof TypeError
        ? 'Navegador bloqueou a consulta direta (CORS/rede).'
        : String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchValidationProgress(payload) {
  const pageNo = Math.max(1, Number(payload.pageNo ?? 1));
  const count = Math.max(1, Number(payload.count ?? 24));
  const taskStatus = Number(payload.taskStatus ?? 2);
  const url = `${VALIDATION_TASK_API_URL}?page_no=${encodeURIComponent(pageNo)}&count=${encodeURIComponent(count)}&task_status=${encodeURIComponent(taskStatus)}`;
  const batch = await fetchBatch([{
    key: 'validation-progress',
    url,
    method: 'GET'
  }]);
  const result = batch.results['validation-progress'];

  if (result?.ok) {
    return {
      ok: true,
      source: result.source,
      httpStatus: result.httpStatus,
      data: result.data
    };
  }

  return {
    ok: false,
    source: result?.source || batch.source || 'service-worker',
    error: result?.error || 'Não foi possível consultar o progresso de carregamento.'
  };
}

async function fetchDockQueues(payload) {
  const dockIds = uniquePositiveIntegers(payload.dockIds);

  if (!dockIds.length) {
    return { ok: true, source: 'none', queues: {} };
  }

  const requests = dockIds.map(dockId => ({
    key: String(dockId),
    url: `${QUEUE_API_URL}?dock_id=${encodeURIComponent(dockId)}`,
    method: 'GET'
  }));

  const batch = await fetchBatch(requests);
  const queues = {};

  for (const dockId of dockIds) {
    const result = batch.results[String(dockId)];
    queues[dockId] = result || {
      ok: false,
      error: 'Não foi possível consultar a fila desta doca.'
    };
  }

  const successful = Object.values(queues).filter(item => item?.ok).length;

  return {
    ok: successful > 0,
    partial: successful < dockIds.length,
    source: batch.source,
    queues
  };
}

async function fetchDriverRoutes(payload) {
  const driverIds = uniquePositiveIntegers(payload.driverIds);
  if (!driverIds.length) return { ok: true, source: 'none', routes: {} };

  const validationTaskId = normalizeValidationTaskId(payload.validationTaskId);
  const vt = validationTaskId ? await getVtAssignments(validationTaskId).catch(error => {
    console.warn('[Dock Flow] A lista de ATs da VT não está disponível; usando consulta por motorista:', error);
    return null;
  }) : null;
  const vtIds = new Set((vt?.assignments || []).map(item => item.id));
  const vtByRoute = new Map();
  for (const item of vt?.assignments || []) {
    const key = normalizeRouteBinding(item.route);
    if (!key) continue;
    const existing = vtByRoute.get(key) || [];
    existing.push(item);
    vtByRoute.set(key, existing);
  }

  const requests = driverIds.map(driverId => ({
    key: String(driverId),
    url: ASSIGNMENT_API_URL,
    method: 'POST',
    body: { driver_id: driverId, pageno: 1, count: 20, search_type: 0 }
  }));
  const batch = await fetchBatch(requests);
  const routes = {};

  for (const driverId of driverIds) {
    const result = batch.results[String(driverId)];
    if (!result?.ok) {
      routes[driverId] = { ok: false, route: '', error: result?.error || 'Não foi possível consultar a rota do motorista.' };
      continue;
    }

    const list = Array.isArray(result.data?.data?.list) ? result.data.data.list : [];
    const matches = vtIds.size ? list.filter(item => vtIds.has(extractAssignmentTaskId(item))) : [];
    const latest = selectLatestAssignment(matches.length ? matches : list);
    const rawTaskId = extractAssignmentTaskId(latest);
    const route = String(latest?.corridor_cage || latest?.route || '').trim();
    const candidates = vtByRoute.get(normalizeRouteBinding(route)) || [];
    const uniqueMatch = candidates.length === 1 ? candidates[0] : null;
    const assignmentTaskId = matches.length ? rawTaskId
      : uniqueMatch?.id || rawTaskId;

    routes[driverId] = {
      ok: true,
      route: route || (matches.length ? (vt?.assignments || []).find(item => item.id === assignmentTaskId)?.route : '') || '',
      assignmentTaskId,
      driverAssignedTime: numberOrZero(latest?.driver_assigned_time),
      driverName: latest?.driver_name || '',
      details: latest ? Object.fromEntries([
        'order_count', 'assigned_order_count', 'city', 'neighborhood', 'cluster',
        'vehicle_name', 'vehicle_type', 'planned_vehicle_type', 'agency',
        'station_name', 'stops_number', 'total_distance', 'ctime', 'driver_assigned_time'
      ].map(key => [key, latest[key]])) : null,
      assignmentSource: matches.length ? 'vt' : uniqueMatch ? 'vt-route' : 'driver',
      found: Boolean(latest),
      error: null
    };
  }

  const successful = Object.values(routes).filter(item => item?.ok).length;
  return {
    ok: successful > 0,
    partial: successful < driverIds.length,
    source: batch.source,
    validationTaskId: vt?.validationTaskId || '',
    vtAssignmentsCount: vt?.assignments?.length || 0,
    vtCacheHit: Boolean(vt?.cached),
    routes
  };
}

function normalizeValidationTaskId(value) {
  const id = String(value || '').trim();
  return /^VT[A-Z0-9]+$/i.test(id) && id.length <= 128 ? id : '';
}

function normalizeRouteBinding(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLocaleUpperCase('pt-BR');
}

async function getVtAssignments(validationTaskId) {
  const cache = await loadVtAssignmentsCache();
  const saved = cache[validationTaskId];
  if (saved?.complete === true && Array.isArray(saved.assignments)
      && saved.assignments.length > 0 && numberOrZero(saved.fetchedAt) >= Date.now() - VT_ASSIGNMENTS_MAX_AGE_MS) {
    return { ...saved, cached: true };
  }

  if (vtAssignmentsInFlight.has(validationTaskId)) return vtAssignmentsInFlight.get(validationTaskId);
  if (Date.now() < numberOrZero(vtAssignmentsFailedUntil.get(validationTaskId))) return null;

  const pending = fetchVtAssignments(validationTaskId)
    .then(async assignments => {
      if (!assignments.length) throw new Error('A VT ainda não retornou ATs; não foi armazenada no cache.');
      const record = { validationTaskId, assignments, complete: true, fetchedAt: Date.now() };
      cache[validationTaskId] = record;
      await persistVtAssignmentsCache(cache);
      vtAssignmentsFailedUntil.delete(validationTaskId);
      return { ...record, cached: false };
    })
    .catch(error => {
      vtAssignmentsFailedUntil.set(validationTaskId, Date.now() + 60000);
      throw error;
    })
    .finally(() => vtAssignmentsInFlight.delete(validationTaskId));
  vtAssignmentsInFlight.set(validationTaskId, pending);
  return pending;
}

async function fetchVtAssignments(validationTaskId) {
  const assignments = new Map();
  const pagesSeen = new Set();
  let expectedTotal = 0;
  let rowsReceived = 0;
  let completed = false;

  for (let page = 1; page <= VT_ASSIGNMENTS_MAX_PAGES; page++) {
    const url = `${VALIDATION_TARGET_API_URL}?task_id=${encodeURIComponent(validationTaskId)}&page_no=${page}&count=${VT_ASSIGNMENTS_PAGE_SIZE}`;
    const response = await fetchSingleRequest({ key: 'vt-targets', url, method: 'GET' });
    const data = response.data;
    if (data?.retcode !== 0) throw new Error(data?.message || 'Não foi possível consultar ATs da VT.');

    const body = data?.data || {};
    const rows = Array.isArray(body.list) ? body.list
      : Array.isArray(body.target_list) ? body.target_list
      : Array.isArray(body.items) ? body.items
      : Array.isArray(body.rows) ? body.rows : null;
    if (!rows) throw new Error('Estrutura da lista de ATs da VT não reconhecida.');

    const total = numberOrZero(body.total ?? body.total_count ?? body.total_cnt);
    expectedTotal = Math.max(expectedTotal, total);
    const signature = rows.map(item => String(item?.target_id ?? item?.assignment_task_id ?? '')).join('|');
    if (signature && pagesSeen.has(signature)) throw new Error('A paginação da VT retornou uma página repetida.');
    if (signature) pagesSeen.add(signature);
    rowsReceived += rows.length;

    for (const item of rows) {
      const id = normalizeAssignmentTaskId(item?.target_id || item?.assignment_task_id);
      if (!/^AT[A-Z0-9]+$/i.test(id)) continue;
      assignments.set(id, {
        id,
        route: String(item?.binding_entity || item?.corridor_cage || item?.route || '').trim()
      });
    }

    if (expectedTotal > 0 && rowsReceived >= expectedTotal) {
      completed = true;
      break;
    }
    if (rows.length < VT_ASSIGNMENTS_PAGE_SIZE) {
      completed = true;
      break;
    }
  }

  if (!completed || (expectedTotal > 0 && rowsReceived < expectedTotal)) {
    throw new Error('Lista de ATs da VT incompleta; cache não será gravado.');
  }
  return [...assignments.values()];
}

async function loadVtAssignmentsCache() {
  if (!vtAssignmentsCachePromise) {
    vtAssignmentsCachePromise = LoaderBridge.request('storage.get', { keys: [VT_ASSIGNMENTS_CACHE_KEY] })
      .then(response => {
        if (!response?.ok) throw new Error(response?.error || 'Não foi possível ler o cache da VT.');
        const data = response.values?.[VT_ASSIGNMENTS_CACHE_KEY];
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      })
      .catch(error => {
        vtAssignmentsCachePromise = null;
        console.warn('[Dock Flow] Cache da VT indisponível:', error);
        return {};
      });
  }
  return vtAssignmentsCachePromise;
}

async function persistVtAssignmentsCache(cache) {
  const cutoff = Date.now() - VT_ASSIGNMENTS_MAX_AGE_MS;
  for (const [id, record] of Object.entries(cache)) {
    if (numberOrZero(record?.fetchedAt) < cutoff) delete cache[id];
  }
  const response = await LoaderBridge.request('storage.set', { items: { [VT_ASSIGNMENTS_CACHE_KEY]: cache } });
  if (!response?.ok) throw new Error(response?.error || 'Não foi possível salvar o cache das ATs da VT.');
}

async function getAssignmentStats(payload) {
  const assignmentTaskId = normalizeAssignmentTaskId(payload.assignmentTaskId);

  if (!assignmentTaskId) {
    return { ok: false, error: 'Código da AT inválido.' };
  }

  const cached = await readCachedAssignmentStats(assignmentTaskId);

  if (cached) {
    return {
      ok: true,
      cached: true,
      stats: cached
    };
  }

  let pending = assignmentStatsInFlight.get(assignmentTaskId);

  if (!pending) {
    pending = fetchAndCacheAssignmentStats(assignmentTaskId)
      .finally(() => assignmentStatsInFlight.delete(assignmentTaskId));
    assignmentStatsInFlight.set(assignmentTaskId, pending);
  }

  const stats = await pending;

  return {
    ok: true,
    cached: false,
    stats
  };
}

async function fetchAndCacheAssignmentStats(assignmentTaskId) {
  const orderResult = await fetchAllAssignmentOrders(assignmentTaskId);
  const sizeResult = await fetchAllOrderSizes(orderResult.shipmentIds);
  const sizeCounts = {};
  let bulkyOrders = 0;

  for (const item of sizeResult.items) {
    const sizeType = String(item?.size_type ?? '').trim();
    sizeCounts[sizeType || 'empty'] = (sizeCounts[sizeType || 'empty'] || 0) + 1;
    if (sizeType === '5' || sizeType === '6') bulkyOrders += 1;
  }

  const fetchedAt = Date.now();
  const totalOrders = orderResult.shipmentIds.length;
  const stats = {
    assignmentTaskId,
    totalOrders,
    bulkyOrders,
    nonBulkyOrders: Math.max(0, totalOrders - bulkyOrders),
    matchedSizeOrders: sizeResult.items.length,
    missingSizeOrders: Math.max(0, totalOrders - sizeResult.items.length),
    sizeCounts,
    fetchedAt,
    expiresAt: fetchedAt + ASSIGNMENT_STATS_CACHE_TTL_MS
  };

  await writeCachedAssignmentStats(assignmentTaskId, stats);
  return stats;
}

async function fetchAllAssignmentOrders(assignmentTaskId) {
  const orders = new Map();
  const pageSignatures = new Set();
  let expectedTotal = 0;

  for (let pageno = 1; pageno <= ASSIGNMENT_STATS_MAX_PAGES; pageno += 1) {
    const url = `${ASSIGNMENT_ORDERS_API_URL}?pageno=${pageno}&count=999&assignment_task_id=${encodeURIComponent(assignmentTaskId)}`;
    const result = await fetchSingleRequest({
      key: `assignment-orders-${assignmentTaskId}-${pageno}`,
      url,
      method: 'GET'
    });
    const data = result.data?.data || {};
    const list = Array.isArray(data.list) ? data.list : [];
    expectedTotal = Math.max(expectedTotal, numberOrZero(data.total));

    const signature = list.map(item => String(item?.shipment_id || '')).join('|');
    if (signature && pageSignatures.has(signature)) {
      throw new Error(`A paginação dos pedidos da AT ${assignmentTaskId} repetiu a página ${pageno}.`);
    }
    if (signature) pageSignatures.add(signature);

    for (const item of list) {
      const shipmentId = String(item?.shipment_id || '').trim();
      if (shipmentId) orders.set(shipmentId, item);
    }

    if (!list.length || (expectedTotal > 0 && orders.size >= expectedTotal)) break;
  }

  if (expectedTotal > 0 && orders.size < expectedTotal) {
    throw new Error(`Foram carregados ${orders.size} de ${expectedTotal} pedidos da AT ${assignmentTaskId}.`);
  }

  return {
    shipmentIds: [...orders.keys()],
    expectedTotal
  };
}

async function fetchAllOrderSizes(shipmentIds) {
  if (!shipmentIds.length) {
    return { items: [], expectedTotal: 0 };
  }

  const items = new Map();
  const pageSignatures = new Set();
  let expectedTotal = shipmentIds.length;

  for (let pageNo = 1; pageNo <= ASSIGNMENT_STATS_MAX_PAGES; pageNo += 1) {
    const result = await fetchSingleRequest({
      key: `order-sizes-${pageNo}`,
      url: ORDER_TRACKING_API_URL,
      method: 'POST',
      body: {
        count: ORDER_TRACKING_PAGE_SIZE,
        page_no: pageNo,
        search_id_list: shipmentIds
      }
    });
    const data = result.data?.data || {};
    const list = Array.isArray(data.list) ? data.list : [];
    const responseTotal = numberOrZero(data.total);
    if (responseTotal > 0) expectedTotal = responseTotal;

    const signature = list.map(item => String(item?.shipment_id || item?.sls_tracking_number || '')).join('|');
    if (signature && pageSignatures.has(signature)) {
      throw new Error(`A paginação dos tamanhos repetiu a página ${pageNo}.`);
    }
    if (signature) pageSignatures.add(signature);

    for (const item of list) {
      const shipmentId = String(item?.shipment_id || item?.sls_tracking_number || '').trim();
      if (shipmentId) items.set(shipmentId, item);
    }

    if (!list.length || (expectedTotal > 0 && items.size >= expectedTotal)) break;
  }

  return {
    items: [...items.values()],
    expectedTotal
  };
}

async function fetchSingleRequest(request) {
  const batch = await fetchBatch([request]);
  const result = batch.results[request.key];

  if (!result?.ok) {
    throw new Error(result?.error || 'Falha ao consultar o SPX.');
  }

  return result;
}

async function readCachedAssignmentStats(assignmentTaskId) {
  const cache = await loadAssignmentStatsCache();
  const item = cache[assignmentTaskId];

  if (!item) return null;
  if (numberOrZero(item.expiresAt) > Date.now()) return item;

  delete cache[assignmentTaskId];
  await persistAssignmentStatsCache(cache);
  return null;
}

async function writeCachedAssignmentStats(assignmentTaskId, stats) {
  const cache = await loadAssignmentStatsCache();
  cache[assignmentTaskId] = stats;
  await persistAssignmentStatsCache(cache);
}

async function loadAssignmentStatsCache() {
  if (!assignmentStatsCachePromise) {
    assignmentStatsCachePromise = LoaderBridge.request('storage.get', { keys: [ASSIGNMENT_STATS_CACHE_KEY] })
      .then(response => {
        if (!response?.ok) throw new Error(response?.error || 'Falha ao ler o cache do módulo.');
        const cache = response.values?.[ASSIGNMENT_STATS_CACHE_KEY];
        return cache && typeof cache === 'object' ? cache : {};
      })
      .catch(() => ({}));
  }

  return assignmentStatsCachePromise;
}

async function persistAssignmentStatsCache(cache) {
  const cutoff = Date.now() - ASSIGNMENT_STATS_CACHE_RETENTION_MS;

  for (const [assignmentTaskId, item] of Object.entries(cache)) {
    if (numberOrZero(item?.fetchedAt) < cutoff) delete cache[assignmentTaskId];
  }

  const response = await LoaderBridge.request('storage.set', { items: { [ASSIGNMENT_STATS_CACHE_KEY]: cache } });
  if (!response?.ok) throw new Error(response?.error || 'Falha ao salvar o cache do módulo.');
}

function normalizeAssignmentTaskId(value) {
  const assignmentTaskId = String(value || '').trim();
  return assignmentTaskId.length <= 128 ? assignmentTaskId : '';
}

function extractAssignmentTaskId(item) {
  if (!item || typeof item !== 'object') return '';

  const directCandidates = [
    item.assignment_task_id,
    item.assignmentTaskId,
    item.assignment_task_code,
    item.assignmentTaskCode,
    item.task_id,
    item.taskId,
    item.task_code,
    item.taskCode,
    item.code
  ];

  for (const candidate of directCandidates) {
    const value = normalizeAssignmentTaskId(candidate);
    if (/^AT[A-Z0-9]+$/i.test(value)) return value;
  }

  const visited = new Set();
  const queue = [{ value: item, depth: 0 }];

  while (queue.length) {
    const current = queue.shift();
    const value = current?.value;
    const depth = current?.depth || 0;

    if (!value || typeof value !== 'object' || visited.has(value) || depth > 2) continue;
    visited.add(value);

    for (const nested of Object.values(value)) {
      if (typeof nested === 'string') {
        const normalized = normalizeAssignmentTaskId(nested);
        if (/^AT[A-Z0-9]+$/i.test(normalized)) return normalized;
      } else if (nested && typeof nested === 'object') {
        queue.push({ value: nested, depth: depth + 1 });
      }
    }
  }

  return '';
}

function selectLatestAssignment(list) {
  const assignments = Array.isArray(list) ? list : [];
  const assignmentsWithRoute = assignments.filter(item =>
    String(item?.corridor_cage || item?.route || '').trim()
  );
  const candidates = assignmentsWithRoute.length ? assignmentsWithRoute : assignments;

  return [...candidates].sort((a, b) => {
    const assignedDifference = numberOrZero(b.driver_assigned_time) - numberOrZero(a.driver_assigned_time);
    if (assignedDifference !== 0) return assignedDifference;

    const modifiedDifference = numberOrZero(b.mtime) - numberOrZero(a.mtime);
    if (modifiedDifference !== 0) return modifiedDifference;

    return numberOrZero(b.id) - numberOrZero(a.id);
  })[0] || null;
}

async function fetchBatch(requests) {
  const response = await LoaderBridge.request('network.fetchBatch', {
    profileId: 'spx',
    requests
  });

  if (!response?.ok && !response?.results) {
    throw new Error(response?.error || 'Falha ao consultar o SPX pelo loader.');
  }

  return response;
}

async function getConnectionStatus() {
  const response = await LoaderBridge.request('network.connectionStatus', { profileId: 'spx' });
  if (!response?.ok) return response;

  return {
    ok: true,
    hasSpxTab: response.hasTab,
    hasCsrfToken: Boolean(response.headers?.['x-csrftoken']),
    hasDeviceId: Boolean(response.headers?.['device-id']),
    hasSapHeaders: Boolean(response.headers?.['x-sap-ri'] && response.headers?.['x-sap-sec']),
    capturedAt: response.capturedAt || null
  };
}

function uniquePositiveIntegers(values) {
  return [...new Set((values || [])
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0))];
}

function normalizeError(error) {
  return error?.message || String(error || 'Erro desconhecido');
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

window.SpxModuleService = Object.freeze({
  sendMessage: handleModuleMessage
});