(() => {
  const STORAGE_KEY = 'spxDockFlowWorkstationV1';
  const BULKY_STORAGE_KEY = 'spxDockFlowBulkyDocksV1';
  const SHARED_ALARM_KEY = 'spxDockFlowLastAlarmV1';
  const ALARM_COOLDOWN_MS = 3000;

  let selectedDockName = loadSelectedDockName();
  const bulkyDockNames = loadBulkyDockNames();
  let markedOverdueState = null;
  let markedDockOperationKey = '';
  let refreshTimer = 0;
  let audioContext = null;
  let lastAlarmTime = 0;
  let detailsDialog = null;
  let detailsDockId = 0;
  let detailsTimer = 0;
  let detailsTrigger = null;
  installStyles();

  // dashboard-settings.js aplica os overrides no DOMContentLoaded. Instalar os
  // decorators depois evita que as funções marcadas sejam sobrescritas.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installWorkstation, { once: true });
  } else {
    installWorkstation();
  }

  function installWorkstation() {
    const renderDockGroupsWithoutWorkstationState = renderDockGroups;
    const renderDockCardWithoutWorkstationState = renderDockCard;
    renderDockCard = function renderDockCardWithWorkstationState(dock, ...args) {
      let html = renderDockCardWithoutWorkstationState.call(this, dock, ...args);
      const dockName = normalizeDockName(dock?.dock_name);
      const marked = Boolean(dockName) && normalizeDockName(selectedDockName) === dockName;
      const bulky = Boolean(dockName) && bulkyDockNames.has(dockName);
      if (!marked && !bulky) return html;

      html = html.replace(/(<article\b[^>]*\bclass=")([^"]*)(")/, (_, start, classes, end) =>
        start + classes + (marked ? ' workstation-dock' : '') + (bulky ? ' workstation-bulky' : '') + end
      );

      if (marked && !html.includes('class="dock-selection-checkbox"')) {
        const check = '<span class="dock-selection-checkbox" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"></path></svg></span>';
        html = html.replace(/(<article\b[^>]*>)/, '$1' + check);
      }
      if (bulky && !html.includes('workstation-bulky-label')) {
        const start = html.indexOf('<div class="dock-name-block">');
        const end = start < 0 ? -1 : html.indexOf('</strong>', start);
        if (end >= 0) html = html.slice(0, end + 9) + '<span class="workstation-bulky-label">Volumoso</span>' + html.slice(end + 9);
      }
      return html;
    };
    renderDockGroups = function renderDockGroupsWithWorkstationState(...args) {
      const result = renderDockGroupsWithoutWorkstationState.apply(this, args);
      applyHighlight();
      observeMarkedDockOverdue();
      return result;
    };
    window.__spxDockFlowEvaluateMarkedOverdue = observeMarkedDockOverdue;
    initialize();

  }

  function initialize() {
    const dockGroups = document.getElementById('dockGroups');

    dockGroups?.addEventListener('click', handleDockClick);
    dockGroups?.addEventListener('keydown', handleDockKeydown);

    if (dockGroups && 'MutationObserver' in window) {
      const observer = new MutationObserver(() => {
        applyHighlight();
        observeMarkedDockOverdue();
        scheduleRefresh();
      });
      observer.observe(dockGroups, { childList: true, subtree: true });
    }

    document.addEventListener('pointerdown', unlockAudio, { capture: true, once: true });
    document.addEventListener('keydown', unlockAudio, { capture: true, once: true });

    scheduleRefresh();
  }

  function handleDockClick(event) {
    const card = event.target.closest('.dock-card[data-dock-id]');
    if (!card) return;

    openDockDetails(card);
  }

  function handleDockKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const card = event.target.closest('.dock-card[data-dock-id]');
    if (!card) return;

    event.preventDefault();
    openDockDetails(card);
  }

  function openDockDetails(card) {
    detailsDockId = numberOrZero(card.dataset.dockId);
    detailsTrigger = card;
    if (!detailsDialog) {
      detailsDialog = document.createElement('dialog');
      detailsDialog.className = 'dock-details-dialog';
      detailsDialog.setAttribute('aria-labelledby', 'dockDetailsTitle');
      detailsDialog.innerHTML = `
        <header><div><small>DETALHES DA ROTA</small><h2 id="dockDetailsTitle"></h2></div>
          <button type="button" data-close aria-label="Fechar detalhes" autofocus>×</button></header>
        <div class="dock-details-body"></div>
        <footer>
          <div class="dock-details-flags">
            <label class="dock-details-flag"><span>Marcar doca</span><input type="checkbox" data-mark aria-label="Marcar doca para destaque e alarme sonoro"></label>
            <label class="dock-details-flag bulky-flag"><span>Doca de Volumosos</span><input type="checkbox" data-bulky aria-label="Destacar como doca de volumosos"></label>
          </div>
          <button type="button" data-close>Fechar</button>
        </footer>`;
      document.body.appendChild(detailsDialog);
      detailsDialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => detailsDialog.close()));
      detailsDialog.addEventListener('click', event => {
        if (event.target !== detailsDialog) return;
        const rect = detailsDialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) detailsDialog.close();
      });
      detailsDialog.querySelector('[data-mark]').addEventListener('change', () => {
        toggleDockCardSelection({ dataset: { dockId: String(detailsDockId) } });
        renderDockDetails();
      });
      detailsDialog.querySelector('[data-bulky]').addEventListener('change', event => {
        toggleBulkyDock(detailsDockId, event.target.checked);
        renderDockDetails();
      });
      detailsDialog.addEventListener('close', () => {
        window.clearInterval(detailsTimer);
        const currentCard = document.querySelector(`.dock-card[data-dock-id="${detailsDockId}"]`);
        (currentCard || (detailsTrigger?.isConnected ? detailsTrigger : null))?.focus();
      });
    }
    renderDockDetails();
    if (!detailsDialog.open) detailsDialog.showModal();
    window.clearInterval(detailsTimer);
    detailsTimer = window.setInterval(renderDockDetails, 1000);
  }

  function renderDockDetails() {
    const dock = state.docks.find(item => numberOrZero(item.dock_id) === detailsDockId);
    const body = detailsDialog.querySelector('.dock-details-body');
    const mark = detailsDialog.querySelector('[data-mark]');
    const bulky = detailsDialog.querySelector('[data-bulky]');
    mark.disabled = !dock;
    bulky.disabled = !dock;
    if (!dock) {
      detailsDialog.querySelector('h2').textContent = 'Mesa indisponível';
      body.textContent = 'Esta mesa não está mais disponível nos dados atuais.';
      return;
    }
    const occupied = isDockOccupied(dock);
    const next = occupied ? null : getNextDriver(dock);
    const driverId = numberOrZero(occupied ? dock.occupied_driver_id : next?.driver_id);
    const routeState = state.driverRoutes[driverId];
    const status = getDisplayStatus(dock, next);
    const route = getRouteDisplay(dock, driverId, next, status);
    const assignmentId = normalizeAssignmentTaskId(occupied ? dock.operation_task_id : next?.assignment_task_id)
      || route.assignmentTaskId;
    const details = (!assignmentId || assignmentId === routeState?.assignmentTaskId) ? routeState?.details || {} : {};
    const stats = state.assignmentStats[assignmentId];
    const selected = normalizeDockName(selectedDockName) === normalizeDockName(dock.dock_name);
    mark.checked = selected;
    bulky.checked = bulkyDockNames.has(normalizeDockName(dock.dock_name));
    detailsDialog.querySelector('h2').textContent = `${dock.dock_name} · ${route.value}`;
    const number = value => value == null || value === '' ? '—' : Number(value).toLocaleString('pt-BR');
    const date = value => Number(value) > 0 ? new Date(Number(value) * 1000).toLocaleString('pt-BR') : '—';
    const fields = [
      ['Situação', route.kind === 'route-finished' ? 'Carregamento finalizado' : status.label],
      ['AT', assignmentId],
      ['Motorista', occupied ? dock.occupied_driver_name : next?.driver_name],
      ['ID do motorista', driverId || '—'],
      ['Placa', occupied ? dock.occupied_vehicle_number : next?.vehicle_number],
      ['Senha', occupied ? dock.occupied_queue_number : next?.queue_number],
      ['Região / cluster', details.cluster || next?.cluster],
      ['Cidade', details.city], ['Bairro', details.neighborhood],
      ['Pedidos da AT', number(details.order_count ?? (stats?.status === 'ready' ? stats.totalOrders : null))],
      ['Paradas', number(details.stops_number)],
      ['Distância planejada', details.total_distance == null ? '—' : `${number(details.total_distance)} km`],
      ['Veículo planejado', details.planned_vehicle_type || details.vehicle_name],
      ['Tipo de veículo', details.vehicle_type || next?.vehicle_type_name],
      ['Transportadora', details.agency], ['Estação', details.station_name],
      ['AT criada em', date(details.ctime)], ['Motorista atribuído em', date(details.driver_assigned_time)],
      [occupied ? 'Tempo na mesa' : 'Tempo ocioso da mesa', formatDuration(getLiveSeconds(numberOrZero(occupied ? dock.occupation_time : dock.idle_time)))],
      ...(next ? [['Tempo de espera', formatDuration(getCurrentWaitingSeconds(numberOrZero(next.waiting_time), driverId))], ['Posição na fila', next.queue_sequence]] : []),
      ['Grupo de docas', dock.dock_group_name]
    ];
    const html = `${renderSizeBreakdown(stats, assignmentId)}${state.routesLoading ? '<p>Atualizando informações da rota…</p>' : routeState?.ok === false ? '<p>Detalhes da AT indisponíveis nesta atualização.</p>' : ''}
      <dl>${fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value == null || value === '' ? '—' : String(value))}</dd></div>`).join('')}</dl>
      <p class="dock-details-note">Marcar doca mantém o destaque e dispara um alarme curto quando a situação operacional mudar. Doca de Volumosos usa destaque e alertas visuais amarelos; as duas opções são independentes.</p>`;
    if (body.innerHTML !== html) body.innerHTML = html;
  }

  function renderSizeBreakdown(stats, assignmentId) {
    const heading = '<h3>Pedidos por tamanho</h3>';
    if (stats?.status !== 'ready') {
      const message = !assignmentId ? 'Nenhuma AT vinculada.'
        : stats?.status === 'error' ? 'Não foi possível consultar os tamanhos dos pedidos.'
        : 'Carregando a distribuição por tamanho…';
      return `<section class="dock-size-summary">${heading}<p role="status">${message}</p></section>`;
    }
    const sizes = Object.entries(stats.sizeCounts || {})
      .filter(([, count]) => numberOrZero(count) > 0)
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    const total = numberOrZero(stats.totalOrders);
    const missing = numberOrZero(stats.missingSizeOrders);
    const cards = sizes.map(([size, count]) => {
      const labels = {
        '1': 'PP',
        '2': 'P',
        '3': 'M',
        '4': 'G',
        '5': 'QB (GG)',
        '6': 'Bulky',
        '7': 'PTL',
        empty: 'Sem tamanho definido'
      };
      const label = Object.hasOwn(labels, size) ? labels[size] : `Tamanho ${size}`;
      return `<div class="dock-size-card${size === '5' || size === '6' ? ' bulky-size' : ''}"><span>${escapeHtml(label)}</span><strong>${numberOrZero(count).toLocaleString('pt-BR')}</strong></div>`;
    });
    if (missing > 0) cards.push(`<div class="dock-size-card"><span>Sem retorno na busca</span><strong>${missing.toLocaleString('pt-BR')}</strong></div>`);
    return `<section class="dock-size-summary">${heading}
      <div class="dock-size-grid"><div class="dock-size-card size-total"><span>Total de pedidos</span><strong>${total.toLocaleString('pt-BR')}</strong></div>${cards.join('')}</div>
      ${total === 0 ? '<p>Nenhum pedido encontrado nesta AT.</p>' : ''}
      <p>Volumosos: QB (GG) + Bulky.</p></section>`;
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
    markedDockOperationKey = '';
    markedOverdueState = null;
    applyHighlight();
    observeMarkedDockOverdue();
  }

  function toggleBulkyDock(dockId, enabled) {
    const dock = state.docks.find(item => numberOrZero(item?.dock_id) === numberOrZero(dockId));
    const dockName = normalizeDockName(dock?.dock_name);
    if (!dockName) return;
    if (enabled) bulkyDockNames.add(dockName);
    else bulkyDockNames.delete(dockName);
    saveBulkyDockNames();
    applyHighlight();
  }

  function loadBulkyDockNames() {
    try {
      const saved = JSON.parse(localStorage.getItem(BULKY_STORAGE_KEY) || '[]');
      return new Set(Array.isArray(saved) ? saved.map(normalizeDockName).filter(Boolean) : []);
    } catch {
      return new Set();
    }
  }

  function saveBulkyDockNames() {
    try {
      localStorage.setItem(BULKY_STORAGE_KEY, JSON.stringify([...bulkyDockNames]));
    } catch (error) {
      console.warn('[Dock Flow] Não foi possível guardar as docas de volumosos:', error);
    }
  }

  function clearSelectedDock() {
    selectedDockName = '';
    markedOverdueState = null;
    markedDockOperationKey = '';
    localStorage.removeItem(STORAGE_KEY);
    applyHighlight();
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshState, 140);
  }

  function refreshState() {
    applyHighlight();

    observeMarkedDockOverdue();
  }

  function applyHighlight() {
    const normalizedSelected = normalizeDockName(selectedDockName);

    document.querySelectorAll('.dock-card[data-dock-id]').forEach(card => {
      const dockId = numberOrZero(card.dataset.dockId);
      const dock = state.docks.find(item => numberOrZero(item?.dock_id) === dockId);
      const dockName = normalizeDockName(dock?.dock_name || card.dataset.workstationDockName);
      const isSelected = Boolean(normalizedSelected) && dockName === normalizedSelected;
      const isBulky = bulkyDockNames.has(dockName);

      card.classList.toggle('workstation-dock', isSelected);
      card.classList.toggle('workstation-bulky', isBulky);
      const nameBlock = card.querySelector('.dock-name-block');
      let bulkyTag = nameBlock?.querySelector('.workstation-bulky-label');
      if (isSelected && !card.querySelector('.dock-selection-checkbox')) {
        const check = document.createElement('span');
        check.className = 'dock-selection-checkbox';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"></path></svg>';
        card.prepend(check);
      }
      if (isBulky && nameBlock && !bulkyTag) {
        bulkyTag = document.createElement('span');
        bulkyTag.className = 'workstation-bulky-label';
        bulkyTag.textContent = 'Volumoso';
        nameBlock.appendChild(bulkyTag);
      } else if (!isBulky && bulkyTag) bulkyTag.remove();
      card.setAttribute('role', 'button');
      card.setAttribute('aria-haspopup', 'dialog');
      card.setAttribute('tabindex', '0');
      card.removeAttribute('aria-checked');
      card.setAttribute('aria-label', `Ver detalhes de ${String(dock?.dock_name || 'doca')}${isSelected ? ' · doca marcada com alarme' : ''}${isBulky ? ' · volumosos' : ''}`);

      if (isSelected) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    });
  }

  function observeMarkedDockOverdue() {
    if (!selectedDockName) return;

    const name = normalizeDockName(selectedDockName);
    const dock = state.docks.find(item => normalizeDockName(item?.dock_name) === name);
    if (!dock) {
      markedDockOperationKey = '';
      markedOverdueState = null;
      return;
    }

    const card = [...document.querySelectorAll('.dock-card[data-dock-id]')]
      .find(item => numberOrZero(item.dataset.dockId) === numberOrZero(dock.dock_id));
    if (!card) return;

    const operationKey = [name, numberOrZero(dock.occupied_driver_id), card.dataset.assignmentTaskId || dock.operation_task_id || ''].join('|');
    const overdue = card.classList.contains('occupied')
      && card.classList.contains('overdue')
      && !card.classList.contains('loading-finished');

    if (operationKey !== markedDockOperationKey || markedOverdueState === null) {
      markedDockOperationKey = operationKey;
      markedOverdueState = overdue;
      return;
    }

    const justBecameOverdue = !markedOverdueState && overdue;
    markedOverdueState = overdue;

    if (justBecameOverdue && card.classList.contains('workstation-dock')
      && !card.classList.contains('workstation-bulky')) playStatusChangeSound();
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

    const now = Date.now();
    if (now - lastAlarmTime < ALARM_COOLDOWN_MS) return;

    try {
      const lastSharedAlarm = Number(localStorage.getItem(SHARED_ALARM_KEY) || 0);
      if (lastSharedAlarm > 0 && now - lastSharedAlarm >= 0 && now - lastSharedAlarm < ALARM_COOLDOWN_MS) return;
      localStorage.setItem(SHARED_ALARM_KEY, String(now));
    } catch {}

    lastAlarmTime = now;

    const play = () => {
      try {
        const startAt = audioContext.currentTime + 0.04;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = 'square';
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        gain.gain.setValueAtTime(0.0001, startAt);

        for (let i = 0; i < 3; i += 1) {
          const pulse = startAt + i * 0.75;
          oscillator.frequency.setValueAtTime(830, pulse);
          oscillator.frequency.setValueAtTime(990, pulse + 0.28);
          gain.gain.linearRampToValueAtTime(0.22, pulse + 0.03);
          gain.gain.setValueAtTime(0.22, pulse + 0.40);
          gain.gain.exponentialRampToValueAtTime(0.0001, pulse + 0.54);
        }

        oscillator.start(startAt);
        oscillator.stop(startAt + 2.08);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      } catch (error) {
        console.warn('[Dock Flow] Não foi possível reproduzir o alarme:', error);
      }
    };

    if (audioContext.state === 'suspended') {
      audioContext.resume().then(play).catch(() => null);
    } else {
      play();
    }
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
      .dock-details-dialog {
        width: min(780px, calc(100vw - 32px)); max-height: calc(100dvh - 40px);
        padding: 0; margin: auto; border: 1px solid var(--line); border-radius: 18px;
        background: var(--surface); color: var(--ink); box-shadow: 0 24px 90px #0005;
      }
      .dock-details-dialog::backdrop { background: #09122599; backdrop-filter: blur(4px); }
      .dock-details-dialog header, .dock-details-dialog footer {
        display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px;
      }
      .dock-details-dialog header { border-bottom: 1px solid var(--line); }
      .dock-details-dialog h2 { font-size: 21px; margin: 6px 0 0; overflow-wrap: anywhere; }
      .dock-details-dialog small, .dock-details-dialog dt, .dock-details-note { color: var(--muted); }
      .dock-details-body { padding: 4px 24px; }
      .dock-details-dialog dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .dock-details-dialog dl > div { background: var(--surface-soft); padding: 12px; border-radius: 10px; }
      .dock-details-dialog dt { font-size: 12px; margin-bottom: 5px; }
      .dock-details-dialog dd { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
      .dock-details-dialog button { cursor: pointer; border: 1px solid var(--line); border-radius: 9px; padding: 10px 16px; background: var(--surface-soft); color: var(--ink); font: inherit; }
      .dock-details-dialog button:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
      .dock-details-flags { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
      .dock-details-flag { display:inline-flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--surface-soft); cursor:pointer; font-weight:750; font-size:13px; }
      .dock-details-flag input { width:18px; height:18px; margin:0; accent-color:var(--orange); cursor:pointer; }
      .dock-details-flag:has(input:checked) { border-color:var(--orange); background:color-mix(in srgb, var(--orange) 10%, var(--surface)); }
      .dock-details-flag.bulky-flag input { accent-color:#eab308; }
      .dock-details-flag.bulky-flag:has(input:checked) { border-color:#eab308; background:color-mix(in srgb, #eab308 12%, var(--surface)); }
      .dock-details-dialog footer { flex-wrap:wrap; }
      @media(max-width:600px) { .dock-details-flags { width:100%; } .dock-details-flag { flex:1; justify-content:space-between; } }
      .dock-details-dialog footer { position: sticky; bottom: 0; background: var(--surface); border-top: 1px solid var(--line); }
      .dock-size-summary { margin: 20px 0; padding: 18px; border: 1px solid var(--orange); border-radius: 14px; background: var(--orange-soft); }
      .dock-size-summary h3 { margin: 0 0 14px; font-size: 18px; }
      .dock-size-summary p { margin: 12px 0 0; font-size: 12px; color: var(--muted); }
      .dock-size-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
      .dock-size-card { padding: 16px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
      .dock-size-card span { display: block; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
      .dock-size-card strong { display: block; margin-top: 8px; font-size: 32px; font-weight: 800; line-height: 1; }
      .dock-size-card.size-total { background: var(--orange); border-color: var(--orange); color: #fff; }
      .dock-size-card.bulky-size { border-color: var(--orange); }
      .dock-details-note { font-size: 12px; line-height: 1.5; }
      @media (max-width: 520px) { .dock-details-dialog dl { grid-template-columns: 1fr; } }

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

      .dock-card.workstation-bulky {
        --danger:#eab308;
        --danger-dark:#ca8a04;
        --danger-soft:rgba(234,179,8,.18);
        --danger-glow:rgba(234,179,8,.40);
        --selection-accent:#facc15;
        z-index:4;
        outline:3px solid #facc15;
        outline-offset:2px;
        border-color:#eab308;
        box-shadow:0 0 0 5px rgba(234,179,8,.14), 0 13px 32px rgba(234,179,8,.12), var(--card-shadow);
      }
      .dock-card.workstation-bulky.available .dock-name-block,
      .dock-card.workstation-bulky.inactive,
      .dock-card.workstation-bulky.unknown { opacity:1; filter:none; }
      .dock-card.workstation-bulky .workstation-bulky-label {
        display:inline-flex; align-items:center; align-self:flex-start;
        padding:3px 7px; margin-top:4px; border-radius:6px;
        font-size:10px; font-weight:850; line-height:1.2;
        text-transform:uppercase; letter-spacing:.04em;
        color:#422006; background:#fde047; border:1px solid #facc15;
      }
      .dock-card.workstation-bulky.occupied.overdue {
        border-color:#eab308;
        outline-color:#facc15;
        animation:dock-bulky-alert 1.3s ease-in-out infinite;
      }
      .dock-card.workstation-bulky.waiting-overdue .waiting-time {
        background:rgba(234,179,8,.16);
        border-color:#eab308;
        box-shadow:inset 3px 0 0 #eab308;
      }
      .dock-card.workstation-bulky.waiting-overdue .waiting-time strong,
      .dock-card.workstation-bulky.waiting-overdue .status-badge.next { color:#eab308; }
      .dock-card.workstation-bulky.waiting-overdue .status-badge.next { background:rgba(234,179,8,.16); }
      .dock-card.workstation-bulky.waiting-overdue .alert-icon { background:#eab308; box-shadow:0 0 0 0 rgba(234,179,8,.38); }
      @keyframes dock-bulky-alert {
        0%, 100% { box-shadow:0 0 0 0 rgba(234,179,8,0), var(--card-shadow); }
        50% { box-shadow:0 0 0 4px rgba(234,179,8,.60), 0 0 24px 4px rgba(234,179,8,.26); }
      }
      @media (prefers-reduced-motion: reduce) {
        .dock-card.workstation-bulky.occupied.overdue { animation:none; }
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
