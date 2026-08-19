(() => {
  const routeCache = new Map();
  const DEMO_DOCK_MIN = 1;
  const DEMO_DOCK_MAX = 100;
  const DEMO_DOCK_DEFAULT = 9;

  let demoDockCount = DEMO_DOCK_DEFAULT;

  preserveCollectionDuringRefresh('dockQueues');
  preserveCollectionDuringRefresh('driverRoutes');

  const originalGetRouteDisplay = getRouteDisplay;
  const originalGetDisplayStatus = getDisplayStatus;
  const originalRenderDockGroups = renderDockGroups;
  const originalHideNotice = hideNotice;
  const originalLoadDemoData = loadDemoData;
  const originalCreateDemoDocks = createDemoDocks;

  installDemoStyles();

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
    clearDemoModeUi();
  };

  createDemoDocks = function configurableCreateDemoDocks() {
    const templates = originalCreateDemoDocks();

    return Array.from({ length: demoDockCount }, (_, index) => {
      const template = templates[index % templates.length];
      const cycle = Math.floor(index / templates.length);
      const occupied = Boolean(String(template.occupied_vehicle_number || '').trim());
      const driverId = occupied
        ? cycle === 0
          ? numberOrZero(template.occupied_driver_id)
          : numberOrZero(template.occupied_driver_id) + cycle * 100000 + index
        : 0;

      return {
        ...template,
        dock_id: 1936 + index,
        dock_name: `MESA ${index + 1}`,
        occupation_time: occupied ? Math.max(45, numberOrZero(template.occupation_time) + cycle * 37) : 0,
        idle_time: occupied ? 0 : Math.max(30, numberOrZero(template.idle_time) + cycle * 53 + index * 7),
        occupied_driver_id: driverId,
        occupied_driver_name: occupied
          ? `${template.occupied_driver_name || 'MOTORISTA DEMO'}${cycle ? ` ${cycle + 1}` : ''}`
          : '',
        occupied_vehicle_number: occupied
          ? createDemoVehicle(index, template.occupied_vehicle_number)
          : ''
      };
    });
  };

  createDemoQueues = function configurableCreateDemoQueues() {
    const queues = {};

    state.docks.forEach((dock, index) => {
      if (isDockOccupied(dock) || index % 3 !== 1) return;

      const dockId = numberOrZero(dock.dock_id);
      const driverId = 7000000 + index;
      queues[dockId] = {
        total: 1,
        error: null,
        items: [{
          queue_sequence: 1,
          waiting_time: 180 + index * 41,
          driver_id: driverId,
          driver_name: `MOTORISTA DEMO ${index + 1}`,
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
      (queue?.items || []).forEach(item => {
        const driverId = numberOrZero(item.driver_id);
        if (!driverId) return;
        routes[driverId] = {
          ok: true,
          found: true,
          route: String(item.corridor_cage || 'DEMO'),
          driverAssignedTime: Math.floor(Date.now() / 1000) - numberOrZero(item.waiting_time)
        };
      });
    });

    return routes;
  };

  loadDemoData = function enhancedLoadDemoData() {
    originalLoadDemoData();
    showDemoModeUi();
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

  function createDemoVehicle(index, fallback) {
    if (index < DEMO_DOCK_DEFAULT && fallback) return fallback;
    const suffix = String(index + 1).padStart(4, '0');
    return `DEM${suffix.slice(0, 1)}A${suffix.slice(-3)}`;
  }

  function createDemoRoute(index) {
    const letter = String.fromCharCode(65 + (index % 20));
    return `${letter}-${String((index % 99) + 1).padStart(2, '0')}`;
  }

  function clampDemoDockCount(value) {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number)) return demoDockCount;
    return Math.min(DEMO_DOCK_MAX, Math.max(DEMO_DOCK_MIN, number));
  }

  function showDemoModeUi() {
    document.body.classList.add('demo-mode-active');
    elements.notice.classList.remove('hidden');
    elements.notice.classList.add('demo-mode-notice');
    elements.noticeTitle.textContent = 'MODO DEMONSTRAÇÃO · DADOS FICTÍCIOS';
    elements.noticeMessage.textContent = 'Motoristas, rotas, tempos e docas abaixo são simulados e não representam a operação real.';
    elements.noticeDetails.textContent = 'Use a quantidade de docas para testar densidade e paginação automática. Acima de 20, as páginas alternam a cada 10 segundos.';
    elements.noticeDetails.style.display = 'block';
    elements.dataSource.textContent = `Fonte: simulação local · ${state.docks.length} docas fictícias`;
    setConnectionState('warning', 'DEMO · dados fictícios');

    if (elements.demoButton) elements.demoButton.textContent = 'Recarregar demo';

    ensureDemoBadge();
    ensureDemoDockControl();
  }

  function clearDemoModeUi() {
    document.body.classList.remove('demo-mode-active');
    elements.notice?.classList.remove('demo-mode-notice');

    const badge = document.getElementById('demoModeBadge');
    if (badge) badge.remove();

    const control = document.getElementById('demoDockTestControl');
    if (control) control.remove();

    if (elements.demoButton) elements.demoButton.textContent = 'Demonstração';
    if (elements.noticeDetails) elements.noticeDetails.style.display = '';
  }

  function ensureDemoBadge() {
    let badge = document.getElementById('demoModeBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'demoModeBadge';
      badge.className = 'demo-mode-badge';
      document.body.appendChild(badge);
    }
    badge.textContent = 'DEMONSTRAÇÃO · DADOS FICTÍCIOS';
  }

  function ensureDemoDockControl() {
    let control = document.getElementById('demoDockTestControl');
    if (control) {
      const input = control.querySelector('input');
      if (input) input.value = String(demoDockCount);
      return;
    }

    control = document.createElement('label');
    control.id = 'demoDockTestControl';
    control.className = 'demo-dock-test-control';
    control.innerHTML = `
      <span>Docas no teste</span>
      <input type="number" min="${DEMO_DOCK_MIN}" max="${DEMO_DOCK_MAX}" step="1" value="${demoDockCount}" inputmode="numeric" aria-label="Quantidade de docas fictícias">
      <button type="button">Aplicar</button>
    `;

    const input = control.querySelector('input');
    const button = control.querySelector('button');

    const apply = () => {
      demoDockCount = clampDemoDockCount(input?.value);
      if (input) input.value = String(demoDockCount);
      loadDemoData();
    };

    input?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      apply();
    });
    input?.addEventListener('change', apply);
    button?.addEventListener('click', event => {
      event.preventDefault();
      apply();
    });

    elements.notice.insertBefore(control, elements.demoButton || null);
  }

  function installDemoStyles() {
    if (document.getElementById('spxDockFlowDemoStyles')) return;

    const style = document.createElement('style');
    style.id = 'spxDockFlowDemoStyles';
    style.textContent = `
      .demo-mode-badge {
        position: fixed;
        top: 8px;
        left: 50%;
        z-index: 9999;
        transform: translateX(-50%);
        padding: 6px 14px;
        border: 2px solid rgba(255, 255, 255, 0.78);
        border-radius: 999px;
        color: #fff;
        background: #c62828;
        box-shadow: 0 6px 22px rgba(198, 40, 40, 0.42);
        font-size: 11px;
        font-weight: 950;
        letter-spacing: 0.08em;
        line-height: 1;
        pointer-events: none;
      }

      .notice.demo-mode-notice {
        min-height: 62px;
        border: 2px solid #d32f2f;
        background: linear-gradient(110deg, rgba(211, 47, 47, 0.16), rgba(255, 152, 0, 0.11));
        box-shadow: 0 0 0 2px rgba(211, 47, 47, 0.08), 0 8px 24px rgba(211, 47, 47, 0.12);
      }

      .demo-mode-notice .notice-icon {
        background: #c62828;
        animation: demo-warning-pulse 1.2s ease-in-out infinite alternate;
      }

      .demo-mode-notice .notice-copy {
        flex: 1 1 360px;
      }

      .demo-mode-notice .notice-copy strong {
        color: #d32f2f;
        font-size: 13px;
        font-weight: 950;
        letter-spacing: 0.04em;
      }

      html[data-theme="dark"] .demo-mode-notice .notice-copy strong {
        color: #ff6b6b;
      }

      .demo-mode-notice .notice-copy p {
        max-width: none;
        overflow: visible;
        text-overflow: clip;
        white-space: normal;
      }

      .demo-mode-notice .notice-details {
        display: block;
        font-weight: 750;
      }

      .demo-dock-test-control {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 6px;
        margin-left: auto;
        padding: 5px 7px;
        border: 1px solid rgba(211, 47, 47, 0.35);
        border-radius: 10px;
        background: var(--surface);
        color: var(--ink);
        font-size: 10px;
        font-weight: 850;
        white-space: nowrap;
      }

      .demo-dock-test-control input {
        width: 66px;
        min-height: 30px;
        padding: 0 7px;
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--ink);
        background: var(--surface-soft);
        font: inherit;
        font-variant-numeric: tabular-nums;
      }

      .demo-dock-test-control button {
        min-height: 30px;
        padding: 0 9px;
        border: 0;
        border-radius: 8px;
        color: #fff;
        background: #c62828;
        font-size: 10px;
        font-weight: 900;
        cursor: pointer;
      }

      .demo-mode-notice .button.ghost {
        margin-left: 0;
      }

      @keyframes demo-warning-pulse {
        from { box-shadow: 0 0 0 0 rgba(198, 40, 40, 0.12); }
        to { box-shadow: 0 0 0 7px rgba(198, 40, 40, 0.18); }
      }

      @media (max-width: 900px) {
        .notice.demo-mode-notice {
          flex-wrap: wrap;
        }

        .demo-dock-test-control {
          margin-left: 40px;
        }

        .demo-mode-badge {
          top: 4px;
          font-size: 9px;
        }
      }
    `;
    document.head.appendChild(style);
  }
})();
