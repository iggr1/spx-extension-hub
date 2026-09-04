const REFRESH_INTERVAL_SECONDS = 10;
const LOADING_ALERT_THRESHOLD_SECONDS = 10 * 60;
const WAITING_ALERT_THRESHOLD_SECONDS = 10 * 60;
const STATION_ID = 5264;
const THEME_STORAGE_KEY = 'spxDockFlowTheme';
const ASSIGNMENT_STATS_RETRY_DELAY_MS = 2 * 60 * 1000;
const LOADING_HISTORY_WINDOW_SECONDS = 4 * 60 * 60;
const HEADER_HEIGHT_STORAGE_KEY = 'spxDockFlowHeaderHeight';
const HEADER_COLLAPSED_STORAGE_KEY = 'spxDockFlowHeaderCollapsed';
const HEADER_MIN_HEIGHT = 84;
const HEADER_MAX_HEIGHT = 260;

let gridFitFrame = 0;

const state = {
  docks: [],
  fetchedAt: 0,
  filter: 'all',
  search: '',
  countdown: REFRESH_INTERVAL_SECONDS,
  loading: false,
  demo: false,
  dockQueues: {},
  queueLoading: false,
  driverRoutes: {},
  routesLoading: false,
  assignmentStats: {},
  dockRouteMemory: {},
  validationProgress: createEmptyValidationProgress(),
  openedAt: Date.now(),
  loadingHistory: {
    active: {},
    completed: []
  },
  headerHeight: 122,
  headerCollapsed: false
};

const elements = {
  connectionPill: document.getElementById('connectionPill'),
  connectionText: document.getElementById('connectionText'),
  countdownRing: document.getElementById('countdownRing'),
  countdownValue: document.getElementById('countdownValue'),
  lastUpdated: document.getElementById('lastUpdated'),
  refreshButton: document.getElementById('refreshButton'),
  openSpxButton: document.getElementById('openSpxButton'),
  demoButton: document.getElementById('demoButton'),
  notice: document.getElementById('notice'),
  noticeTitle: document.getElementById('noticeTitle'),
  noticeMessage: document.getElementById('noticeMessage'),
  noticeDetails: document.getElementById('noticeDetails'),
  totalDocks: document.getElementById('totalDocks'),
  occupiedDocks: document.getElementById('occupiedDocks'),
  nextDocks: document.getElementById('nextDocks'),
  availableDocks: document.getElementById('availableDocks'),
  validationRoutes: document.getElementById('validationRoutes'),
  validationPercentage: document.getElementById('validationPercentage'),
  validationProgressBar: document.getElementById('validationProgressBar'),
  validationProgressTrack: document.querySelector('.summary-progress-track'),
  validationRoutesCard: document.getElementById('validationRoutesCard'),
  validationPercentageCard: document.getElementById('validationPercentageCard'),
  averageOccupation: document.getElementById('averageOccupation'),
  averageOccupationCard: document.getElementById('averageOccupationCard'),
  themeToggle: document.getElementById('themeToggle'),
  fullscreenButton: document.getElementById('fullscreenButton'),
  dockGroups: document.getElementById('dockGroups'),
  dataSource: document.getElementById('dataSource'),
  dashboardHeader: document.getElementById('dashboardHeader'),
  headerToggle: document.getElementById('headerToggle'),
  headerResizer: document.getElementById('headerResizer')
};

initializeTheme();
initializeHeader();
bindEvents();
initialize();

async function initialize() {
  await refreshConnectionStatus();
  await loadDocks();
  window.setInterval(handleSecondTick, 1000);
}

function bindEvents() {
  elements.refreshButton.addEventListener('click', () => loadDocks(true));
  elements.openSpxButton.addEventListener('click', () => sendMessage({ type: 'OPEN_SPX' }));
  elements.demoButton.addEventListener('click', () => loadDemoData());
  elements.themeToggle.addEventListener('click', toggleTheme);
  elements.fullscreenButton.addEventListener('click', toggleFullscreen);
  elements.headerToggle.addEventListener('click', toggleHeader);
  elements.headerResizer.addEventListener('pointerdown', beginHeaderResize);
  elements.headerResizer.addEventListener('keydown', handleHeaderResizeKeydown);

  window.addEventListener('resize', () => {
    constrainHeaderHeight();
    scheduleGridFit();
  });
  document.addEventListener('fullscreenchange', () => {
    document.documentElement.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
    elements.fullscreenButton.title = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
    elements.fullscreenButton.setAttribute('aria-label', elements.fullscreenButton.title);
    scheduleGridFit();
  });

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(scheduleGridFit);
    resizeObserver.observe(elements.dockGroups);
  }
}

function initializeHeader() {
  const savedHeight = Number(localStorage.getItem(HEADER_HEIGHT_STORAGE_KEY));
  const savedCollapsed = localStorage.getItem(HEADER_COLLAPSED_STORAGE_KEY) === 'true';

  state.headerHeight = clampHeaderHeight(savedHeight || state.headerHeight);
  state.headerCollapsed = savedCollapsed;
  applyHeaderState();
}

function toggleHeader() {
  state.headerCollapsed = !state.headerCollapsed;
  localStorage.setItem(HEADER_COLLAPSED_STORAGE_KEY, String(state.headerCollapsed));
  applyHeaderState();
  window.setTimeout(scheduleGridFit, 230);
}

function applyHeaderState() {
  elements.dashboardHeader.classList.toggle('is-collapsed', state.headerCollapsed);
  document.documentElement.style.setProperty('--dashboard-header-height', `${state.headerHeight}px`);
  applyHeaderSizing();

  const label = state.headerCollapsed ? 'Expandir cabeçalho' : 'Recolher cabeçalho';
  elements.headerToggle.title = label;
  elements.headerToggle.setAttribute('aria-label', label);
  elements.headerToggle.setAttribute('aria-expanded', String(!state.headerCollapsed));
}

function beginHeaderResize(event) {
  if (state.headerCollapsed || event.button !== 0) return;

  event.preventDefault();
  const startY = event.clientY;
  const startHeight = elements.dashboardHeader.getBoundingClientRect().height;

  elements.dashboardHeader.classList.add('is-resizing');
  document.body.classList.add('header-is-resizing');

  const handleMove = moveEvent => {
    setHeaderHeight(startHeight + moveEvent.clientY - startY, false);
  };

  const handleEnd = () => {
    elements.dashboardHeader.classList.remove('is-resizing');
    document.body.classList.remove('header-is-resizing');
    localStorage.setItem(HEADER_HEIGHT_STORAGE_KEY, String(state.headerHeight));
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleEnd);
    window.removeEventListener('pointercancel', handleEnd);
    scheduleGridFit();
  };

  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleEnd);
  window.addEventListener('pointercancel', handleEnd);
}

function handleHeaderResizeKeydown(event) {
  if (state.headerCollapsed) return;

  const step = event.shiftKey ? 24 : 8;
  let nextHeight = state.headerHeight;

  if (event.key === 'ArrowUp') nextHeight -= step;
  else if (event.key === 'ArrowDown') nextHeight += step;
  else if (event.key === 'Home') nextHeight = HEADER_MIN_HEIGHT;
  else if (event.key === 'End') nextHeight = getHeaderMaxHeight();
  else return;

  event.preventDefault();
  setHeaderHeight(nextHeight, true);
}

function setHeaderHeight(height, persist = true) {
  state.headerHeight = clampHeaderHeight(height);
  document.documentElement.style.setProperty('--dashboard-header-height', `${state.headerHeight}px`);
  applyHeaderSizing();
  if (persist) localStorage.setItem(HEADER_HEIGHT_STORAGE_KEY, String(state.headerHeight));
  scheduleGridFit();
}

function constrainHeaderHeight() {
  const constrainedHeight = clampHeaderHeight(state.headerHeight);
  if (constrainedHeight !== state.headerHeight) setHeaderHeight(constrainedHeight, true);
}

function clampHeaderHeight(height) {
  return Math.round(Math.min(getHeaderMaxHeight(), Math.max(HEADER_MIN_HEIGHT, numberOrZero(height))));
}

function getHeaderMaxHeight() {
  return Math.max(HEADER_MIN_HEIGHT, Math.min(HEADER_MAX_HEIGHT, Math.floor(window.innerHeight * 0.38)));
}

function applyHeaderSizing() {
  const height = state.headerHeight;
  const topbarHeight = Math.round(Math.min(78, Math.max(42, 42 + (height - HEADER_MIN_HEIGHT) * 0.47)));
  const headerGap = Math.round(Math.min(10, Math.max(4, 4 + (height - HEADER_MIN_HEIGHT) * 0.08)));

  document.documentElement.style.setProperty('--topbar-height', `${topbarHeight}px`);
  document.documentElement.style.setProperty('--header-gap', `${headerGap}px`);
  elements.dashboardHeader.classList.toggle('header-tight', height <= 94);
  elements.dashboardHeader.classList.toggle('header-compact', height <= 114);
  elements.dashboardHeader.classList.toggle('header-spacious', height >= 170);
}

function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(savedTheme === 'light' ? 'light' : 'dark');
}

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme;
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  const label = theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro';
  elements.themeToggle.title = label;
  elements.themeToggle.setAttribute('aria-label', label);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (error) {
    console.warn('Não foi possível alternar a tela cheia.', error);
  }
}

async function refreshConnectionStatus() {
  const status = await sendMessage({ type: 'GET_CONNECTION_STATUS' }).catch(() => null);
  if (!status?.ok) return;

  if (status.hasSpxTab && status.hasCsrfToken) {
    setConnectionState('connected', status.hasSapHeaders ? 'SPX conectado' : 'Sessão SPX encontrada');
  } else if (status.hasCsrfToken) {
    setConnectionState('warning', 'Sessão encontrada, abra o SPX');
  } else {
    setConnectionState('warning', 'Abra e autentique no SPX');
  }
}

async function loadDocks(manual = false) {
  if (state.loading) return;

  state.loading = true;
  state.countdown = REFRESH_INTERVAL_SECONDS;
  elements.refreshButton.disabled = true;
  elements.refreshButton.setAttribute('aria-label', 'Atualizando');
  elements.refreshButton.setAttribute('aria-busy', 'true');
  elements.refreshButton.title = 'Atualizando';

  try {
    const [result, validationResult] = await Promise.all([
      sendMessage({
        type: 'FETCH_DOCKS',
        payload: { dockActiveStatus: 1, pageno: 1, count: 100 }
      }),
      sendMessage({
        type: 'FETCH_VALIDATION_PROGRESS',
        payload: { pageNo: 1, count: 24, taskStatus: 2 }
      }).catch(error => ({ ok: false, error: error.message || String(error) }))
    ]);

    if (!result?.ok || result.data?.retcode !== 0 || !Array.isArray(result.data?.data?.dock_list)) {
      throw createFetchError(result);
    }

    if (state.demo) {
      resetLoadingHistory();
      state.validationProgress = createEmptyValidationProgress();
    }
    state.demo = false;
    applyValidationProgress(validationResult);
    state.docks = result.data.data.dock_list;
    state.fetchedAt = Date.now();
    state.dockQueues = {};
    pruneDockRouteMemory();
    state.driverRoutes = {};
    state.routesLoading = true;

    hideNotice();
    setConnectionState('connected', ['spx-tab', 'authenticated-tab'].includes(result.source) ? 'Conectado pela aba SPX' : 'Conectado pela sessão');
    elements.dataSource.textContent = ['spx-tab', 'authenticated-tab'].includes(result.source)
      ? 'Fonte: API SPX pela aba autenticada'
      : 'Fonte: API SPX pela sessão do navegador';

    updateLastUpdated();
    renderAll();
    await loadVacantDockQueues();
    renderAll();
    await loadDriverRoutes();
    syncLoadingHistory();
    renderAll();
  } catch (error) {
    showFetchError(error, manual);
    await refreshConnectionStatus();
  } finally {
    state.loading = false;
    elements.refreshButton.disabled = false;
    elements.refreshButton.setAttribute('aria-label', 'Atualizar');
    elements.refreshButton.removeAttribute('aria-busy');
    elements.refreshButton.title = 'Atualizar';
  }
}

function handleSecondTick() {
  if (!state.loading) {
    state.countdown -= 1;
    if (state.countdown <= 0) {
      state.countdown = REFRESH_INTERVAL_SECONDS;
      loadDocks();
    }
  }

  updateCountdown();

  if (state.docks.length) {
    updateLiveTimes();
    updateSummaryTimes();
  }
}

function renderAll() {
  renderSummary();
  renderDockGroups();
  updateCountdown();
}

function renderSummary() {
  const summary = calculateSummary();

  elements.totalDocks.textContent = summary.total;
  elements.occupiedDocks.textContent = summary.occupied;
  elements.nextDocks.textContent = summary.next;
  elements.availableDocks.textContent = summary.available;
  elements.validationRoutes.textContent = formatValidationRouteCount(state.validationProgress);
  elements.validationPercentage.textContent = formatValidationPercentage(state.validationProgress);
  const progressValue = state.validationProgress.available
    ? Math.max(0, Math.min(100, numberOrZero(state.validationProgress.percentage)))
    : 0;
  elements.validationProgressBar.style.width = `${progressValue}%`;
  elements.validationProgressTrack.setAttribute('aria-valuenow', String(Math.round(progressValue)));
  updateValidationCardTitles();
  elements.averageOccupation.textContent = formatDuration(summary.averageOccupation);
  elements.averageOccupationCard.title = summary.averageOccupationCount
    ? `Média de ${summary.averageOccupationCount} rota${summary.averageOccupationCount === 1 ? '' : 's'} acompanhada${summary.averageOccupationCount === 1 ? '' : 's'} desde a abertura, limitada às últimas quatro horas`
    : 'Nenhuma rota acompanhada na janela das últimas quatro horas';
}

function renderDockGroups() {
  if (!state.docks.length) {
    elements.dockGroups.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">↻</div>
        <strong>Nenhuma mesa disponível</strong>
        <p>Aguardando dados da operação.</p>
      </div>
    `;
    return;
  }

  const sorted = [...state.docks].sort((a, b) => naturalDockSort(a.dock_name, b.dock_name));
  elements.dockGroups.innerHTML = `<div class="dock-grid">${sorted.map(renderDockCard).join('')}</div>`;
  scheduleGridFit();
}

function scheduleGridFit() {
  window.cancelAnimationFrame(gridFitFrame);
  gridFitFrame = window.requestAnimationFrame(fitDockGrid);
}

function fitDockGrid() {
  const grid = elements.dockGroups.querySelector('.dock-grid');
  if (!grid) return;

  const dockCount = grid.children.length;
  const availableWidth = elements.dockGroups.clientWidth;
  const availableHeight = elements.dockGroups.clientHeight;

  if (!dockCount || availableWidth <= 0 || availableHeight <= 0) return;

  const layout = chooseGridLayout(dockCount, availableWidth, availableHeight);
  grid.style.setProperty('--dock-columns', layout.columns);
  grid.style.setProperty('--dock-rows', layout.rows);
  grid.style.setProperty('--grid-gap', `${layout.gap}px`);
  grid.classList.toggle('density-compact', layout.density === 'compact');
  grid.classList.toggle('density-ultra', layout.density === 'ultra');
}

function chooseGridLayout(count, width, height) {
  const targetRatio = 1.48;
  let best = null;

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const preliminaryGap = width < 900 || height < 650 ? 8 : 16;
    const preliminaryWidth = (width - preliminaryGap * (columns - 1)) / columns;
    const preliminaryHeight = (height - preliminaryGap * (rows - 1)) / rows;
    if (preliminaryWidth <= 0 || preliminaryHeight <= 0) continue;

    const density = preliminaryWidth < 180 || preliminaryHeight < 125
      ? 'ultra'
      : preliminaryWidth < 270 || preliminaryHeight < 175
        ? 'compact'
        : 'normal';
    const gap = density === 'ultra' ? 8 : density === 'compact' ? 12 : 16;
    const cardWidth = (width - gap * (columns - 1)) / columns;
    const cardHeight = (height - gap * (rows - 1)) / rows;
    if (cardWidth <= 0 || cardHeight <= 0) continue;

    const scale = Math.min(cardWidth / 300, cardHeight / 205);
    const ratio = cardWidth / cardHeight;
    const ratioPenalty = Math.abs(Math.log(ratio / targetRatio)) * 0.2;
    const emptyPenalty = ((columns * rows) - count) * 0.018;
    const narrowPenalty = cardWidth < 170 ? (170 - cardWidth) / 120 : 0;
    const shortPenalty = cardHeight < 115 ? (115 - cardHeight) / 80 : 0;
    const score = scale - ratioPenalty - emptyPenalty - narrowPenalty - shortPenalty;

    if (!best || score > best.score) {
      best = { columns, rows, cardWidth, cardHeight, gap, density, score };
    }
  }

  return best;
}

function renderDockCard(dock) {
  const occupied = isDockOccupied(dock);
  const nextDriver = occupied ? null : getNextDriver(dock);
  const displayStatus = getDisplayStatus(dock, nextDriver);
  const driverId = occupied ? numberOrZero(dock.occupied_driver_id) : numberOrZero(nextDriver?.driver_id);
  const rawDriverName = occupied
    ? dock.occupied_driver_name || 'Motorista não informado'
    : nextDriver?.driver_name || (displayStatus.key === 'available' ? 'Aguardando próximo motorista' : 'Nenhum motorista aguardando');
  const driverName = formatPersonName(rawDriverName);
  const route = getRouteDisplay(dock, driverId, nextDriver, displayStatus);
  const dockSeconds = getLiveSeconds(occupied ? numberOrZero(dock.occupation_time) : numberOrZero(dock.idle_time));
  const waitingSeconds = nextDriver
    ? getCurrentWaitingSeconds(numberOrZero(nextDriver.waiting_time), driverId)
    : 0;
  const id = numberOrZero(dock.dock_id);
  const loadingFinalized = route.kind === 'route-finished';
  const statusLabel = loadingFinalized ? 'Finalizado' : displayStatus.label;
  const statusClass = loadingFinalized ? 'finished' : displayStatus.key;
  const loadingOverLimit = occupied && !loadingFinalized && dockSeconds > LOADING_ALERT_THRESHOLD_SECONDS;
  const waitingOverLimit = Boolean(nextDriver) && waitingSeconds > WAITING_ALERT_THRESHOLD_SECONDS;
  const alertTitle = loadingFinalized
    ? 'Carregamento finalizado · aguardando saída do motorista'
    : loadingOverLimit
      ? 'Carregamento acima de 10 minutos'
      : waitingOverLimit
        ? 'Espera acima de 10 minutos'
        : displayStatus.label;

  return `
    <article class="dock-card ${displayStatus.key}${loadingFinalized ? ' loading-finished' : ''}${loadingOverLimit ? ' overdue' : ''}${waitingOverLimit ? ' waiting-overdue' : ''}" data-dock-id="${id}">
      <span class="dock-selection-checkbox" aria-hidden="true">
        <svg class="lucide-icon" viewBox="0 0 24 24">
          <path d="m5 12 4 4L19 6"></path>
        </svg>
      </span>
      <div class="dock-card-header">
        <div class="dock-name-block">
          <span>MESA / DOCA</span>
          <strong>${escapeHtml(dock.dock_name || 'Sem identificação')}</strong>
        </div>
        <span class="status-badge ${statusClass}" title="${escapeHtml(alertTitle)}">
          <span class="alert-icon" aria-hidden="true">!</span>
          <span>${escapeHtml(statusLabel)}</span>
        </span>
      </div>

      <div class="route-block ${route.placeholder ? 'placeholder' : ''} ${escapeHtml(route.kind)}">
        <div class="route-main">
          <span>ROTA</span>
          <strong title="${escapeHtml(route.value)}">${escapeHtml(route.value)}</strong>
          ${route.detail ? `<small>${escapeHtml(route.detail)}</small>` : ''}
        </div>
        ${renderAssignmentStats(route.assignmentTaskId)}
      </div>

      <div class="driver-block">
        <span>NOME DO MOTORISTA</span>
        <strong title="${escapeHtml(driverName)}">${escapeHtml(driverName)}</strong>
      </div>

      <div class="times-grid ${nextDriver ? 'two-columns' : ''}">
        ${nextDriver ? `
          <div class="time-item emphasized waiting-time">
            <span>Tempo ocioso · total</span>
            <strong class="live-duration" data-timer-kind="waiting" data-driver-id="${driverId}" data-base-seconds="${numberOrZero(nextDriver.waiting_time)}">${formatDuration(waitingSeconds)}</strong>
          </div>
        ` : ''}
        <div class="time-item ${occupied ? 'loading-time' : 'idle-time'}">
          <span>${loadingFinalized ? 'Tempo na vaga' : occupied ? 'Tempo em carregamento' : 'Tempo ocioso · atual'}</span>
          <strong class="live-duration" data-timer-kind="${occupied ? 'occupation' : 'idle'}" data-base-seconds="${occupied ? numberOrZero(dock.occupation_time) : numberOrZero(dock.idle_time)}">${formatDuration(dockSeconds)}</strong>
        </div>
      </div>
    </article>
  `;
}

function getRouteDisplay(dock, driverId, nextDriver, displayStatus) {
  if (displayStatus.key === 'available') {
    return {
      value: 'MESA LIVRE',
      detail: 'Disponível para carregamento',
      placeholder: true,
      assignmentTaskId: '',
      kind: 'available-state'
    };
  }

  const routeState = driverId ? state.driverRoutes[driverId] : null;
  const rememberedRoute = getRememberedDockRoute(dock);
  const fallbackRoute = String(nextDriver?.corridor_cage || '').trim();
  const route = String(routeState?.route || fallbackRoute || '').trim();
  const assignmentTaskId = String(routeState?.assignmentTaskId || '').trim();
  const finalizedWhileOccupied = displayStatus.key === 'occupied'
    && routeState?.ok === true
    && routeState?.found === false
    && Boolean(rememberedRoute?.route);

  if (route) return { value: route, detail: '', placeholder: false, assignmentTaskId, kind: 'route-ready' };
  if (driverId && state.routesLoading) {
    return {
      value: 'BUSCANDO ROTA',
      detail: 'Consultando a AT do motorista',
      placeholder: true,
      assignmentTaskId: '',
      kind: 'route-searching'
    };
  }

  if (finalizedWhileOccupied) {
    return {
      value: 'CARREGAMENTO FINALIZADO',
      detail: `Rota ${rememberedRoute.route} concluída · aguardando saída do motorista`,
      placeholder: true,
      assignmentTaskId: rememberedRoute.assignmentTaskId || '',
      kind: 'route-finished'
    };
  }

  return {
    value: 'ROTA NÃO IDENTIFICADA',
    detail: 'Motorista sem rota vinculada no retorno atual',
    placeholder: true,
    assignmentTaskId,
    kind: 'route-missing'
  };
}

function getDockOccupantIdentity(dock) {
  const driverId = numberOrZero(dock?.occupied_driver_id);
  const vehicle = String(dock?.occupied_vehicle_number || '').trim().toUpperCase();
  if (driverId > 0) return `driver:${driverId}`;
  return vehicle ? `vehicle:${vehicle}` : '';
}

function getRememberedDockRoute(dock) {
  const dockId = numberOrZero(dock?.dock_id);
  const identity = getDockOccupantIdentity(dock);
  const remembered = state.dockRouteMemory[dockId];
  return remembered && identity && remembered.identity === identity ? remembered : null;
}

function pruneDockRouteMemory() {
  const currentDocks = new Map(state.docks.map(dock => [numberOrZero(dock.dock_id), dock]));

  for (const [dockId, remembered] of Object.entries(state.dockRouteMemory)) {
    const dock = currentDocks.get(numberOrZero(dockId));
    const identity = dock && isDockOccupied(dock) ? getDockOccupantIdentity(dock) : '';
    if (!dock || !identity || identity !== remembered.identity) delete state.dockRouteMemory[dockId];
  }
}

function syncDockRouteMemory() {
  pruneDockRouteMemory();

  for (const dock of state.docks.filter(isDockOccupied)) {
    const dockId = numberOrZero(dock.dock_id);
    const driverId = numberOrZero(dock.occupied_driver_id);
    const identity = getDockOccupantIdentity(dock);
    const routeState = driverId ? state.driverRoutes[driverId] : null;
    const route = String(routeState?.route || '').trim();

    if (!dockId || !identity || routeState?.ok !== true || routeState?.found !== true || !route) continue;

    state.dockRouteMemory[dockId] = {
      identity,
      driverId,
      route,
      assignmentTaskId: normalizeAssignmentTaskId(routeState.assignmentTaskId),
      lastSeenAt: Date.now()
    };
  }
}

function renderAssignmentStats(assignmentTaskId) {
  if (!assignmentTaskId) return '';

  const item = state.assignmentStats[assignmentTaskId];
  const status = item?.status || 'loading';
  const totalOrders = status === 'ready' ? formatInteger(item.totalOrders) : status === 'error' ? '—' : '…';
  const bulkyOrders = status === 'ready' ? formatInteger(item.bulkyOrders) : status === 'error' ? '—' : '…';
  const title = status === 'error'
    ? item.error || 'Quantidades indisponíveis'
    : `${assignmentTaskId}${item?.cached ? ' · cache' : ''}`;

  return `
    <div class="assignment-stats ${status}" data-assignment-task-id="${escapeHtml(assignmentTaskId)}" title="${escapeHtml(title)}">
      <div class="assignment-stat">
        <span>PEDIDOS</span>
        <b>${totalOrders}</b>
      </div>
      <div class="assignment-stat bulky${status === 'ready' && numberOrZero(item.bulkyOrders) > 0 ? ' has-value' : ''}">
        <span>VOLUMOSOS</span>
        <b>${bulkyOrders}</b>
      </div>
    </div>
  `;
}

function loadVisibleAssignmentStats() {
  const routeItems = [...Object.values(state.driverRoutes), ...Object.values(state.dockRouteMemory)];
  const assignmentTaskIds = [...new Set(routeItems
    .map(item => normalizeAssignmentTaskId(item?.assignmentTaskId))
    .filter(Boolean))];

  const routesWithoutAssignment = routeItems.filter(item => item?.found && item?.route && !normalizeAssignmentTaskId(item?.assignmentTaskId));
  if (routesWithoutAssignment.length) {
    console.warn('[SPX Dock Flow] Rota encontrada sem código de AT na resposta do search/v2.', routesWithoutAssignment);
  }

  for (const assignmentTaskId of assignmentTaskIds) {
    const current = state.assignmentStats[assignmentTaskId];
    const isFresh = current?.status === 'ready' && numberOrZero(current.expiresAt) > Date.now();

    const retryBlocked = current?.status === 'error' && numberOrZero(current.retryAt) > Date.now();

    if (current?.status === 'loading' || isFresh || retryBlocked) continue;

    state.assignmentStats[assignmentTaskId] = {
      status: 'loading',
      assignmentTaskId
    };
    updateAssignmentStatsInCards(assignmentTaskId);
    fetchAssignmentStats(assignmentTaskId);
  }
}

async function fetchAssignmentStats(assignmentTaskId) {
  try {
    const result = await sendMessage({
      type: 'FETCH_ASSIGNMENT_STATS',
      payload: { assignmentTaskId }
    });

    if (!result?.ok || !result.stats) {
      throw new Error(result?.error || 'Quantidades indisponíveis');
    }

    state.assignmentStats[assignmentTaskId] = {
      status: 'ready',
      cached: Boolean(result.cached),
      ...result.stats
    };
  } catch (error) {
    state.assignmentStats[assignmentTaskId] = {
      status: 'error',
      assignmentTaskId,
      error: error?.message || String(error || 'Quantidades indisponíveis'),
      retryAt: Date.now() + ASSIGNMENT_STATS_RETRY_DELAY_MS
    };
  }

  updateAssignmentStatsInCards(assignmentTaskId);
}

function updateAssignmentStatsInCards(assignmentTaskId) {
  document.querySelectorAll('.assignment-stats').forEach(element => {
    if (element.dataset.assignmentTaskId !== assignmentTaskId) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderAssignmentStats(assignmentTaskId).trim();
    const replacement = wrapper.firstElementChild;
    if (replacement) element.replaceWith(replacement);
  });
}

function normalizeAssignmentTaskId(value) {
  const assignmentTaskId = String(value || '').trim();
  return /^AT[A-Z0-9]+$/i.test(assignmentTaskId) ? assignmentTaskId : '';
}

function formatInteger(value) {
  return Math.max(0, Math.trunc(numberOrZero(value))).toLocaleString('pt-BR');
}

function getDisplayStatus(dock, nextDriver = getNextDriver(dock)) {
  if (numberOrZero(dock.dock_active_status) !== 1) return { key: 'inactive', label: 'Inativa' };
  if (isDockOccupied(dock)) return { key: 'occupied', label: 'Em carregamento' };
  if (nextDriver) return { key: 'next', label: 'Próximo para carregar' };
  if (state.queueLoading && !getDockQueueState(dock)) return { key: 'loading', label: 'Consultando' };
  if (Number(dock.dock_status) === 2) return { key: 'available', label: 'Disponível' };
  return { key: 'unknown', label: 'Indisponível' };
}

function getFilteredDocks() {
  return state.docks;
}

async function loadVacantDockQueues() {
  const dockIds = state.docks
    .filter(dock => numberOrZero(dock.dock_active_status) === 1 && !isDockOccupied(dock))
    .map(dock => Number(dock.dock_id))
    .filter(dockId => Number.isInteger(dockId) && dockId > 0);

  if (!dockIds.length) {
    state.dockQueues = {};
    state.queueLoading = false;
    return;
  }

  state.queueLoading = true;
  renderDockGroups();

  try {
    const result = await sendMessage({
      type: 'FETCH_DOCK_QUEUES',
      payload: { dockIds }
    });

    const nextQueues = {};

    for (const dockId of dockIds) {
      const item = result?.queues?.[dockId];
      const list = item?.data?.data?.queue_sequence_list;

      if (item?.ok && Array.isArray(list)) {
        nextQueues[dockId] = {
          items: list,
          total: numberOrZero(item.data?.data?.total ?? list.length),
          error: null
        };
      } else {
        nextQueues[dockId] = {
          items: [],
          total: 0,
          error: item?.error || result?.error || 'Fila indisponível'
        };
      }
    }

    state.dockQueues = nextQueues;
  } catch (error) {
    state.dockQueues = Object.fromEntries(dockIds.map(dockId => [dockId, {
      items: [],
      total: 0,
      error: error.message || String(error)
    }]));
  } finally {
    state.queueLoading = false;
  }
}

async function loadDriverRoutes() {
  const driverIds = [...new Set(state.docks.map(dock => {
    if (isDockOccupied(dock)) return numberOrZero(dock.occupied_driver_id);
    return numberOrZero(getNextDriver(dock)?.driver_id);
  }).filter(driverId => driverId > 0))];

  if (!driverIds.length) {
    state.driverRoutes = {};
    state.routesLoading = false;
    return;
  }

  state.routesLoading = true;
  renderDockGroups();

  try {
    const result = await sendMessage({
      type: 'FETCH_DRIVER_ROUTES',
      payload: { driverIds, stationId: STATION_ID }
    });

    const routes = {};

    for (const driverId of driverIds) {
      const item = result?.routes?.[driverId];
      routes[driverId] = item || {
        ok: false,
        route: '',
        error: result?.error || 'Rota indisponível'
      };
    }

    state.driverRoutes = routes;
    syncDockRouteMemory();
  } catch (error) {
    state.driverRoutes = Object.fromEntries(driverIds.map(driverId => [driverId, {
      ok: false,
      route: '',
      error: error.message || String(error)
    }]));
  } finally {
    state.routesLoading = false;
    window.setTimeout(loadVisibleAssignmentStats, 0);
  }
}

function getDockQueueState(dock) {
  return state.dockQueues[Number(dock.dock_id)] || null;
}

function getNextDriver(dock) {
  const dockId = Number(dock.dock_id);
  const items = getDockQueueState(dock)?.items;
  if (!Array.isArray(items) || !items.length) return null;

  return [...items]
    .filter(item => {
      if (numberOrZero(item.is_blocked_by_dual_cage) === 1) return false;
      const frozenDockId = numberOrZero(item.frozen_dock_id);
      const frozenElsewhere = numberOrZero(item.is_frozen) === 1 && frozenDockId > 0 && frozenDockId !== dockId;
      return !frozenElsewhere;
    })
    .sort((a, b) => {
      const aFrozenHere = numberOrZero(a.is_frozen) === 1 && numberOrZero(a.frozen_dock_id) === dockId ? 0 : 1;
      const bFrozenHere = numberOrZero(b.is_frozen) === 1 && numberOrZero(b.frozen_dock_id) === dockId ? 0 : 1;
      if (aFrozenHere !== bFrozenHere) return aFrozenHere - bFrozenHere;

      const sequenceDifference = normalizeSequence(a.queue_sequence) - normalizeSequence(b.queue_sequence);
      if (sequenceDifference !== 0) return sequenceDifference;

      const priorityDifference = numberOrZero(a.is_prioritized) - numberOrZero(b.is_prioritized);
      if (priorityDifference !== 0) return priorityDifference;

      return numberOrZero(b.waiting_time) - numberOrZero(a.waiting_time);
    })[0] || null;
}

function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : Number.MAX_SAFE_INTEGER;
}

function isDockOccupied(dock) {
  return Boolean(String(dock.occupied_vehicle_number || '').trim()) || Number(dock.dock_status) === 1;
}

function calculateSummary() {
  const statuses = state.docks.map(dock => getDisplayStatus(dock).key);
  const loadingAverage = calculateLoadingHistoryAverage();

  return {
    total: state.docks.length,
    occupied: statuses.filter(status => status === 'occupied').length,
    next: statuses.filter(status => status === 'next').length,
    available: statuses.filter(status => status === 'available').length,
    averageOccupation: loadingAverage.seconds,
    averageOccupationCount: loadingAverage.count
  };
}

function syncLoadingHistory() {
  const now = state.fetchedAt || Date.now();
  const nextActive = {};

  for (const dock of state.docks.filter(isDockOccupied)) {
    const snapshot = createLoadingSnapshot(dock, now);
    if (!snapshot || snapshot.durationSeconds > LOADING_HISTORY_WINDOW_SECONDS) continue;

    const matchingActive = Object.values(state.loadingHistory.active).find(item => (
      item.assignmentTaskId === snapshot.assignmentTaskId
      && item.driverId === snapshot.driverId
      && item.dockId === snapshot.dockId
      && item.route === snapshot.route
      && Math.abs(item.startedAt - snapshot.startedAt) < 10 * 60 * 1000
    ));

    if (matchingActive) snapshot.key = matchingActive.key;

    nextActive[snapshot.key] = {
      ...(state.loadingHistory.active[snapshot.key] || {}),
      ...snapshot,
      lastSeenAt: now
    };
  }

  for (const [key, previous] of Object.entries(state.loadingHistory.active)) {
    if (nextActive[key]) continue;

    const finalDuration = Math.max(
      previous.durationSeconds,
      previous.durationSeconds + Math.floor((now - previous.lastSeenAt) / 1000)
    );

    if (finalDuration <= LOADING_HISTORY_WINDOW_SECONDS) {
      state.loadingHistory.completed.push({
        ...previous,
        durationSeconds: finalDuration,
        completedAt: now
      });
    }
  }

  state.loadingHistory.active = nextActive;
  pruneLoadingHistory(now);
}

function createLoadingSnapshot(dock, now) {
  const durationSeconds = Math.max(0, numberOrZero(dock.occupation_time));
  const driverId = numberOrZero(dock.occupied_driver_id);
  const dockId = numberOrZero(dock.dock_id);
  const routeState = driverId ? state.driverRoutes[driverId] : null;
  const rememberedRoute = getRememberedDockRoute(dock);
  const assignmentTaskId = normalizeAssignmentTaskId(routeState?.assignmentTaskId || rememberedRoute?.assignmentTaskId);
  const route = String(routeState?.route || rememberedRoute?.route || '').trim();
  const startedAt = now - durationSeconds * 1000;
  const startBucket = Math.floor(startedAt / (5 * 60 * 1000));
  const fallbackIdentity = `${route || 'sem-rota'}:${driverId || 'sem-motorista'}:${dockId}:${startBucket}`;

  return {
    key: assignmentTaskId ? `at:${assignmentTaskId}` : `load:${fallbackIdentity}`,
    assignmentTaskId,
    route,
    driverId,
    dockId,
    startedAt,
    durationSeconds,
    observedAt: now
  };
}

function calculateLoadingHistoryAverage() {
  const now = Date.now();
  pruneLoadingHistory(now);

  const completedDurations = state.loadingHistory.completed.map(item => item.durationSeconds);
  const activeDurations = Object.values(state.loadingHistory.active)
    .map(item => Math.max(item.durationSeconds, Math.floor((now - item.startedAt) / 1000)))
    .filter(duration => duration <= LOADING_HISTORY_WINDOW_SECONDS);
  const durations = [...completedDurations, ...activeDurations];

  return {
    count: durations.length,
    seconds: durations.length
      ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : 0
  };
}

function pruneLoadingHistory(now = Date.now()) {
  const cutoff = now - LOADING_HISTORY_WINDOW_SECONDS * 1000;

  state.loadingHistory.completed = state.loadingHistory.completed.filter(item => (
    item.completedAt >= state.openedAt
    && item.completedAt >= cutoff
    && item.durationSeconds <= LOADING_HISTORY_WINDOW_SECONDS
  ));

  state.loadingHistory.active = Object.fromEntries(Object.entries(state.loadingHistory.active).filter(([, item]) => (
    Math.max(item.durationSeconds, Math.floor((now - item.startedAt) / 1000)) <= LOADING_HISTORY_WINDOW_SECONDS
  )));
}

function updateLiveTimes() {
  document.querySelectorAll('.live-duration').forEach(element => {
    const timerKind = element.dataset.timerKind;
    const seconds = timerKind === 'waiting'
      ? getCurrentWaitingSeconds(numberOrZero(element.dataset.baseSeconds), numberOrZero(element.dataset.driverId))
      : getLiveSeconds(numberOrZero(element.dataset.baseSeconds));
    element.textContent = formatDuration(seconds);

    const card = element.closest('.dock-card');

    if (timerKind === 'occupation') {
      const isOverLimit = !card?.classList.contains('loading-finished') && seconds > LOADING_ALERT_THRESHOLD_SECONDS;
      card?.classList.toggle('overdue', isOverLimit);
    }

    if (timerKind === 'waiting') {
      const isOverLimit = seconds > WAITING_ALERT_THRESHOLD_SECONDS;
      card?.classList.toggle('waiting-overdue', isOverLimit);
    }

    if (card && (timerKind === 'occupation' || timerKind === 'waiting')) {
      const statusBadge = card.querySelector('.status-badge');
      if (statusBadge) {
        statusBadge.title = card.classList.contains('overdue')
          ? 'Carregamento acima de 10 minutos'
          : card.classList.contains('waiting-overdue')
            ? 'Espera acima de 10 minutos'
            : statusBadge.querySelector(':scope > span:last-child')?.textContent || '';
      }
    }
  });
}
function updateSummaryTimes() {
  renderSummary();
}

function updateCountdown() {
  elements.countdownValue.textContent = Math.max(0, state.countdown);
  const progress = Math.max(0, Math.min(100, (state.countdown / REFRESH_INTERVAL_SECONDS) * 100));
  elements.countdownRing.style.setProperty('--progress', `${progress}%`);
}

function updateLastUpdated() {
  elements.lastUpdated.textContent = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(state.fetchedAt));
}

function showFetchError(error, manual) {
  elements.notice.classList.remove('hidden');
  elements.noticeTitle.textContent = 'Não foi possível consultar as mesas';
  elements.noticeMessage.textContent = error.message || 'Abra o SPX, confirme que a sessão está autenticada e recarregue uma página do portal.';
  elements.noticeDetails.textContent = error.details || (manual ? 'A atualização manual também falhou.' : 'A dashboard tentará novamente automaticamente.');
  elements.dataSource.textContent = 'Fonte: conexão indisponível';
}

function hideNotice() {
  elements.notice.classList.add('hidden');
  elements.noticeMessage.textContent = '';
  elements.noticeDetails.textContent = '';
}

function setConnectionState(type, text) {
  elements.connectionPill.classList.remove('connected', 'warning');
  if (type) elements.connectionPill.classList.add(type);
  elements.connectionText.textContent = text;
}

function resetLoadingHistory() {
  state.openedAt = Date.now();
  state.dockRouteMemory = {};
  state.loadingHistory = {
    active: {},
    completed: []
  };
}

function loadDemoData() {
  resetLoadingHistory();
  state.demo = true;
  state.docks = createDemoDocks();
  state.dockQueues = createDemoQueues();
  state.driverRoutes = createDemoRoutes();
  state.validationProgress = {
    available: true,
    stale: false,
    taskId: 'VT202607200H5HB',
    startedAt: Date.now() - 4 * 60 * 1000,
    loaded: 6,
    total: 22,
    percentage: 27.3,
    fetchedAt: Date.now(),
    error: ''
  };
  state.queueLoading = false;
  state.routesLoading = false;
  state.fetchedAt = Date.now();
  state.countdown = REFRESH_INTERVAL_SECONDS;

  hideNotice();
  setConnectionState('warning', 'Modo demonstração');
  elements.dataSource.textContent = 'Fonte: dados locais de demonstração';
  updateLastUpdated();
  syncLoadingHistory();
  renderAll();
}

function createDemoDocks() {
  const names = ['MESA 1', 'MESA 2', 'MESA 3', 'MESA 4', 'MESA 5', 'MESA 6', 'MESA 7', 'MESA 8', 'MESA 9'];
  const vehicles = [
    ['RYU2C33', 'CARLOS EDUARDO MORENO SIFONTES', 436, 2500000],
    null,
    ['IQN2C12', 'MARISTELA FAVERO', 86, 2500002],
    null,
    null,
    ['IYX4D31', 'JOSE MIGUEL CORTEZ VARGAS', 376, 2572011],
    ['QHA3B58', 'CAYO GABRIEL DE BEM ALMEIDA', 463, 986414],
    null,
    null
  ];

  return names.map((dockName, index) => {
    const vehicle = vehicles[index];
    return {
      dock_id: 1936 + index,
      dock_name: dockName,
      dock_status: vehicle ? 1 : 2,
      occupied_vehicle_number: vehicle?.[0] || '',
      occupation_time: vehicle?.[2] || 0,
      dock_active_status: 1,
      idle_time: vehicle ? 0 : [0, 691, 0, 211, 751, 0, 0, 691, 151][index],
      occupied_driver_id: vehicle?.[3] || 0,
      occupied_driver_name: vehicle?.[1] || ''
    };
  });
}

function createDemoQueues() {
  return {
    1940: {
      total: 2,
      error: null,
      items: [
        {
          queue_sequence: 1,
          waiting_time: 1055,
          driver_id: 986414,
          driver_name: 'CAYO GABRIEL DE BEM ALMEIDA',
          is_frozen: 1,
          frozen_dock_id: 1937,
          is_prioritized: 2,
          is_blocked_by_dual_cage: 0
        },
        {
          queue_sequence: 3,
          waiting_time: 164,
          driver_id: 2572011,
          driver_name: 'JOSE MIGUEL CORTEZ VARGAS',
          is_frozen: 2,
          frozen_dock_id: 0,
          is_prioritized: 1,
          corridor_cage: 'C-32',
          is_blocked_by_dual_cage: 0
        }
      ]
    }
  };
}

function createDemoRoutes() {
  return {
    2500000: { ok: true, route: 'A-01', driverAssignedTime: 1782138000 },
    2500002: { ok: true, route: 'B-14', driverAssignedTime: 1782138100 },
    2572011: { ok: true, route: 'C-32', driverAssignedTime: 1782138980 },
    986414: { ok: true, route: 'D-07', driverAssignedTime: 1782138200 }
  };
}

function createEmptyValidationProgress() {
  return {
    available: false,
    stale: false,
    taskId: '',
    startedAt: 0,
    loaded: 0,
    total: 0,
    percentage: 0,
    fetchedAt: 0,
    error: ''
  };
}

function applyValidationProgress(result) {
  if (!result?.ok || result.data?.retcode !== 0) {
    state.validationProgress = {
      ...state.validationProgress,
      stale: state.validationProgress.available,
      error: result?.error || result?.data?.message || 'Progresso indisponível'
    };
    return;
  }

  const list = Array.isArray(result.data?.data?.list) ? result.data.data.list : [];
  const task = [...list].sort((a, b) => numberOrZero(b?.create_time) - numberOrZero(a?.create_time))[0];

  if (!task) {
    state.validationProgress = {
      available: true,
      stale: false,
      taskId: '',
      startedAt: 0,
      loaded: 0,
      total: 0,
      percentage: 0,
      fetchedAt: Date.now(),
      error: ''
    };
    return;
  }

  const loaded = Math.max(0, Math.trunc(numberOrZero(task.validated_target_qty)));
  const total = Math.max(0, Math.trunc(numberOrZero(task.total_target_qty)));
  const percentageFromApi = parsePercentage(task.validated_target_qty_ratio);
  const percentage = Number.isFinite(percentageFromApi)
    ? percentageFromApi
    : total > 0
      ? loaded / total * 100
      : 0;
  const taskId = String(task.validation_task_id || '').trim();
  const reportedStartedAt = [task.start_time, task.task_start_time, task.started_at, task.create_time]
    .map(normalizeTimestampMilliseconds)
    .find(Boolean) || 0;
  const previousStartedAt = state.validationProgress.taskId === taskId
    ? numberOrZero(state.validationProgress.startedAt)
    : 0;

  state.validationProgress = {
    available: true,
    stale: false,
    taskId,
    startedAt: reportedStartedAt || previousStartedAt || Date.now(),
    loaded,
    total,
    percentage,
    fetchedAt: Date.now(),
    error: ''
  };
}

function formatValidationRouteCount(progress) {
  if (!progress.available) return '— / —';
  return `${formatInteger(progress.loaded)} / ${formatInteger(progress.total)}`;
}

function formatValidationPercentage(progress) {
  if (!progress.available) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(progress.percentage)}%`;
}

function updateValidationCardTitles() {
  const progress = state.validationProgress;

  if (!progress.available) {
    const message = progress.error || 'Aguardando a VT ativa';
    elements.validationRoutesCard.title = message;
    elements.validationPercentageCard.title = message;
    return;
  }

  const taskLabel = progress.taskId || 'Nenhuma VT ativa';
  const staleLabel = progress.stale ? ' · último valor disponível' : '';
  elements.validationRoutesCard.title = `${taskLabel} · ${formatInteger(progress.loaded)} de ${formatInteger(progress.total)} rotas carregadas${staleLabel}`;
  elements.validationPercentageCard.title = `${taskLabel} · ${formatValidationPercentage(progress)} de carregamento${staleLabel}`;
}

function parsePercentage(value) {
  const normalized = String(value ?? '')
    .replace('%', '')
    .trim()
    .replace(',', '.');
  const percentage = Number(normalized);
  return Number.isFinite(percentage) ? percentage : Number.NaN;
}

function createFetchError(result) {
  const error = new Error(result?.error || result?.data?.message || 'Resposta inválida recebida do SPX.');
  const details = result?.details;

  if (details) {
    const items = [
      details.hasSpxTab ? 'aba SPX detectada' : 'nenhuma aba SPX detectada',
      details.hasCsrfToken ? 'CSRF encontrado' : 'CSRF não encontrado',
      details.hasSapHeaders ? 'assinatura SAP capturada' : 'assinatura SAP ainda não capturada'
    ];
    error.details = items.join(' · ');
  }

  return error;
}

function sendMessage(message) {
  if (!window.SpxModuleService?.sendMessage) {
    return Promise.reject(new Error('Serviço do módulo não carregado.'));
  }
  return window.SpxModuleService.sendMessage(message);
}

function getLiveSeconds(baseSeconds) {
  if (!state.fetchedAt) return baseSeconds;
  return Math.max(0, baseSeconds + Math.floor((Date.now() - state.fetchedAt) / 1000));
}

function getCurrentWaitingSeconds(baseSeconds, driverId = 0, now = Date.now()) {
  const rawSeconds = getLiveSeconds(baseSeconds);
  const routeStartedAt = normalizeTimestampMilliseconds(state.driverRoutes[numberOrZero(driverId)]?.driverAssignedTime);
  const expeditionStartedAt = state.validationProgress.taskId
    ? normalizeTimestampMilliseconds(state.validationProgress.startedAt)
    : 0;
  const fallbackStartedAt = expeditionStartedAt ? 0 : numberOrZero(state.openedAt);
  const currentCycleStartedAt = Math.max(routeStartedAt, expeditionStartedAt, fallbackStartedAt);

  if (!currentCycleStartedAt || currentCycleStartedAt > now) return rawSeconds;

  const currentCycleSeconds = Math.max(0, Math.floor((now - currentCycleStartedAt) / 1000));
  return Math.min(rawSeconds, currentCycleSeconds);
}

function normalizeTimestampMilliseconds(value) {
  let timestamp = Number(value);

  if (!Number.isFinite(timestamp)) {
    timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  }

  if (timestamp <= 0) return 0;
  if (timestamp > 100000000000000) timestamp /= 1000;
  if (timestamp < 100000000000) timestamp *= 1000;
  return Math.round(timestamp);
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(numberOrZero(totalSeconds)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function naturalDockSort(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatPersonName(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  return text
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|[\s'-])([\p{L}])/gu, (_, separator, letter) => `${separator}${letter.toLocaleUpperCase('pt-BR')}`);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
