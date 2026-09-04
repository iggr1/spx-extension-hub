(() => {
  const SETTINGS_STORAGE_KEY = 'spxDockFlowSettingsV1';
  const MAX_DOCKS_PER_PAGE = 15;
  const DOCK_PAGE_INTERVAL_SECONDS = 10;
  const PAGE_EXIT_DURATION_MS = 260;
  const PAGE_ENTER_DURATION_MS = 340;
  const DEFAULT_SETTINGS = Object.freeze({
    autoRefreshEnabled: true,
    refreshIntervalSeconds: 10,
    loadingAlertMinutes: 10,
    waitingAlertMinutes: 10,
    historyWindowHours: 2.5,
    zoomPercent: 100
  });

  let settings = loadSettings();
  let installed = false;
  let originalLoadDocks = null;
  let dockPageIndex = 0;
  let dockPageElapsedSeconds = 0;
  let dockPageTimer = null;
  let pageTransitioning = false;

  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = function patchedSetInterval(callback, delay, ...args) {
    if (typeof callback === 'function' && callback.name === 'handleSecondTick' && Number(delay) === 1000) {
      return nativeSetInterval(() => {
        const configuredTick = window.__spxDockFlowConfiguredTick;
        if (typeof configuredTick === 'function') configuredTick();
        else callback(...args);
      }, delay);
    }

    return nativeSetInterval(callback, delay, ...args);
  };

  applyZoom();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSettings, { once: true });
  } else {
    initializeSettings();
  }

  function initializeSettings() {
    if (installed) return;
    installed = true;

    bindSettingsUi();
    installDashboardOverrides();
    startDockPagination();
    applySettingsToDashboard(false);
  }

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
      return sanitizeSettings({ ...DEFAULT_SETTINGS, ...parsed });
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }

  function sanitizeSettings(value) {
    return {
      autoRefreshEnabled: value.autoRefreshEnabled !== false,
      refreshIntervalSeconds: clampNumber(value.refreshIntervalSeconds, 10, 120, DEFAULT_SETTINGS.refreshIntervalSeconds),
      loadingAlertMinutes: clampNumber(value.loadingAlertMinutes, 0, 120, DEFAULT_SETTINGS.loadingAlertMinutes),
      waitingAlertMinutes: clampNumber(value.waitingAlertMinutes, 0, 120, DEFAULT_SETTINGS.waitingAlertMinutes),
      historyWindowHours: clampNumber(value.historyWindowHours, 1, 24, DEFAULT_SETTINGS.historyWindowHours),
      zoomPercent: roundZoom(value.zoomPercent)
    };
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function roundZoom(value) {
    const number = clampNumber(value, 70, 130, DEFAULT_SETTINGS.zoomPercent);
    return Math.round(number / 5) * 5;
  }

  function bindSettingsUi() {
    const settingsButton = document.getElementById('settingsButton');
    const modal = document.getElementById('settingsModal');
    const closeButton = document.getElementById('settingsCloseButton');
    const cancelButton = document.getElementById('settingsCancelButton');
    const saveButton = document.getElementById('settingsSaveButton');
    const resetButton = document.getElementById('settingsResetButton');
    const zoomOutButton = document.getElementById('zoomOutButton');
    const zoomInButton = document.getElementById('zoomInButton');
    const zoomRange = document.getElementById('settingZoomPercent');
    const autoRefresh = document.getElementById('settingAutoRefresh');
    const refreshInterval = document.getElementById('settingRefreshInterval');
    const historyWindow = document.getElementById('settingHistoryWindow');

    if (refreshInterval) {
      refreshInterval.min = '10';
      const help = refreshInterval.closest('.settings-field')?.querySelector('small');
      if (help) help.textContent = 'Em segundos. Mínimo e padrão: 10.';
    }

    if (historyWindow) {
      historyWindow.min = '1';
      historyWindow.step = '0.5';
      const help = historyWindow.closest('.settings-field')?.querySelector('small');
      if (help) help.textContent = 'Em horas. Padrão: 2,5. Define a janela usada no card de tempo médio e nos tempos ociosos.';
    }

    settingsButton?.addEventListener('click', openSettingsModal);
    closeButton?.addEventListener('click', closeSettingsModal);
    cancelButton?.addEventListener('click', closeSettingsModal);
    saveButton?.addEventListener('click', saveSettingsFromForm);
    resetButton?.addEventListener('click', resetSettings);
    zoomOutButton?.addEventListener('click', () => changeZoom(-5));
    zoomInButton?.addEventListener('click', () => changeZoom(5));

    zoomRange?.addEventListener('input', () => {
      document.getElementById('settingZoomValue').textContent = `${roundZoom(zoomRange.value)}%`;
    });

    autoRefresh?.addEventListener('change', updateRefreshFieldState);

    modal?.addEventListener('click', event => {
      if (event.target === modal) closeSettingsModal();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modal?.classList.contains('is-open')) closeSettingsModal();
    });

    syncHeaderZoom();
  }

  function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    fillSettingsForm();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('settingAutoRefresh')?.focus();
  }

  function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function fillSettingsForm() {
    setInputValue('settingAutoRefresh', settings.autoRefreshEnabled);
    setInputValue('settingRefreshInterval', settings.refreshIntervalSeconds);
    setInputValue('settingLoadingAlert', settings.loadingAlertMinutes);
    setInputValue('settingWaitingAlert', settings.waitingAlertMinutes);
    setInputValue('settingHistoryWindow', settings.historyWindowHours);
    setInputValue('settingZoomPercent', settings.zoomPercent);

    const zoomValue = document.getElementById('settingZoomValue');
    if (zoomValue) zoomValue.textContent = `${settings.zoomPercent}%`;

    updateRefreshFieldState();
  }

  function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = String(value);
  }

  function saveSettingsFromForm() {
    settings = sanitizeSettings({
      autoRefreshEnabled: document.getElementById('settingAutoRefresh')?.checked,
      refreshIntervalSeconds: document.getElementById('settingRefreshInterval')?.value,
      loadingAlertMinutes: document.getElementById('settingLoadingAlert')?.value,
      waitingAlertMinutes: document.getElementById('settingWaitingAlert')?.value,
      historyWindowHours: document.getElementById('settingHistoryWindow')?.value,
      zoomPercent: document.getElementById('settingZoomPercent')?.value
    });

    saveSettings();
    applySettingsToDashboard(true);
    closeSettingsModal();
  }

  function resetSettings() {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    fillSettingsForm();
    applySettingsToDashboard(true);
  }

  function updateRefreshFieldState() {
    const enabled = document.getElementById('settingAutoRefresh')?.checked !== false;
    const field = document.getElementById('refreshIntervalField');
    const input = document.getElementById('settingRefreshInterval');
    field?.classList.toggle('is-disabled', !enabled);
    if (input) input.disabled = !enabled;
  }

  function changeZoom(delta) {
    settings.zoomPercent = roundZoom(settings.zoomPercent + delta);
    saveSettings();
    applyZoom();
    syncHeaderZoom();
    scheduleDashboardFit();
  }

  function applyZoom() {
    document.documentElement.style.setProperty('--dashboard-zoom', String(settings.zoomPercent / 100));
  }

  function syncHeaderZoom() {
    const output = document.getElementById('zoomHeaderValue');
    const outButton = document.getElementById('zoomOutButton');
    const inButton = document.getElementById('zoomInButton');

    if (output) output.textContent = `${settings.zoomPercent}%`;
    if (outButton) outButton.disabled = settings.zoomPercent <= 70;
    if (inButton) inButton.disabled = settings.zoomPercent >= 130;
  }

  function applySettingsToDashboard(rerender) {
    applyZoom();
    syncHeaderZoom();

    try {
      state.countdown = settings.refreshIntervalSeconds;
      pruneLoadingHistory();
      updateCountdown();
      updateAverageLabel();

      if (rerender) {
        renderAll();
        updateLiveTimes();
      }
    } catch {
      // A configuração também pode ser aplicada antes da inicialização completa da dashboard.
    }

    scheduleDashboardFit();
  }

  function installDashboardOverrides() {
    try {
      originalLoadDocks = loadDocks;

      loadDocks = async function configuredLoadDocks(manual = false) {
        const result = await originalLoadDocks(manual);
        state.countdown = settings.refreshIntervalSeconds;
        updateCountdown();
        return result;
      };

      handleSecondTick = configuredHandleSecondTick;
      updateCountdown = configuredUpdateCountdown;
      renderDockGroups = configuredRenderDockGroups;
      renderDockCard = configuredRenderDockCard;
      updateLiveTimes = configuredUpdateLiveTimes;
      syncLoadingHistory = configuredSyncLoadingHistory;
      calculateLoadingHistoryAverage = configuredCalculateLoadingHistoryAverage;
      pruneLoadingHistory = configuredPruneLoadingHistory;
      renderSummary = configuredRenderSummary;

      window.__spxDockFlowConfiguredTick = configuredHandleSecondTick;
    } catch (error) {
      console.warn('[SPX Dock Flow] Não foi possível aplicar todas as configurações dinâmicas.', error);
    }
  }

  function startDockPagination() {
    if (dockPageTimer) return;
    dockPageTimer = nativeSetInterval(handleDockPageTick, 1000);
  }

  function handleDockPageTick() {
    const totalPages = getDockPageCount();

    if (totalPages <= 1) {
      dockPageIndex = 0;
      dockPageElapsedSeconds = 0;
      pageTransitioning = false;
      return;
    }

    dockPageElapsedSeconds += 1;
    if (dockPageElapsedSeconds < DOCK_PAGE_INTERVAL_SECONDS || pageTransitioning) return;

    dockPageElapsedSeconds = 0;
    transitionToDockPage((dockPageIndex + 1) % totalPages);
  }

  function getDockPageCount(count = state.docks.length) {
    if (count <= MAX_DOCKS_PER_PAGE) return 1;
    return Math.ceil(count / MAX_DOCKS_PER_PAGE);
  }

  function getBalancedPageRange(count, pageIndex) {
    const totalPages = getDockPageCount(count);
    const baseSize = Math.floor(count / totalPages);
    const pagesWithExtraItem = count % totalPages;
    const size = baseSize + (pageIndex < pagesWithExtraItem ? 1 : 0);
    const start = pageIndex * baseSize + Math.min(pageIndex, pagesWithExtraItem);
    return { start, size, totalPages };
  }

  function configuredRenderDockGroups() {
    if (!state.docks.length) {
      dockPageIndex = 0;
      dockPageElapsedSeconds = 0;
      pageTransitioning = false;
      elements.dockGroups.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">↻</div>
          <strong>Nenhuma mesa disponível</strong>
          <p>Aguardando dados da operação.</p>
        </div>
      `;
      return;
    }

    renderCurrentDockPage();
  }

  function renderCurrentDockPage() {
    const sorted = [...state.docks].sort((a, b) => naturalDockSort(a.dock_name, b.dock_name));
    const totalPages = getDockPageCount(sorted.length);
    dockPageIndex = Math.min(dockPageIndex, totalPages - 1);

    if (totalPages <= 1) dockPageElapsedSeconds = 0;

    const range = getBalancedPageRange(sorted.length, dockPageIndex);
    const visibleDocks = sorted.slice(range.start, range.start + range.size);

    elements.dockGroups.innerHTML = `<div class="dock-grid" data-page="${dockPageIndex + 1}" data-pages="${range.totalPages}">${visibleDocks.map(renderDockCard).join('')}</div>`;

    if (state.demo && elements.noticeDetails) {
      elements.noticeDetails.textContent = 'Use a quantidade de docas para testar densidade e paginação automática. Acima de 15, as páginas são equilibradas e alternam a cada 10 segundos.';
    }

    scheduleGridFit();
  }

  function transitionToDockPage(nextPageIndex) {
    const totalPages = getDockPageCount();
    if (totalPages <= 1) return;

    const normalizedNextPage = ((nextPageIndex % totalPages) + totalPages) % totalPages;
    const currentGrid = elements.dockGroups.querySelector('.dock-grid');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (!currentGrid || reducedMotion || typeof currentGrid.animate !== 'function') {
      dockPageIndex = normalizedNextPage;
      renderCurrentDockPage();
      return;
    }

    pageTransitioning = true;
    currentGrid.style.willChange = 'transform, opacity';

    const exitAnimation = currentGrid.animate([
      { transform: 'translateX(0)', opacity: 1 },
      { transform: 'translateX(-14%)', opacity: 0 }
    ], {
      duration: PAGE_EXIT_DURATION_MS,
      easing: 'cubic-bezier(.4, 0, .6, 1)',
      fill: 'forwards'
    });

    exitAnimation.finished
      .catch(() => null)
      .then(() => {
        dockPageIndex = normalizedNextPage;
        renderCurrentDockPage();

        const incomingGrid = elements.dockGroups.querySelector('.dock-grid');
        if (!incomingGrid || typeof incomingGrid.animate !== 'function') return null;

        incomingGrid.style.willChange = 'transform, opacity';
        const enterAnimation = incomingGrid.animate([
          { transform: 'translateX(14%)', opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 }
        ], {
          duration: PAGE_ENTER_DURATION_MS,
          easing: 'cubic-bezier(.16, 1, .3, 1)',
          fill: 'both'
        });

        return enterAnimation.finished.catch(() => null).then(() => {
          incomingGrid.style.willChange = '';
        });
      })
      .finally(() => {
        pageTransitioning = false;
      });
  }

  function configuredHandleSecondTick() {
    if (!state.loading && settings.autoRefreshEnabled) {
      state.countdown -= 1;
      if (state.countdown <= 0) {
        state.countdown = settings.refreshIntervalSeconds;
        loadDocks();
      }
    } else if (!settings.autoRefreshEnabled) {
      state.countdown = settings.refreshIntervalSeconds;
    }

    updateCountdown();

    if (state.docks.length) {
      updateLiveTimes();
      updateSummaryTimes();
    }
  }

  function configuredUpdateCountdown() {
    const countdown = Math.max(0, state.countdown);
    elements.countdownValue.textContent = settings.autoRefreshEnabled ? countdown : '—';
    const progress = settings.autoRefreshEnabled
      ? Math.max(0, Math.min(100, countdown / settings.refreshIntervalSeconds * 100))
      : 0;
    elements.countdownRing.style.setProperty('--progress', `${progress}%`);

    const refreshBox = elements.countdownRing.closest('.refresh-box');
    if (refreshBox) {
      refreshBox.title = settings.autoRefreshEnabled
        ? `Atualização automática a cada ${settings.refreshIntervalSeconds} segundos`
        : 'Atualização automática desativada';
    }
  }

  function configuredRenderDockCard(dock) {
    const occupied = isDockOccupied(dock);
    const nextDriver = occupied ? null : getNextDriver(dock);
    const displayStatus = getDisplayStatus(dock, nextDriver);
    const driverId = occupied ? numberOrZero(dock.occupied_driver_id) : numberOrZero(nextDriver?.driver_id);
    const rawDriverName = occupied
      ? dock.occupied_driver_name || 'Motorista não informado'
      : nextDriver?.driver_name || (displayStatus.key === 'available' ? 'Aguardando próximo motorista' : 'Nenhum motorista aguardando');
    const driverName = formatPersonName(rawDriverName);
    const route = getRouteDisplay(dock, driverId, nextDriver, displayStatus);
    const rawDockSeconds = getLiveSeconds(occupied ? numberOrZero(dock.occupation_time) : numberOrZero(dock.idle_time));
    const rawWaitingSeconds = nextDriver
      ? getCurrentWaitingSeconds(numberOrZero(nextDriver.waiting_time), driverId)
      : 0;
    const dockSeconds = occupied ? rawDockSeconds : limitIdleToHistoryWindow(rawDockSeconds);
    const waitingSeconds = nextDriver ? limitIdleToHistoryWindow(rawWaitingSeconds) : 0;
    const id = numberOrZero(dock.dock_id);
    const loadingFinalized = route.kind === 'route-finished';
    const statusLabel = loadingFinalized ? 'Finalizado' : displayStatus.label;
    const statusClass = loadingFinalized ? 'finished' : displayStatus.key;
    const loadingThreshold = getLoadingAlertSeconds();
    const waitingThreshold = getWaitingAlertSeconds();
    const loadingOverLimit = occupied && !loadingFinalized && loadingThreshold > 0 && rawDockSeconds > loadingThreshold;
    const waitingOverLimit = Boolean(nextDriver) && waitingThreshold > 0 && rawWaitingSeconds > waitingThreshold;
    const alertTitle = loadingFinalized
      ? 'Carregamento finalizado · aguardando saída do motorista'
      : loadingOverLimit
        ? `Carregamento acima de ${formatMinutes(settings.loadingAlertMinutes)}`
        : waitingOverLimit
          ? `Espera acima de ${formatMinutes(settings.waitingAlertMinutes)}`
          : displayStatus.label;

    return `
      <article class="dock-card ${displayStatus.key}${loadingFinalized ? ' loading-finished' : ''}${loadingOverLimit ? ' overdue' : ''}${waitingOverLimit ? ' waiting-overdue' : ''}" data-dock-id="${id}">
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

  function configuredUpdateLiveTimes() {
    const loadingThreshold = getLoadingAlertSeconds();
    const waitingThreshold = getWaitingAlertSeconds();

    document.querySelectorAll('.live-duration').forEach(element => {
      const timerKind = element.dataset.timerKind;
      const rawSeconds = timerKind === 'waiting'
        ? getCurrentWaitingSeconds(numberOrZero(element.dataset.baseSeconds), numberOrZero(element.dataset.driverId))
        : getLiveSeconds(numberOrZero(element.dataset.baseSeconds));
      const displaySeconds = timerKind === 'waiting' || timerKind === 'idle'
        ? limitIdleToHistoryWindow(rawSeconds)
        : rawSeconds;
      element.textContent = formatDuration(displaySeconds);

      const card = element.closest('.dock-card');

      if (timerKind === 'occupation') {
        const isOverLimit = !card?.classList.contains('loading-finished') && loadingThreshold > 0 && rawSeconds > loadingThreshold;
        card?.classList.toggle('overdue', isOverLimit);
      }

      if (timerKind === 'waiting') {
        const isOverLimit = waitingThreshold > 0 && rawSeconds > waitingThreshold;
        card?.classList.toggle('waiting-overdue', isOverLimit);
      }

      if (card && (timerKind === 'occupation' || timerKind === 'waiting')) {
        const statusBadge = card.querySelector('.status-badge');
        if (statusBadge) {
          statusBadge.title = card.classList.contains('overdue')
            ? `Carregamento acima de ${formatMinutes(settings.loadingAlertMinutes)}`
            : card.classList.contains('waiting-overdue')
              ? `Espera acima de ${formatMinutes(settings.waitingAlertMinutes)}`
              : statusBadge.querySelector(':scope > span:last-child')?.textContent || '';
        }
      }
    });
  }

  function configuredSyncLoadingHistory() {
    const now = state.fetchedAt || Date.now();
    const nextActive = {};
    const historyWindowSeconds = getHistoryWindowSeconds();

    for (const dock of state.docks.filter(isDockOccupied)) {
      const snapshot = createLoadingSnapshot(dock, now);
      if (!snapshot || snapshot.durationSeconds > historyWindowSeconds) continue;

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

      if (finalDuration <= historyWindowSeconds) {
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

  function configuredCalculateLoadingHistoryAverage() {
    const now = Date.now();
    const historyWindowSeconds = getHistoryWindowSeconds();
    pruneLoadingHistory(now);

    const completedDurations = state.loadingHistory.completed.map(item => item.durationSeconds);
    const activeDurations = Object.values(state.loadingHistory.active)
      .map(item => Math.max(item.durationSeconds, Math.floor((now - item.startedAt) / 1000)))
      .filter(duration => duration <= historyWindowSeconds);
    const durations = [...completedDurations, ...activeDurations];

    return {
      count: durations.length,
      seconds: durations.length
        ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
        : 0
    };
  }

  function configuredPruneLoadingHistory(now = Date.now()) {
    const historyWindowSeconds = getHistoryWindowSeconds();
    const cutoff = now - historyWindowSeconds * 1000;

    state.loadingHistory.completed = state.loadingHistory.completed.filter(item => (
      item.completedAt >= state.openedAt
      && item.completedAt >= cutoff
      && item.durationSeconds <= historyWindowSeconds
    ));

    state.loadingHistory.active = Object.fromEntries(Object.entries(state.loadingHistory.active).filter(([, item]) => (
      Math.max(item.durationSeconds, Math.floor((now - item.startedAt) / 1000)) <= historyWindowSeconds
    )));
  }

  function configuredRenderSummary() {
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
    updateAverageLabel();
    elements.averageOccupationCard.title = summary.averageOccupationCount
      ? `Média de ${summary.averageOccupationCount} rota${summary.averageOccupationCount === 1 ? '' : 's'} acompanhada${summary.averageOccupationCount === 1 ? '' : 's'} desde a abertura, limitada às últimas ${formatHours(settings.historyWindowHours)}`
      : `Nenhuma rota acompanhada na janela das últimas ${formatHours(settings.historyWindowHours)}`;
  }

  function updateAverageLabel() {
    const label = document.querySelector('#averageOccupationCard > span');
    if (label) label.textContent = `Média por rota · ${formatCompactHours(settings.historyWindowHours)}`;
  }

  function getLoadingAlertSeconds() {
    return Math.max(0, settings.loadingAlertMinutes * 60);
  }

  function getWaitingAlertSeconds() {
    return Math.max(0, settings.waitingAlertMinutes * 60);
  }

  function getHistoryWindowSeconds() {
    return Math.max(1, settings.historyWindowHours) * 60 * 60;
  }

  function limitIdleToHistoryWindow(seconds) {
    return Math.min(Math.max(0, seconds), getHistoryWindowSeconds());
  }

  function formatMinutes(minutes) {
    const value = Number(minutes);
    return `${value} minuto${value === 1 ? '' : 's'}`;
  }

  function formatHours(hours) {
    const totalMinutes = Math.max(0, Math.round(Number(hours) * 60));
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!minutes) return `${wholeHours} hora${wholeHours === 1 ? '' : 's'}`;
    if (!wholeHours) return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
    return `${wholeHours}h ${String(minutes).padStart(2, '0')}min`;
  }

  function formatCompactHours(hours) {
    const totalMinutes = Math.max(0, Math.round(Number(hours) * 60));
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${wholeHours}h${String(minutes).padStart(2, '0')}` : `${wholeHours}h`;
  }

  function scheduleDashboardFit() {
    window.requestAnimationFrame(() => {
      try {
        scheduleGridFit();
      } catch {
        // A grade pode ainda não estar pronta.
      }
    });
  }
})();
