(() => {
  const STORAGE_KEY = 'spxDockFlowShowVehiclesV1';
  const TYPE_LABELS = Object.freeze({
    moto: 'ZOF-MOTO-AR',
    passeio: 'ZOF-PASSEIO-AR',
    fiorino: 'ZOF-FIORINO-AR',
    van: 'ZOF-VAN-AR'
  });

  let realVisible = true;
  let demoVisible = true;

  try {
    const savedVisibility = localStorage.getItem(STORAGE_KEY);
    if (savedVisibility !== null) realVisible = savedVisibility === 'true';
  } catch {}

  const input = document.getElementById('vehicleVisibilityToggle');
  const control = document.getElementById('vehicleVisibilityControl');
  if (!input || !control) return;

  function installVehicleLayer() {
    const VEHICLE_PATTERNS = [
      ['fiorino', /\b(FIORINO)\b/],
      ['van', /\b(VAN|FURGAO|SPRINTER|MASTER|DUCATO)\b/],
      ['passeio', /\b(PASSEIO|CARRO|CAR|SEDAN|HATCH|HATCHBACK|AUTOMOVEL|4W)\b/],
      ['moto', /\b(MOTO|MOTOCICLETA|MOTORCYCLE|SCOOTER|2W)\b/]
    ];

  function normalizeType(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[_-]+/g, ' ').trim();
  }

  function vehicleType(dock) {
    const occupied = isDockOccupied(dock);
    const nextDriver = occupied ? null : getNextDriver(dock);
    const status = getDisplayStatus(dock, nextDriver).key;
    if (status !== 'occupied' && status !== 'next') return '';
    const driverId = Number(occupied ? dock?.occupied_driver_id : nextDriver?.driver_id) || 0;
    const route = driverId ? state.driverRoutes[driverId] : null;
    const detail = route?.ok === true ? route.details : null;
    // A vacant dock may retain fields from its previous vehicle. Only use the called driver.
    const vehicle = occupied ? dock : nextDriver;
    const candidates = [
      detail?.vehicle_type_name, detail?.vehicle_category_name,
      detail?.planned_vehicle_type, detail?.vehicle_name, detail?.vehicle_type,
      detail?.vehicle_category, detail?.vehicle?.type_name, detail?.vehicle?.type,
      vehicle?.vehicle_type_name, vehicle?.vehicle_category_name,
      vehicle?.planned_vehicle_type, vehicle?.vehicle_name, vehicle?.vehicle_type
    ];

    for (const raw of candidates) {
      const type = normalizeType(raw);
      if (!type) continue;
      for (const [vehicle, pattern] of VEHICLE_PATTERNS) {
        if (pattern.test(type)) return vehicle;
      }
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
    if (!isVisible()) return card;
    const type = vehicleType(dock);
    if (!type) return card;
    const art = '<span class="dock-vehicle-art vehicle-' + type +
      '" title="' + TYPE_LABELS[type] + '" aria-hidden="true"></span>';
    return card.replace(/(<article\b[^>]*\bdock-card\b[^>]*>)/,
      opening => opening.replace(/\bdock-card\b/, 'dock-card has-vehicle-art') + art);
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installVehicleLayer, { once: true });
  } else {
    installVehicleLayer();
  }
})();
