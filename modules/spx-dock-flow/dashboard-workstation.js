(() => {
  const STORAGE_KEY = 'spxDockFlowWorkstationV1';

  let selectedDockName = loadSelectedDockName();
  let lastObservedStatus = null;
  let selectedDockWasPresent = false;
  let refreshTimer = 0;
  let audioContext = null;
  const renderDockGroupsWithoutWorkstationState = renderDockGroups;

  installStyles();
  renderDockGroups = function renderDockGroupsWithWorkstationState(...args) {
    const result = renderDockGroupsWithoutWorkstationState.apply(this, args);
    applyHighlight();
    return result;
  };
  initialize();

  function initialize() {
    const dockGroups = document.getElementById('dockGroups');

    dockGroups?.addEventListener('click', handleDockClick);
    dockGroups?.addEventListener('keydown', handleDockKeydown);

    if (dockGroups && 'MutationObserver' in window) {
      const observer = new MutationObserver(scheduleRefresh);
      observer.observe(dockGroups, { childList: true, subtree: true });
    }

    document.addEventListener('pointerdown', unlockAudio, { capture: true, once: true });
    document.addEventListener('keydown', unlockAudio, { capture: true, once: true });

    scheduleRefresh();
  }

  function handleDockClick(event) {
    const card = event.target.closest('.dock-card[data-dock-id]');
    if (!card) return;

    toggleDockCardSelection(card);
  }

  function handleDockKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const card = event.target.closest('.dock-card[data-dock-id]');
    if (!card) return;

    event.preventDefault();
    toggleDockCardSelection(card);
  }

  function toggleDockCardSelection(card) {
    if (!card) return;

    const dockId = numberOrZero(card.dataset.dockId);
    const dock = state.docks.find(item => numberOrZero(item?.dock_id) === dockId);
    const dockName = String(dock?.dock_name || '').trim();
    if (!dockName) return;

    unlockAudio();

    if (normalizeDockName(selectedDockName) === normalizeDockName(dockName)) {
      clearSelectedDock();
      return;
    }

    selectedDockName = dockName;
    saveSelectedDockName(dockName);
    selectedDockWasPresent = true;
    lastObservedStatus = getDockOperationalStatus(dock);
    applyHighlight();
  }

  function clearSelectedDock() {
    selectedDockName = '';
    selectedDockWasPresent = false;
    lastObservedStatus = null;
    localStorage.removeItem(STORAGE_KEY);
    applyHighlight();
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshState, 140);
  }

  function refreshState() {
    applyHighlight();

    if (state.loading) {
      refreshTimer = window.setTimeout(refreshState, 220);
      return;
    }

    observeSelectedDockStatus();
  }

  function applyHighlight() {
    const normalizedSelected = normalizeDockName(selectedDockName);

    document.querySelectorAll('.dock-card[data-dock-id]').forEach(card => {
      const dockId = numberOrZero(card.dataset.dockId);
      const dock = state.docks.find(item => numberOrZero(item?.dock_id) === dockId);
      const isSelected = Boolean(normalizedSelected)
        && normalizeDockName(dock?.dock_name) === normalizedSelected;

      card.classList.toggle('workstation-dock', isSelected);
      card.setAttribute('role', 'checkbox');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-checked', String(isSelected));
      card.setAttribute('aria-label', `${isSelected ? 'Desmarcar' : 'Selecionar'} ${String(dock?.dock_name || 'doca')}`);

      if (isSelected) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    });
  }

  function observeSelectedDockStatus() {
    if (!selectedDockName) return;

    const normalizedSelected = normalizeDockName(selectedDockName);
    const dock = state.docks.find(item => normalizeDockName(item?.dock_name) === normalizedSelected);

    if (!dock) {
      selectedDockWasPresent = false;
      lastObservedStatus = null;
      return;
    }

    const currentStatus = getDockOperationalStatus(dock);

    if (!selectedDockWasPresent || !lastObservedStatus) {
      selectedDockWasPresent = true;
      lastObservedStatus = currentStatus;
      return;
    }

    if (currentStatus === lastObservedStatus) return;

    lastObservedStatus = currentStatus;
    playStatusChangeSound();
  }

  function getDockOperationalStatus(dock) {
    const occupied = isDockOccupied(dock);
    const nextDriver = occupied ? null : getNextDriver(dock);
    const displayStatus = getDisplayStatus(dock, nextDriver);

    if (displayStatus.key === 'occupied') {
      const driverId = numberOrZero(dock?.occupied_driver_id);
      const route = getRouteDisplay(dock, driverId, nextDriver, displayStatus);
      if (route?.kind === 'route-finished') return 'finished';
    }

    return displayStatus.key || 'unknown';
  }

  function unlockAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      if (!audioContext) audioContext = new AudioContextClass();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => null);
    } catch {
      audioContext = null;
    }
  }

  function playStatusChangeSound() {
    if (!audioContext) return;

    const play = () => {
      const startAt = audioContext.currentTime + 0.015;
      playTone(740, startAt, 0.14);
      playTone(980, startAt + 0.18, 0.17);
    };

    if (audioContext.state === 'suspended') {
      audioContext.resume().then(play).catch(() => null);
    } else {
      play();
    }
  }

  function playTone(frequency, startAt, duration) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }

  function loadSelectedDockName() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return String(saved?.dockName || '').trim();
    } catch {
      return '';
    }
  }

  function saveSelectedDockName(dockName) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      dockName: String(dockName || '').trim()
    }));
  }

  function normalizeDockName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleUpperCase('pt-BR');
  }

  function installStyles() {
    if (document.getElementById('spxDockFlowWorkstationStyles')) return;

    const style = document.createElement('style');
    style.id = 'spxDockFlowWorkstationStyles';
    style.textContent = `
      .dock-card[data-dock-id] {
        --selection-accent: var(--status-accent, var(--muted));
        cursor: pointer;
        isolation: isolate;
        overflow: visible;
        transition:
          border-color 0.2s ease,
          box-shadow 0.2s ease,
          outline-color 0.2s ease;
      }

      .dock-card[data-dock-id]:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--blue) 82%, white);
        outline-offset: 3px;
      }

      .dock-selection-checkbox {
        position: absolute;
        top: -4px;
        left: -4px;
        z-index: 7;
        display: block;
        width: 34px;
        height: 34px;
        overflow: hidden;
        border-radius: 10px 0 0;
        color: #fff;
        background: var(--selection-accent);
        clip-path: polygon(0 0, 100% 0, 0 100%);
        filter: drop-shadow(2px 3px 4px color-mix(in srgb, var(--selection-accent) 22%, transparent));
        opacity: 0;
        transform: scale(0.74);
        transform-origin: top left;
        transition:
          opacity 0.18s ease,
          transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
          filter 0.18s ease;
        pointer-events: none;
      }

      .dock-selection-checkbox svg {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 3.2;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-dasharray: 24;
        stroke-dashoffset: 24;
        transition: stroke-dashoffset 0.22s ease 0.04s;
      }

      .dock-card[data-dock-id]:not(.workstation-dock):hover .dock-selection-checkbox,
      .dock-card[data-dock-id]:not(.workstation-dock):focus-visible .dock-selection-checkbox {
        opacity: 0.28;
        transform: scale(0.92);
      }

      .dock-card.workstation-dock {
        z-index: 3;
        outline: 2px solid var(--selection-accent);
        outline-offset: 2px;
        border-color: color-mix(in srgb, var(--selection-accent) 76%, var(--line));
        box-shadow:
          0 0 0 5px color-mix(in srgb, var(--selection-accent) 12%, transparent),
          0 14px 30px color-mix(in srgb, var(--selection-accent) 15%, transparent),
          var(--card-shadow);
      }

      .dock-card.workstation-dock .dock-selection-checkbox {
        opacity: 1;
        transform: scale(1);
        filter: drop-shadow(2px 4px 5px color-mix(in srgb, var(--selection-accent) 34%, transparent));
      }

      .dock-card.workstation-dock .dock-selection-checkbox svg {
        stroke-dashoffset: 0;
      }

      @media (prefers-reduced-motion: reduce) {
        .dock-card[data-dock-id],
        .dock-selection-checkbox,
        .dock-selection-checkbox svg {
          transition-duration: 0.01ms;
        }
      }
    `;

    document.head.appendChild(style);
  }
})();
