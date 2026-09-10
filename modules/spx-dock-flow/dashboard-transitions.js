(() => {
  const routeCache = new Map();
  const DEMO_DOCK_DEFAULT = 9;
  const ACCESS_WINDOW_MS = 10000;
  const ACCESS_SEQUENCE = [76, 83, 67, 49, 57, 68, 79, 67, 75, 70, 76, 79, 87]
    .map(code => String.fromCharCode(code))
    .join('');
  const DEMO_ACCESS_TOKEN = Symbol();
  const SYNTHETIC_DRIVER_NAMES = [
    'RAFAEL MARTINS',
    'BRUNO OLIVEIRA',
    'LUCAS FERREIRA',
    'MARCOS ALMEIDA',
    'GABRIEL COSTA',
    'DANIEL RIBEIRO',
    'ANDRE SOUZA',
    'FELIPE BARBOSA',
    'RICARDO MENDES',
    'THIAGO ROCHA',
    'LEONARDO LIMA',
    'GUSTAVO CARDOSO'
  ];

  let demoDockCount = DEMO_DOCK_DEFAULT;
  let accessArmedUntil = 0;
  let accessBuffer = '';
  let operationalUiSnapshot = null;

  preserveCollectionDuringRefresh('dockQueues');
  preserveCollectionDuringRefresh('driverRoutes');

  const originalGetRouteDisplay = getRouteDisplay;
  const originalGetDisplayStatus = getDisplayStatus;
  const originalRenderDockGroups = renderDockGroups;
  const originalHideNotice = hideNotice;
  const originalShowFetchError = showFetchError;
  const originalLoadDemoData = loadDemoData;
  const originalCreateDemoDocks = createDemoDocks;
  const originalLoadDocks = loadDocks;

  removeLegacyDemoEntryPoints();
  clearDemoModeUi();
  bindProtectedAccess();

  loadDocks = async function guardedLoadDocks(manual = false) {
    if (state.demo) {
      state.countdown = REFRESH_INTERVAL_SECONDS;
      updateCountdown();
      return null;
    }

    return originalLoadDocks(manual);
  };

  getDisplayStatus = function stableGetDisplayStatus(dock, nextDriver = getNextDriver(dock)) {
    const result = originalGetDisplayStatus(dock, nextDriver);

    if (result?.key === 'loading' && Number(dock?.dock_status) === 2) {
      return { key: 'available', label: 'Disponível' };
    }

    return result;
  };

  getRouteDisplay = function stableGetRouteDisplay(dock, driverId, nextDriver, displayStatus) {
    const result = originalGetRouteDisplay(dock, driverId, nextDriver, displayStatus);
    const cacheKey = getRouteCacheKey(dock, driverId);

    if (!cacheKey) return result;

    if (displayStatus?.key !== 'occupied') {
      clearDockRouteCache(dock);
      return result;
    }

    if (result?.kind === 'route-ready' && result?.value) {
      routeCache.set(cacheKey, {
        value: result.value,
        detail: result.detail || '',
        placeholder: false,
        assignmentTaskId: result.assignmentTaskId || '',
        kind: 'route-ready'
      });
      return result;
    }

    if (result?.kind === 'route-finished') {
      routeCache.delete(cacheKey);
      return result;
    }

    if (result?.kind === 'route-searching' || result?.kind === 'route-missing') {
      const cached = routeCache.get(cacheKey);
      if (cached) return { ...cached };
    }

    return result;
  };

  renderDockGroups = function stableRenderDockGroups() {
    prunePreservedDockQueues();
    originalRenderDockGroups();
  };

  hideNotice = function enhancedHideNotice() {
    originalHideNotice();
    removeOpenSpxNoticeButton();
    clearDemoModeUi();
  };

  showFetchError = function enhancedShowFetchError(error, manual) {
    originalShowFetchError(error, manual);

    if (!isMissingSpxCookieError(error)) {
      removeOpenSpxNoticeButton();
      return;
    }

    elements.noticeMessage.textContent = 'Abra o sistema SPX em uma nova aba.';
    elements.noticeDetails.textContent = '';
    ensureOpenSpxNoticeButton();
  };

  createDemoDocks = function configurableCreateDemoDocks() {
    const templates = originalCreateDemoDocks();

    return Array.from({ length: demoDockCount }, (_, index) => {
      const template = templates[index % templates.length];
      const cycle = Math.floor(index / templates.length);
      const occupied = Boolean(String(template.occupied_vehicle_number || '').trim());
      const driverId = occupied
        ? 8100000 + index * 37 + cycle
        : 0;

      return {
        ...template,
        dock_id: 1936 + index,
        dock_name: `MESA ${index + 1}`,
        occupation_time: occupied ? Math.max(45, numberOrZero(template.occupation_time) + cycle * 37) : 0,
        idle_time: occupied ? 0 : Math.max(30, numberOrZero(template.idle_time) + cycle * 53 + index * 7),
        occupied_driver_id: driverId,
        occupied_driver_name: occupied ? createSyntheticDriverName(index) : '',
        occupied_vehicle_number: occupied ? createSyntheticVehicle(index) : ''
      };
    });
  };

  createDemoQueues = function configurableCreateDemoQueues() {
    const queues = {};

    state.docks.forEach((dock, index) => {
      if (isDockOccupied(dock) || index % 3 !== 1) return;

      const dockId = numberOrZero(dock.dock_id);
      const driverId = 8200000 + index * 41;
      queues[dockId] = {
        total: 1,
        error: null,
        items: [{
          queue_sequence: 1,
          waiting_time: 180 + index * 41,
          driver_id: driverId,
          driver_name: createSyntheticDriverName(index + 5),
          is_frozen: 0,
          frozen_dock_id: 0,
          is_prioritized: index % 2,
          corridor_cage: createDemoRoute(index),
          is_blocked_by_dual_cage: 0
        }]
      };
    });

    return queues;
  };

  createDemoRoutes = function configurableCreateDemoRoutes() {
    const routes = {};

    state.docks.forEach((dock, index) => {
      const driverId = numberOrZero(dock.occupied_driver_id);
      if (!driverId) return;

      routes[driverId] = {
        ok: true,
        found: true,
        route: createDemoRoute(index),
        driverAssignedTime: Math.floor(Date.now() / 1000) - numberOrZero(dock.occupation_time)
      };
    });

    Object.values(state.dockQueues || {}).forEach(queue => {
      (queue?.items || []).forEach((item, index) => {
        const driverId = numberOrZero(item.driver_id);
        if (!driverId) return;
        routes[driverId] = {
          ok: true,
          found: true,
          route: String(item.corridor_cage || createDemoRoute(index)),
          driverAssignedTime: Math.floor(Date.now() / 1000) - numberOrZero(item.waiting_time)
        };
      });
    });

    return routes;
  };

  loadDemoData = function protectedLoadDemoData(accessToken) {
    if (accessToken !== DEMO_ACCESS_TOKEN) return false;

    if (!operationalUiSnapshot) operationalUiSnapshot = captureOperationalUi();
    originalLoadDemoData();
    sanitizeDemoData();
    concealDemoModeUi();
    renderAll();
    return true;
  };

  function isMissingSpxCookieError(error) {
    const errorText = [error?.message, error?.details]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return errorText.includes('request header cookie.spx_cid or spx_sp_cid is required')
      || (
        errorText.includes('cookie.spx_cid')
        && errorText.includes('spx_sp_cid')
        && errorText.includes('required')
      );
  }

  function ensureOpenSpxNoticeButton() {
    let button = document.getElementById('openSpxNoticeButton');
    if (button) return;

    button = document.createElement('button');
    button.id = 'openSpxNoticeButton';
    button.className = 'button ghost';
    button.type = 'button';
    button.textContent = 'Abrir SPX';
    button.addEventListener('click', () => elements.openSpxButton?.click());

    elements.notice.appendChild(button);
  }

  function removeOpenSpxNoticeButton() {
    document.getElementById('openSpxNoticeButton')?.remove();
  }

  function bindProtectedAccess() {
    document.addEventListener('keydown', handleProtectedAccessKeydown, true);
    window.addEventListener('blur', resetProtectedAccess);
  }

  function handleProtectedAccessKeydown(event) {
    if (event.repeat || isEditableTarget(event.target)) {
      resetProtectedAccess();
      return;
    }

    const firstStep = event.ctrlKey
      && event.altKey
      && event.shiftKey
      && !event.metaKey
      && event.code === 'KeyD';

    if (firstStep) {
      event.preventDefault();
      accessArmedUntil = Date.now() + ACCESS_WINDOW_MS;
      accessBuffer = '';
      return;
    }

    if (!accessArmedUntil) return;

    if (Date.now() > accessArmedUntil) {
      resetProtectedAccess();
      return;
    }

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

    if (event.key === 'Enter') {
      if (accessBuffer === ACCESS_SEQUENCE) {
        event.preventDefault();
        toggleProtectedMode();
      }
      resetProtectedAccess();
      return;
    }

    if (event.key.length !== 1) {
      resetProtectedAccess();
      return;
    }

    const nextBuffer = `${accessBuffer}${event.key.toUpperCase()}`;
    if (!ACCESS_SEQUENCE.startsWith(nextBuffer)) {
      resetProtectedAccess();
      return;
    }

    event.preventDefault();
    accessBuffer = nextBuffer;
  }

  function resetProtectedAccess() {
    accessArmedUntil = 0;
    accessBuffer = '';
  }

  function toggleProtectedMode() {
    if (state.demo) {
      leaveProtectedMode();
      return;
    }

    operationalUiSnapshot = captureOperationalUi();
    loadDemoData(DEMO_ACCESS_TOKEN);
  }

  function leaveProtectedMode() {
    state.demo = false;
    resetLoadingHistory();
    clearDemoModeUi();
    operationalUiSnapshot = null;
    state.countdown = REFRESH_INTERVAL_SECONDS;
    updateCountdown();
    void loadDocks(true);
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
  }

  function captureOperationalUi() {
    return {
      connectionClassName: elements.connectionPill?.className || '',
      connectionText: elements.connectionText?.textContent || '',
      dataSourceText: elements.dataSource?.textContent || ''
    };
  }

  function restoreOperationalUi() {
    if (!operationalUiSnapshot) return;

    if (elements.connectionPill) {
      elements.connectionPill.className = operationalUiSnapshot.connectionClassName;
    }
    if (elements.connectionText) {
      elements.connectionText.textContent = operationalUiSnapshot.connectionText;
    }
    if (elements.dataSource) {
      elements.dataSource.textContent = operationalUiSnapshot.dataSourceText;
    }
  }

  function removeLegacyDemoEntryPoints() {
    const button = elements.demoButton || document.getElementById('demoButton');
    if (button) button.remove();
  }

  function concealDemoModeUi() {
    clearDemoModeUi();
    originalHideNotice();
    removeOpenSpxNoticeButton();
    restoreOperationalUi();
    removeLegacyDemoEntryPoints();
  }

  function clearDemoModeUi() {
    document.body.classList.remove('demo-mode-active');
    elements.notice?.classList.remove('demo-mode-notice');

    const badge = document.getElementById('demoModeBadge');
    if (badge) badge.remove();

    const control = document.getElementById('demoDockTestControl');
    if (control) control.remove();

    const styles = document.getElementById('spxDockFlowDemoStyles');
    if (styles) styles.remove();

    if (elements.noticeDetails) elements.noticeDetails.style.display = '';
    removeLegacyDemoEntryPoints();
  }

  function sanitizeDemoData() {
    state.docks = (state.docks || []).map((dock, index) => ({
      ...dock,
      occupied_driver_name: isDockOccupied(dock) ? createSyntheticDriverName(index) : '',
      occupied_vehicle_number: isDockOccupied(dock) ? createSyntheticVehicle(index) : ''
    }));

    Object.values(state.dockQueues || {}).forEach((queue, queueIndex) => {
      (queue?.items || []).forEach((item, itemIndex) => {
        item.driver_name = createSyntheticDriverName(queueIndex + itemIndex + 5);
      });
    });
  }

  function preserveCollectionDuringRefresh(propertyName) {
    let currentValue = state[propertyName];

    Object.defineProperty(state, propertyName, {
      configurable: true,
      enumerable: true,
      get() {
        return currentValue;
      },
      set(nextValue) {
        const isPlainObject = nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue);
        const isEmptyReset = isPlainObject && Object.keys(nextValue).length === 0;
        const hasValidCurrentValue = currentValue
          && typeof currentValue === 'object'
          && Object.keys(currentValue).length > 0;

        if (state.loading && isEmptyReset && hasValidCurrentValue) return;
        currentValue = nextValue;
      }
    });
  }

  function prunePreservedDockQueues() {
    if (!state.dockQueues || typeof state.dockQueues !== 'object') return;

    for (const dock of state.docks) {
      if (!isDockOccupied(dock)) continue;
      delete state.dockQueues[numberOrZero(dock.dock_id)];
    }
  }

  function getRouteCacheKey(dock, driverId) {
    const dockId = numberOrZero(dock?.dock_id);
    const occupantIdentity = typeof getDockOccupantIdentity === 'function'
      ? getDockOccupantIdentity(dock)
      : driverId > 0
        ? `driver:${driverId}`
        : '';

    if (!dockId || !occupantIdentity) return '';
    return `${dockId}:${occupantIdentity}`;
  }

  function clearDockRouteCache(dock) {
    const dockId = numberOrZero(dock?.dock_id);
    if (!dockId) return;

    const prefix = `${dockId}:`;
    for (const key of routeCache.keys()) {
      if (key.startsWith(prefix)) routeCache.delete(key);
    }
  }

  function createSyntheticDriverName(index) {
    return SYNTHETIC_DRIVER_NAMES[index % SYNTHETIC_DRIVER_NAMES.length];
  }

  function createSyntheticVehicle(index) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const a = letters[(index * 5 + 2) % letters.length];
    const b = letters[(index * 7 + 8) % letters.length];
    const c = letters[(index * 11 + 13) % letters.length];
    const d = letters[(index * 13 + 4) % letters.length];
    const firstDigit = (index * 3 + 1) % 10;
    const secondDigit = (index * 7 + 2) % 10;
    const thirdDigit = (index * 9 + 3) % 10;
    return `${a}${b}${c}${firstDigit}${d}${secondDigit}${thirdDigit}`;
  }

  function createDemoRoute(index) {
    const letter = String.fromCharCode(65 + (index % 20));
    return `${letter}-${String((index % 99) + 1).padStart(2, '0')}`;
  }
})();