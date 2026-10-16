(() => {
  'use strict';

  const SETTINGS_KEY = 'dockAlarm:settingsV1';
  const TRACKED_KEY = 'dockAlarm:trackedV1';
  const STATUS_KEY = 'dockAlarm:statusV1';
  const POLL_ALARM = 'spx-dock-monitor-poll';
  const DEADLINE_ALARM = 'spx-dock-monitor-deadline';
  const DOCK_URL = 'https://spx.shopee.com.br/api/in-station/dock_management/dock/list';
  const DEFAULT_THRESHOLD = 7 * 60;
  let inflight = null;

  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  function sanitize(payload) {
    const thresholds = {};
    for (const [id, seconds] of Object.entries(payload?.thresholds || {}).slice(0, 300)) {
      const n = number(seconds);
      if (id.length < 100 && n >= 120 && n <= 86400) thresholds[id] = n;
    }
    return {
      scope: payload?.scope === 'all' ? 'all' : 'marked',
      dockName: normalize(payload?.dockName),
      thresholds,
      updatedAt: Date.now()
    };
  }

  async function configure(payload) {
    const settings = sanitize(payload);
    const old = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    if (old?.scope !== settings.scope || old?.dockName !== settings.dockName) {
      await chrome.storage.local.remove(TRACKED_KEY);
    }
    await ensureScheduled();
    if (enabled(settings)) void checkDocks();
    return { ok: true, background: true, scope: settings.scope, dockName: settings.dockName };
  }

  function enabled(settings) {
    return settings?.scope === 'all' || Boolean(settings?.dockName);
  }

  async function status() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY, STATUS_KEY]);
    return { ok: true, background: true, settings: stored[SETTINGS_KEY] || null, status: stored[STATUS_KEY] || null };
  }

  async function ensureScheduled() {
    const saved = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    if (!enabled(saved)) {
      await Promise.all([chrome.alarms.clear(POLL_ALARM), chrome.alarms.clear(DEADLINE_ALARM)]);
      return;
    }
    await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  }

  async function checkDocks() {
    if (inflight) return inflight;
    inflight = performCheck().finally(() => { inflight = null; });
    return inflight;
  }

  async function performCheck() {
    const store = await chrome.storage.local.get([SETTINGS_KEY, TRACKED_KEY]);
    const settings = store[SETTINGS_KEY];
    if (!enabled(settings)) return;
    const previous = store[TRACKED_KEY] || {};
    const now = Date.now();
    try {
      const module = await getModule('spx-dock-flow');
      const response = await networkFetchBatch(module, {
        profileId: 'spx',
        requests: [{
          key: 'dock-monitor',
          url: DOCK_URL,
          method: 'POST',
          body: { dock_active_status: 1, pageno: 1, count: 100 }
        }]
      });
      const result = response?.results?.['dock-monitor'];
      const list = result?.data?.data?.dock_list;
      if (!result?.ok || result?.data?.retcode !== 0 || !Array.isArray(list)) {
        throw new Error(result?.error || 'Consulta de docas indisponível.');
      }

      const next = {};
      let shouldPlay = false;
      let nextDeadline = Infinity;
      let observed = 0;

      for (const dock of list) {
        const name = normalize(dock?.dock_name);
        if (!name || (settings.scope !== 'all' && name !== settings.dockName)) continue;
        observed += 1;

        const occupied = Boolean(String(dock.occupied_vehicle_number || '').trim()) || Number(dock.dock_status) === 1;
        const driverId = number(dock.occupied_driver_id);
        const taskId = String(dock.operation_task_id || '').trim();
        const operationKey = occupied ? [name, driverId, taskId].join('|') : name + '|free';
        const seconds = occupied ? Math.max(0, number(dock.occupation_time)) : 0;
        const startedAt = occupied ? now - seconds * 1000 : 0;
        const threshold = settings.thresholds?.[taskId] || DEFAULT_THRESHOLD;
        const overdue = occupied && seconds > threshold;
        const old = previous[name];
        const changed = !old || old.operationKey !== operationKey || (occupied && Math.abs(old.startedAt - startedAt) > 90000);

        const alerted = changed ? overdue : Boolean(old.alerted);
        const lastOverdue = changed ? overdue : Boolean(old.overdue);

        if (!changed && occupied && !lastOverdue && overdue && !alerted) shouldPlay = true;

        const finalAlerted = alerted || (!changed && occupied && !lastOverdue && overdue);
        next[name] = { operationKey, startedAt, overdue, alerted: finalAlerted };

        if (occupied && !overdue && !finalAlerted) {
          nextDeadline = Math.min(nextDeadline, startedAt + (threshold + 1) * 1000);
        }
      }

      await chrome.storage.local.set({
        [TRACKED_KEY]: next,
        [STATUS_KEY]: {
          lastCheckAt: now, monitoredDocks: observed, source: response.source || '',
          scope: settings.scope, nextDeadline: Number.isFinite(nextDeadline) ? nextDeadline : null,
          lastError: ''
        }
      });

      await chrome.alarms.clear(DEADLINE_ALARM);
      if (Number.isFinite(nextDeadline) && nextDeadline > now) {
        await chrome.alarms.create(DEADLINE_ALARM, { when: Math.max(Date.now() + 1000, nextDeadline) });
      }
      if (shouldPlay) await playAlarm();
    } catch (error) {
      await chrome.storage.local.set({
        [STATUS_KEY]: { lastCheckAt: now, lastError: String(error?.message || error), scope: settings.scope }
      });
    }
  }

  async function playAlarm() {
    try {
      const url = chrome.runtime.getURL('dock-alarm-audio.html');
      if (!(await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.createDocument({
          url,
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Reproduzir aviso curto de carregamento atrasado no Dock Flow.'
        });
      }
      await chrome.runtime.sendMessage({ type: 'SPX_DOCK_ALARM_PLAY' });
    } catch (error) {
      const saved = await chrome.storage.local.get(STATUS_KEY);
      await chrome.storage.local.set({
        [STATUS_KEY]: { ...(saved[STATUS_KEY] || {}), audioError: String(error?.message || error) }
      });
    }
  }

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === POLL_ALARM || alarm.name === DEADLINE_ALARM) void checkDocks();
  });
  chrome.runtime.onInstalled.addListener(() => { void ensureScheduled(); });
  chrome.runtime.onStartup.addListener(() => { void ensureScheduled(); });
  void ensureScheduled();

  self.spxDockAlarm = Object.freeze({ configure, status, checkDocks });
})();
