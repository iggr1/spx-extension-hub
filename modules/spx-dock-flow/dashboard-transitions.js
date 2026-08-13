(() => {
  const STATUS_FLASH_DURATION_MS = 2600;
  const STATUS_CLASSES = ['occupied', 'next', 'available', 'inactive', 'unknown', 'loading'];
  const routeCache = new Map();

  preserveCollectionDuringRefresh('dockQueues');
  preserveCollectionDuringRefresh('driverRoutes');

  const originalGetRouteDisplay = getRouteDisplay;
  const originalGetDisplayStatus = getDisplayStatus;
  const originalRenderDockGroups = renderDockGroups;

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

  renderDockGroups = function renderDockGroupsWithStatusFeedback() {
    const previousStatuses = collectCurrentStatuses();
    prunePreservedDockQueues();
    originalRenderDockGroups();
    highlightChangedStatuses(previousStatuses);
  };

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

  function collectCurrentStatuses() {
    const statuses = new Map();

    document.querySelectorAll('.dock-card[data-dock-id]').forEach(card => {
      const dockId = String(card.dataset.dockId || '').trim();
      if (!dockId) return;
      statuses.set(dockId, getCardStatus(card));
    });

    return statuses;
  }

  function getCardStatus(card) {
    if (card.classList.contains('loading-finished')) return 'finished';

    for (const status of STATUS_CLASSES) {
      if (card.classList.contains(status)) return status;
    }

    return 'unknown';
  }

  function highlightChangedStatuses(previousStatuses) {
    document.querySelectorAll('.dock-card[data-dock-id]').forEach(card => {
      const dockId = String(card.dataset.dockId || '').trim();
      const previousStatus = previousStatuses.get(dockId);
      if (!previousStatus) return;

      const currentStatus = getCardStatus(card);
      if (currentStatus === previousStatus) return;

      card.classList.remove('status-change-flash');
      void card.offsetWidth;
      card.classList.add('status-change-flash');
      card.dataset.previousStatus = previousStatus;
      card.dataset.currentStatus = currentStatus;

      window.setTimeout(() => {
        card.classList.remove('status-change-flash');
      }, STATUS_FLASH_DURATION_MS);
    });
  }
})();
