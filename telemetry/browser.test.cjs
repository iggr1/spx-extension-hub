const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
const endpoint = 'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec';
const server = http.createServer((request, response) => {
 let file = path.join(root, new URL(request.url, 'http://localhost').pathname);
 if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
 response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' })[path.extname(file)] || 'text/plain');
 fs.readFile(file, (error, data) => { response.statusCode = error ? 404 : 200; response.end(error ? 'Not found' : data); });
});
(async () => {
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; const posts = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/shared/loader-bridge.js', route => route.fulfill({ contentType: 'text/javascript', body: `
   window.testScenario='analyst';
   window.LoaderBridge={
    async request(operation){ if(operation==='loader.info')return {ok:true,version:'1.2.1'};return {ok:true,catalog:${JSON.stringify(catalog)}}; },
    async requestForModule(moduleId,operation,payload){
     if(operation==='network.fetchBatch'){
      if(window.testScenario==='offline')return {ok:false,results:{account:{ok:false}}};
      const url=payload.requests[0].url; const key=payload.requests[0].key;
      let data=url.includes('basic_info')?{id:123,name:window.testScenario==='xss'?'<img src=x onerror="window.xss=1">':'Conta de teste',email:window.testScenario==='operator'?'[ops123]Operador':'test@shopee.com'}:
       url.includes('station_list')?{current_station_id:5264,station_list:[{station_id:1,station_name:'Outro HUB'},{station_id:5264,station_name:'HUB de teste'}]}:
       {perm_list:[{perm_alias:window.testScenario==='operator'?[]:['RESOLVE_EO','CANCEL_EO_REASON']}]};
      return {ok:true,results:{[key]:{ok:window.testScenario!=='unknown'||!url.includes('user_permission_info'),data:{retcode:0,data}}}};
     }
     return {ok:true,enabled:operation==='userscripts.setEnabled'?payload.enabled:false,registered:true};
    },openModule(id){window.openedModule=id;}
   };` }));
  await page.route('**/launcher/usage-config.json', route => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ enabled: true, endpoint }) }));
  await page.route(endpoint, async route => {
   const body = route.request().postDataJSON(); posts.push(body);
   await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, accepted: body.events.map(event => event.key) }) });
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/launcher/');
  await page.waitForSelector('#accountButton[data-state="ready"]');
  await page.locator('#accountButton').click();
  assert.equal(await page.locator('#accountRole').textContent(), 'Analista');
  assert.equal(await page.locator('#accountHub').textContent(), 'HUB de teste');
  assert.equal(await page.locator('.module-card').count(), 3);
  await page.screenshot({ path: process.env.SPX_PROFILE_PREVIEW || '/tmp/spx-account-profile.png' });
  await page.keyboard.press('Escape'); assert(await page.locator('#accountPanel').isHidden());
  for (const [scenario, role] of [['operator', 'Operador'], ['unknown', 'Não identificado'], ['xss', 'Analista']]) {
   await page.evaluate(value => { window.testScenario = value; }, scenario);
   await page.locator('#refreshButton').click(); await page.waitForSelector('#accountButton[data-state="ready"]');
   assert.equal(await page.locator('#accountRole').textContent(), role);
  }
  assert.equal(await page.evaluate(() => window.xss), undefined);
  assert.equal(await page.locator('#accountName img').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#accountButton').click();
  const panel = await page.locator('#accountPanel').boundingBox();
  assert(panel.x >= 0 && panel.x + panel.width <= 390);
  await page.evaluate(() => { window.testScenario = 'offline'; });
  await page.locator('#refreshButton').click(); await page.waitForSelector('#accountButton[data-state="error"]');
  assert(await page.locator('#accountDetails').isHidden());
  assert.equal(await page.locator('.module-card').count(), 3);
  assert.deepEqual(errors, []);
  assert(posts.length > 0); assert(posts.flatMap(body => body.events).some(event => event.hubId === '5264' && event.userId === '123'));
  console.log('Perfil: analista, operador, permissões indisponíveis, sessão ausente, escape de HTML e layout móvel aprovados.');
  console.log('Envio: integração com endpoint simulado confirmou apenas campos de identidade e uso.');
  await page.route('https://spx.shopee.com.br/**', route => {
   const url = route.request().url();
   if (!url.includes('/api/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>SPX sintético de teste</title>' });
   const data = url.includes('basic_info') ? { id: 123, name: 'Conta de teste', email: 'test@shopee.com' } : url.includes('station_list') ? { current_station_id: 5264, station_list: [{ station_id: 5264, station_name: 'HUB de teste' }] } : { perm_list: [{ perm_alias: ['RESOLVE_EO', 'CANCEL_EO_REASON'] }] };
   return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ retcode: 0, data }) });
  });
  await page.goto('https://spx.shopee.com.br/__usage_test__');
  const agentResponse = page.waitForResponse(endpoint);
  const code = fs.readFileSync(path.join(root, 'shared/hub-usage.js'), 'utf8') + '\nSpxHubUsage.startSpxAgent("spx-dock-flow-autoadd","1.2.10"); SpxHubUsage.startSpxAgent("assistente-de-devolucoes","3.0.4");';
  await page.addScriptTag({ content: code });
  await agentResponse;
  assert.equal(await page.evaluate(() => window.__spxHubUsageAgentV1.modules.size), 2);
  assert(posts.flatMap(body => body.events).some(event => event.moduleId === 'spx-dock-flow-autoadd' && event.events.includes('module_active')));
  assert.deepEqual(errors, []);
  console.log('Agentes: ambos os assistentes iniciam na página SPX sintética sem reabrir o catálogo.');
 } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exit(1); });
