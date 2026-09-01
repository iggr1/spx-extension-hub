(() => {
  const STORAGE_KEY = 'spxDockFlowWorkstationV1';

  let selectedDockName = loadSelectedDockName();
  let selectingDock = false;
  let lastObservedStatus = null;
  let selectedDockWasPresent = false;
  let refreshTimer = 0;
  let audioContext = null;

  installStyles();
  initialize();

  function initialize() {
    const button = ensureButton();
    const dockGroups = document.getElementById('dockGroups');

    button?.addEventListener('click', handleButtonClick);
    dockGroups?.addEventListener('click', handleDockClick);

    if (dockGroups && 'MutationObserver' in window) {
      const observer = new MutationObserver(scheduleRefresh);
      observer.observe(dockGroups, { childList: true, subtree: true });
    }

    document.addEventListener('pointerdown', unlockAudio, { capture: true, once: true });
    document.addEventListener('keydown', unlockAudio, { capture: true, once: true });

    updateButton();
    applySelectionMode();
    scheduleRefresh();
  }

  function ensureButton() {
    let button = document.getElementById('workstationDockButton');
    if (button) return button;

    const utilityActions = document.querySelector('.utility-actions');
    if (!utilityActions) return null;

    button = document.createElement('button');
    button.id = 'workstationDockButton';
    button.type = 'button';
    button.className = 'button secondary workstation-dock-button';

    const zoomControl = utilityActions.querySelector('.header-zoom-control');
    utilityActions.insertBefore(button, zoomControl || utilityActions.firstChild);
    return button;
  }

  function handleButtonClick() {
    unlockAudio();

    if (selectedDockName) {
      clearSelectedDock();
      return;
    }

    selectingDock = !selectingDock;
    updateButton();
    applySelectionMode();
  }

  function handleDockClick(event) {
    if (!selectingDock) return;

    const card = event.target.closest('.dock-card[data-dock-id]');
    if (!card) return;

    const dockId = numberOrZero(card.dataset.dockId);
    const dock = state.docks.find(item => numberOrZero(item?.dock_id) === dockId);
    const dockName = String(dock?.dock_name || '').trim();
    if (!dockName) return;

    event.preventDefault();
    event.stopPropagation();
    unlockAudio();

    selectedDockName = dockName;
    selectingDock = false;
    saveSelectedDockName(dockName);
    selectedDockWasPresent = true;
    lastObservedStatus = getDockOperationalStatus(dock);

    updateButton();
    applySelectionMode();
    applyHighlight();
  }

  function clearSelectedDock() {
    selectedDockName = '';
    selectingDock = false;
    selectedDockWasPresent = false;
    lastObservedStatus = null;
    localStorage.removeItem(STORAGE_KEY);

    updateButton();
    applySelectionMode();
    applyHighlight();
  }

  function updateButton() {
    const button = ensureButton();
    if (!button) return;

    button.classList.toggle('has-selection', Boolean(selectedDockName));
    button.classList.toggle('is-selecting', selectingDock);

    if (selectedDockName) {
      button.textContent = 'Desmarcar doca';
      button.title = `Doca atual: ${selectedDockName}. Clique para desmarcar.`;
      button.setAttribute('aria-label', `Desmarcar ${selectedDockName} como doca atual`);
      return;
    }

    if (selectingDock) {
      button.textContent = 'Cancelar seleção';
      button.title = 'Cancelar seleção da doca atual';
      button.setAttribute('aria-label', 'Cancelar seleção da doca atual');
      return;
    }

    button.textContent = 'Selecionar doca atual';
    button.title = 'Selecionar a doca deste computador';
    button.setAttribute('aria-label', 'Selecionar doca atual');
  }

  function applySelectionMode() {
    document.body.classList.toggle('dock-selection-mode', selectingDock);

    let hint = document.getElementById('dockSelectionHint');

    if (selectingDock) {
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'dockSelectionHint';
        hint.className = 'dock-selection-hint';
        hint.setAttribute('role', 'status');
        document.body.appendChild(hint);
      }
      hint.textContent = 'Clique no card da doca deste computador';
    } else {
      hint?.remove();
    }

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
      card.classList.toggle('workstation-selectable', selectingDock);

      if (isSelected) {
        card.setAttribute('aria-current', 'true');
      } else {
        card.removeAttribute('aria-current');
      }
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
      .workstation-dock-button {
        min-width: 128px;
        white-space: nowrap;
      }

      .workstation-dock-button.has-selection {
        color: var(--blue);
        border-color: color-mix(in srgb, var(--blue) 52%, var(--line));
        background: var(--blue-soft);
      }

      .workstation-dock-button.is-selecting {
        color: var(--orange);
        border-color: color-mix(in srgb, var(--orange) 52%, var(--line));
        background: var(--orange-soft);
      }

      .dock-card.workstation-dock {
        z-index: 3;
        outline: 3px solid var(--blue);
        outline-offset: -2px;
        border-color: color-mix(in srgb, var(--blue) 76%, var(--line));
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--blue) 18%, transparent), var(--card-shadow);
      }

      .dock-selection-mode .dock-card.workstation-selectable {
        cursor: pointer;
        opacity: 0.74;
        transition: opacity 0.14s ease, transform 0.14s ease, outline-color 0.14s ease;
      }

      .dock-selection-mode .dock-card.workstation-selectable:hover {
        z-index: 4;
        opacity: 1;
        outline: 3px solid var(--orange);
        outline-offset: -2px;
        transform: translateY(-2px);
      }

      .dock-selection-hint {
        position: fixed;
        left: 50%;
        bottom: 18px;
        z-index: 10000;
        transform: translateX(-50%);
        padding: 9px 16px;
        border: 1px solid color-mix(in srgb, var(--orange) 62%, var(--line));
        border-radius: 999px;
        color: #fff;
        background: color-mix(in srgb, var(--orange) 88%, #000);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
        font-size: 11px;
        font-weight: 900;
        white-space: nowrap;
        pointer-events: none;
      }

      .dashboard-header.is-collapsed #workstationDockButton {
        display: none;
      }

      @media (max-width: 1180px) {
        .workstation-dock-button {
          min-width: 0;
          max-width: 124px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    `;

    document.head.appendChild(style);
  }
})();
