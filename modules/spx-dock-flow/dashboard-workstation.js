(() => {
  const STORAGE_KEY = 'spxDockFlowWorkstationV1';

  let selectedDockName = loadSelectedDockName();
  let lastObservedStatus = null;
  let selectedDockWasPresent = false;
  let refreshTimer = 0;
  let audioContext = null;

  installStyles();
  initialize();

  function initialize() {
    const dockGroups = document.getElementById('dockGroups');

    dockGroups?.addEventListener('click', handleDockClick);

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
        cursor: pointer;
      }

      .dock-card.workstation-dock {
        z-index: 3;
        outline: 3px solid var(--blue);
        outline-offset: -2px;
        border-color: color-mix(in srgb, var(--blue) 76%, var(--line));
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--blue) 18%, transparent), var(--card-shadow);
      }
    `;

    document.head.appendChild(style);
  }
})();
