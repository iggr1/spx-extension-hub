(() => {
  'use strict';

  const SETTINGS_KEY = 'spxDockFlowSettingsV1';
  const MARKED_KEY = 'spxDockFlowWorkstationV1';
  const POLL_MS = 15000;
  const CHECK_MS = 1000;
  const MAX_SAMPLE_AGE_MS = 75000;
  const FETCH_TIMEOUT_MS = 12000;
  const DEFAULT_THRESHOLD_SECONDS = 7 * 60;

  let snapshot = new Map();
  let lastFetchAt = 0;
  let lastError = '';
  let fetching = false;
  let pollTimer = 0;
  let tickTimer = 0;
  let previousScope = '';
  let previousMarkedDock = '';

  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  function settings() {
    try {
      const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return { scope: value.alarmScope === 'all' ? 'all' : 'marked' };
    } catch {
      return { scope: 'marked' };
    }
  }

  function markedDock() {
    try {
      return normalize(JSON.parse(localStorage.getItem(MARKED_KEY) || '{}')?.dockName);
    } catch {
      return '';
    }
  }

  function isOccupied(dock) {
    return Boolean(String(dock?.occupied_vehicle_number || '').trim()) || Number(dock?.dock_status) === 1;
  }

  function operationId(dock) {
    return [
      normalize(dock.dock_name),
      number(dock.occupied_driver_id),
      String(dock.operation_task_id || '').trim()
    ].join('|');
  }

  function thresholdFor(dock) {
    const taskId = String(dock.operation_task_id || '').trim();
    const current = state.assignmentStats?.[taskId];
    const count = current?.status === 'ready' ? number(current.totalOrders) : 0;
    return count > 0 ? Math.max(2, Math.ceil(count * 7 / 100)) * 60 : DEFAULT_THRESHOLD_SECONDS;
  }

  function monitored(name, scope, selected) {
    return scope === 'all' || Boolean(selected && selected === name);
  }

  function isOverdue(entry, now) {
    if (!entry.occupied || entry.finished || !entry.startedAt) return false;
    return (now - entry.startedAt) / 1000 > entry.thresholdSeconds;
  }

  function isFinished(dock) {
    const driverId = number(dock.occupied_driver_id);
    const taskId = String(dock.operation_task_id || '').trim();
    const routeState = state.driverRoutes?.[driverId];
    if (!routeState || (taskId && routeState.assignmentTaskId !== taskId)) return false;
    try {
      const status = getDisplayStatus(dock, null);
      return getRouteDisplay(dock, driverId, null, status)?.kind === 'route-finished';
    } catch {
      return false;
    }
  }

  function syncSnapshot(docks) {
    const now = Date.now();
    const next = new Map();
    const { scope } = settings();
    const selected = markedDock();
    const filterChanged = scope !== previousScope || selected !== previousMarkedDock;
    previousScope = scope;
    previousMarkedDock = selected;

    for (const dock of docks) {
      const name = normalize(dock?.dock_name);
      if (!name) continue;
      const occupied = isOccupied(dock);
      const key = occupied ? operationId(dock) : name + '|free';
      const seconds = number(dock.occupation_time);
      const startedAt = occupied ? now - Math.max(0, seconds) * 1000 : 0;
      const thresholdSeconds = thresholdFor(dock);
      const finished = occupied && isFinished(dock);
      const prev = snapshot.get(name);
      const changed = !prev || prev.operationId !== key
        || (occupied && Math.abs(prev.startedAt - startedAt) > 90000);
      const selectedForAlarm = monitored(name, scope, selected);
      const previouslySelected = prev?.selectedForAlarm && !filterChanged;

      const entry = {
        name, operationId: key, occupied, startedAt, thresholdSeconds, finished,
        selectedForAlarm, lastAlarmAt: changed || filterChanged ? 0 : prev.lastAlarmAt,
        wasOverdue: changed || filterChanged || !previouslySelected
          ? occupied && !finished && seconds > thresholdSeconds
          : prev.wasOverdue
      };
      next.set(name, entry);
    }

    snapshot = next;
    lastFetchAt = now;
    lastError = '';
    checkForOverdue();
    updateMonitorStatus();
  }

  function checkForOverdue() {
    const now = Date.now();
    if (!lastFetchAt || now - lastFetchAt > MAX_SAMPLE_AGE_MS) return;

    const { scope } = settings();
    const selected = markedDock();
    if (scope !== previousScope || selected !== previousMarkedDock) {
      previousScope = scope;
      previousMarkedDock = selected;
      for (const entry of snapshot.values()) {
        entry.selectedForAlarm = monitored(entry.name, scope, selected);
        entry.wasOverdue = isOverdue(entry, now);
      }
      return;
    }

    let shouldSound = false;
    for (const entry of snapshot.values()) {
      const overdue = isOverdue(entry, now);
      const justExceeded = entry.selectedForAlarm && !entry.wasOverdue && overdue;
      if (justExceeded && !entry.lastAlarmAt) {
        entry.lastAlarmAt = now;
        shouldSound = true;
      }
      entry.wasOverdue = overdue;
    }
    if (shouldSound && typeof window.__spxDockFlowPlayAlarm === 'function') {
      window.__spxDockFlowPlayAlarm();
    }
  }

  async function poll() {
    if (fetching) return;
    fetching = true;
    let timeout;
    try {
      const request = sendMessage({
        type: 'FETCH_DOCKS',
        payload: { dockActiveStatus: 1, pageno: 1, count: 100 }
      });
      const response = await Promise.race([
        request,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Tempo limite excedido')), FETCH_TIMEOUT_MS);
        })
      ]);
      const docks = response?.data?.data?.dock_list;
      if (!response?.ok || response.data?.retcode !== 0 || !Array.isArray(docks)) {
        throw new Error(response?.error || 'Resposta inválida da SPX');
      }
      syncSnapshot(docks);
    } catch (error) {
      lastError = String(error?.message || error);
      updateMonitorStatus();
    } finally {
      clearTimeout(timeout);
      fetching = false;
      schedulePoll();
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, POLL_MS);
  }

  function updateMonitorStatus() {
    const element = document.getElementById('dockAlarmMonitorStatus');
    if (!element) return;
    const selection = settings().scope === 'all' ? 'todas as docas' : 'apenas a doca marcada';
    element.textContent = lastError
      ? 'Monitor: aguardando resposta da SPX (' + lastError + '). Nenhum alarme será disparado com dados desatualizados.'
      : 'Monitor de atrasos ativo: ' + selection + ' · consulta independente a cada 15 segundos.'
        + (document.hidden ? ' A execução em abas ocultas pode ser limitada pelo Chrome.' : '');
    element.dataset.state = lastError ? 'warning' : 'active';
  }

  function start() {
    window.addEventListener('storage', event => {
      if (event.key !== MARKED_KEY && event.key !== SETTINGS_KEY) return;
      checkForOverdue();
      updateMonitorStatus();
    });
    window.addEventListener('spx-dock-alarm-settings-changed', () => {
      checkForOverdue();
      updateMonitorStatus();
    });
    document.addEventListener('visibilitychange', () => {
      updateMonitorStatus();
      if (!document.hidden) void poll();
    });
    window.addEventListener('focus', () => { if (Date.now() - lastFetchAt > POLL_MS) void poll(); });
    tickTimer = setInterval(checkForOverdue, CHECK_MS);
    void poll();
    updateMonitorStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
