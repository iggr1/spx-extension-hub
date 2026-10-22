(() => {
  const STORAGE_KEY = 'spxDockFlowShowVehiclesV1';
  const VEHICLE_SPRITE = './assets/vehicles.webp';
  const TYPE_LABELS = Object.freeze({
    moto: 'ZOF-MOTO-AR',
    passeio: 'ZOF-PASSEIO-AR',
    fiorino: 'ZOF-FIORINO-AR',
    van: 'ZOF-VAN-AR'
  });

  let realVisible = false;
  let demoVisible = true;

  try {
    realVisible = localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {}

  const input = document.getElementById('vehicleVisibilityToggle');
  const control = document.getElementById('vehicleVisibilityControl');
  if (!input || !control) return;

  function normalizeType(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[_-]+/g, ' ').trim();
  }

  function vehicleType(dock) {
    if (!isDockOccupied(dock)) return '';
    const driverId = Number(dock?.occupied_driver_id) || 0;
    const route = driverId ? state.driverRoutes[driverId] : null;
    const detail = route?.ok === true ? route.details : null;
    const candidates = [
      detail?.vehicle_type, detail?.planned_vehicle_type, detail?.vehicle_name,
      dock?.vehicle_type_name, dock?.vehicle_type, dock?.planned_vehicle_type,
      dock?.vehicle_name
    ];

    for (const raw of candidates) {
      const type = normalizeType(raw);
      if (!type) continue;
      if (/\b(FIORINO)\b/.test(type)) return 'fiorino';
      if (/\b(VAN|FURGAO|SPRINTER|MASTER|DUCATO)\b/.test(type)) return 'van';
      if (/\b(PASSEIO|CARRO|CAR|SEDAN|HATCH|HATCHBACK|AUTOMOVEL|4W)\b/.test(type)) return 'passeio';
      if (/\b(MOTO|MOTOCICLETA|MOTORCYCLE|SCOOTER|2W)\b/.test(type)) return 'moto';
    }
    return '';
  }

  function isVisible() {
    return state.demo ? demoVisible : realVisible;
  }

  function syncControl() {
    input.checked = isVisible();
    control.classList.toggle('is-enabled', input.checked);
    control.title = input.checked ? 'Ocultar imagens dos veículos' : 'Exibir imagens dos veículos';
    input.setAttribute('aria-label', control.title);
  }

  const baseRenderDockCard = renderDockCard;
  renderDockCard = function renderDockCardWithVehicle(dock, ...args) {
    const card = baseRenderDockCard.call(this, dock, ...args);
    syncControl();
    if (!isVisible()) return card;
    const type = vehicleType(dock);
    if (!type) return card;
    const art = '<span class="dock-vehicle-art vehicle-' + type +
      '" title="' + TYPE_LABELS[type] + '" aria-hidden="true"></span>';
    return card.replace(/(<article\b[^>]*\bdock-card\b[^>]*>)/, '$1' + art);
  };

  input.addEventListener('change', () => {
    if (state.demo) {
      demoVisible = input.checked;
    } else {
      realVisible = input.checked;
      try {
        localStorage.setItem(STORAGE_KEY, String(realVisible));
      } catch {}
    }
    syncControl();
    renderDockGroups();
  });

  const baseLoadDemoData = loadDemoData;
  loadDemoData = function loadDemoDataWithVehicles(...args) {
    demoVisible = true;
    const result = baseLoadDemoData.apply(this, args);
    syncControl();
    return result;
  };

  syncControl();
})();
