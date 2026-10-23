const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../..');
const server = http.createServer((request, response) => {
  let file = path.join(root, new URL(request.url, 'http://localhost').pathname);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' })[path.extname(file)] || 'text/plain');
  fs.readFile(file, (error, data) => { response.statusCode = error ? 404 : 200; response.end(error ? 'Not found' : data); });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('spxDockFlowChangelogSeenV1', '1.10.2'));
    await page.goto('http://127.0.0.1:' + server.address().port + '/modules/spx-dock-flow/');
    await page.evaluate(() => {
      state.demo = true;
      state.fetchedAt = Date.now();
      state.queueLoading = false;
      state.routesLoading = false;
      state.dockQueues = {};
      state.driverRoutes = {};
      state.docks = Array.from({ length: 8 }, (_, i) => ({ dock_id: i + 1, dock_name: 'Mesa ' + (i + 1), dock_active_status: 1, dock_status: 2 }));
      ['ZOF-MOTO-AR', 'ZOF-PASSEIO-AR', 'ZOF-FIORINO-AR', 'ZOF-VAN-AR'].forEach((type, i) => {
        const id = i + 1;
        state.dockQueues[id] = { items: [{ driver_id: 100 + id, driver_name: 'Próximo ' + id, queue_sequence: 2, waiting_time: 10 }] };
        state.driverRoutes[100 + id] = { ok: true, route: 'R' + id, details: { vehicle_type_name: type } };
      });
      // The image must follow the eligible called driver, including queue filtering.
      state.dockQueues[1].items.unshift({ driver_id: 999, queue_sequence: 1, is_blocked_by_dual_cage: 1 });
      state.driverRoutes[999] = { ok: true, details: { vehicle_type_name: 'VAN' } };
      Object.assign(state.docks[4], { dock_status: 1, occupied_driver_id: 105, occupied_vehicle_number: 'ABC1234' });
      state.driverRoutes[105] = { ok: true, route: 'R5', details: { vehicle_type_name: 'VAN' } };
      // Stale fields from a previous occupant must not label a vacant dock or the next route.
      state.docks[5].vehicle_type_name = 'VAN';
      state.docks[5].occupied_driver_id = 105;
      state.docks[6].vehicle_type_name = 'FIORINO';
      state.docks[6].occupied_driver_id = 105;
      state.dockQueues[7] = { items: [{ driver_id: 107, driver_name: 'Tipo desconhecido' }] };
      state.docks[7].dock_active_status = 0;
      state.dockQueues[8] = { items: [{ driver_id: 104 }] };
      renderDockGroups();
    });
    for (const [i, type] of ['moto', 'passeio', 'fiorino', 'van'].entries()) {
      const card = page.locator('[data-dock-id="' + (i + 1) + '"]');
      assert(await card.evaluate(element => element.classList.contains('next')));
      assert.equal(await card.locator('.vehicle-' + type).count(), 1);
      const art = await card.locator('.dock-vehicle-art').evaluate(async element => {
        const style = getComputedStyle(element);
        const image = new Image(); image.src = style.backgroundImage.slice(5, -2); await image.decode();
        const probe = document.createElement('span'); probe.style.color = style.getPropertyValue('--status-accent'); element.append(probe);
        const color = getComputedStyle(probe).color; probe.remove();
        return { opacity: style.opacity, filter: style.filter, color, width: image.naturalWidth };
      });
      assert.equal(art.opacity, '0.2');
      assert(art.filter.includes(art.color));
      assert.equal(art.width, 1448);
    }
    assert.equal(await page.locator('[data-dock-id="5"] .vehicle-van').count(), 1);
    for (const id of [6, 7, 8]) assert.equal(await page.locator('[data-dock-id="' + id + '"] .dock-vehicle-art').count(), 0);
    await page.locator('#vehicleVisibilityControl').click();
    assert.equal(await page.locator('#vehicleVisibilityToggle').isChecked(), false);
    assert.equal(await page.locator('.dock-vehicle-art').count(), 0);
    await page.locator('#vehicleVisibilityControl').click();
    assert.equal(await page.locator('#vehicleVisibilityToggle').isChecked(), true);
    assert.equal(await page.locator('.dock-vehicle-art').count(), 5);
    await page.evaluate(() => {
      state.driverRoutes[101].details.vehicle_type_name = 'FIORINO';
      renderDockGroups();
    });
    assert.equal(await page.locator('[data-dock-id="1"] .vehicle-fiorino').count(), 1);
    await page.evaluate(() => { state.dockQueues[1] = { items: [] }; renderDockGroups(); });
    assert.equal(await page.locator('[data-dock-id="1"] .dock-vehicle-art').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Veículos: próximos para carregar (4 tipos), fila elegível, doca ocupada, estados sem imagem, atualização da rota, contorno e visibilidade aprovados.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exit(1); });
