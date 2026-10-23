const SPX_USAGE = Object.freeze({
  spreadsheetProperty: 'SPX_USAGE_SPREADSHEET_ID',
  timeZone: 'America/Sao_Paulo',
  modules: ['launcher', 'spx-dock-flow', 'spx-dock-flow-autoadd', 'assistente-de-devolucoes'],
  roles: ['Analista', 'Operador', 'Não identificado'],
  events: ['catalog_open', 'catalog_active', 'module_open', 'module_active', 'module_enabled'],
  accessesHeaders: ['Chave', 'Data', 'ID HUB', 'HUB', 'ID usuário', 'Nome', 'E-mail', 'Login', 'Perfil de acesso', 'Ferramenta', 'Versão', 'Primeiro acesso', 'Último acesso', 'Eventos', 'Recebido em'],
  hubsHeaders: ['ID HUB', 'HUB', 'Primeiro acesso', 'Último acesso', 'Ferramentas']
});

function configurarColeta() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Abra este projeto pelo menu Extensões > Apps Script da planilha.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    PropertiesService.getScriptProperties().setProperty(SPX_USAGE.spreadsheetProperty, spreadsheet.getId());
    spreadsheet.setSpreadsheetTimeZone(SPX_USAGE.timeZone);
    const accesses = prepararAba_(spreadsheet, 'Acessos', SPX_USAGE.accessesHeaders);
    const hubs = prepararAba_(spreadsheet, 'Hubs', SPX_USAGE.hubsHeaders);
    accesses.hideColumns(1);
    accesses.getRange('L:M').setNumberFormat('dd/MM/yyyy HH:mm:ss');
    accesses.getRange('O:O').setNumberFormat('dd/MM/yyyy HH:mm:ss');
    hubs.getRange('C:D').setNumberFormat('dd/MM/yyyy HH:mm:ss');
    SpreadsheetApp.flush();
    return { ok: true, planilha: spreadsheet.getUrl(), abas: ['Acessos', 'Hubs'] };
  } finally { lock.releaseLock(); }
}

function prepararAba_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() > 0) {
    const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (existing.join('|') !== headers.join('|')) throw new Error('A aba ' + name + ' já existe com outras colunas. Renomeie a aba antes de configurar.');
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground('#ee4d2d').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (!sheet.getFilter()) sheet.getRange(1, 1, Math.max(2, sheet.getLastRow()), headers.length).createFilter();
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function doGet() {
  return json_({ ok: true, service: 'SPX Hub Usage', schemaVersion: 1 });
}

function doPost(e) {
  let lock = null;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || !raw || raw.length > 65536) throw new Error('Corpo da requisição inválido.');
    const payload = JSON.parse(raw);
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.events) || !payload.events.length || payload.events.length > 20) throw new Error('Lote inválido.');
    const receivedAt = new Date();
    const events = payload.events.map(event => validarEvento_(event, receivedAt));
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty(SPX_USAGE.spreadsheetProperty);
    if (!spreadsheetId) throw new Error('Execute configurarColeta na planilha antes de publicar o WebApp.');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json_({ ok: false, error: 'O registro está ocupado. Tente novamente.' });
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const accesses = spreadsheet.getSheetByName('Acessos');
    const hubs = spreadsheet.getSheetByName('Hubs');
    if (!accesses || !hubs) throw new Error('Execute configurarColeta para criar as abas.');
    const rows = lerLinhas_(accesses, SPX_USAGE.accessesHeaders.length);
    const hubRows = lerLinhas_(hubs, SPX_USAGE.hubsHeaders.length);
    const keys = new Map(rows.map((row, index) => [String(row[0]), index]));
    const hubKeys = new Map(hubRows.map((row, index) => [String(row[0]), index]));
    const changed = new Set();
    const changedHubs = new Set();
    for (const event of events) {
      const position = keys.has(event.key) ? keys.get(event.key) : rows.length;
      const previous = rows[position];
      const previousLast = previous ? new Date(previous[12]) : null;
      const current = !previousLast || event.lastSeen.getTime() >= previousLast.getTime();
      const first = previous ? new Date(Math.min(new Date(previous[11]).getTime(), event.firstSeen.getTime())) : event.firstSeen;
      const last = previousLast ? new Date(Math.max(previousLast.getTime(), event.lastSeen.getTime())) : event.lastSeen;
      const observed = [...new Set([...(previous ? String(previous[13]).split(', ') : []), ...event.events])].filter(Boolean).sort().join(', ');
      rows[position] = [event.key, event.day, event.hubId, seguro_(current ? event.hubName : previous[3]), event.userId,
        seguro_(current ? event.name : previous[5]), seguro_(current ? event.email : previous[6]), seguro_(current ? event.login : previous[7]),
        current ? event.role : previous[8], event.moduleId, seguro_(current ? event.version : previous[10]), first, last, observed, receivedAt];
      keys.set(event.key, position);
      changed.add(position);
      const hubPosition = hubKeys.has(event.hubId) ? hubKeys.get(event.hubId) : hubRows.length;
      const previousHub = hubRows[hubPosition];
      const hubFirst = previousHub ? new Date(Math.min(new Date(previousHub[2]).getTime(), first.getTime())) : first;
      const hubLast = previousHub ? new Date(Math.max(new Date(previousHub[3]).getTime(), last.getTime())) : last;
      const hubName = !previousHub || last.getTime() >= new Date(previousHub[3]).getTime() ? event.hubName : previousHub[1];
      const tools = [...new Set([...(previousHub ? String(previousHub[4]).split(', ') : []), event.moduleId])].filter(Boolean).sort().join(', ');
      hubRows[hubPosition] = [event.hubId, seguro_(hubName), hubFirst, hubLast, tools];
      hubKeys.set(event.hubId, hubPosition);
      changedHubs.add(hubPosition);
    }
    gravarLinhas_(accesses, rows, changed);
    gravarLinhas_(hubs, hubRows, changedHubs);
    SpreadsheetApp.flush();
    return json_({ ok: true, accepted: [...new Set(events.map(event => event.key))] });
  } catch (_) {
    return json_({ ok: false, error: 'Não foi possível registrar o uso. Confira a configuração do WebApp e o formato enviado.' });
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}

function lerLinhas_(sheet, width) {
  return sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues() : [];
}

function gravarLinhas_(sheet, rows, changed) {
  const positions = [...changed].sort((a, b) => a - b);
  for (let index = 0; index < positions.length;) {
    const start = positions[index];
    let end = start;
    while (index + 1 < positions.length && positions[index + 1] === end + 1) { index++; end++; }
    const needed = end + 2;
    if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    sheet.getRange(start + 2, 1, end - start + 1, rows[0].length).setValues(rows.slice(start, end + 1));
    index++;
  }
}

function validarEvento_(value, receivedAt) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Evento inválido.');
  const clean = (input, max) => typeof input === 'string' ? input.trim().slice(0, max || 200) : '';
  const positiveId = input => /^\d{1,18}$/.test(String(input)) && Number(input) > 0 ? String(input) : '';
  const firstSeen = new Date(value.firstSeen);
  const lastSeen = new Date(value.lastSeen);
  const oldest = receivedAt.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(firstSeen.getTime()) || !Number.isFinite(lastSeen.getTime()) || firstSeen > lastSeen || firstSeen.getTime() < oldest || lastSeen.getTime() > receivedAt.getTime() + 5 * 60 * 1000) throw new Error('Período inválido.');
  const day = Utilities.formatDate(firstSeen, SPX_USAGE.timeZone, 'yyyy-MM-dd');
  if (Utilities.formatDate(lastSeen, SPX_USAGE.timeZone, 'yyyy-MM-dd') !== day || value.day !== day) throw new Error('Dia inválido.');
  const hubId = positiveId(value.hubId);
  const userId = positiveId(value.userId);
  const moduleId = clean(value.moduleId, 80);
  const role = clean(value.role, 30);
  if (!hubId || !userId || !SPX_USAGE.modules.includes(moduleId) || !SPX_USAGE.roles.includes(role)) throw new Error('Identidade inválida.');
  if (!Array.isArray(value.events) || !value.events.length || value.events.length > 5 || value.events.some(event => !SPX_USAGE.events.includes(event))) throw new Error('Tipo de evento inválido.');
  const key = [day, hubId, userId, moduleId].join('|');
  if (value.key !== key) throw new Error('Chave inválida.');
  return { key, day, hubId, hubName: clean(value.hubName) || 'HUB ' + hubId, userId, name: clean(value.name), email: clean(value.email), login: clean(value.login), role, moduleId, version: clean(value.version, 40), firstSeen, lastSeen, events: [...new Set(value.events)] };
}

function seguro_(value) {
  const text = String(value == null ? '' : value).slice(0, 250);
  return /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
