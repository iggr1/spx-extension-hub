const AUTH_TABLES = {
  USUARIOS: ['usuario_id', 'email', 'nome', 'status', 'criado_em', 'ultimo_login'],
  MODULOS: ['modulo_id', 'nome', 'restrito'],
  PERMISSOES: ['email', 'modulo_id', 'modulo', 'status', 'alterado_em', 'alterado_por'],
  SESSOES: ['token_hash', 'email', 'expira_em']
};
const AUTH_MODULES = [
  ['spx-dock-flow', 'SPX Dock Flow', 'NAO'],
  ['assistente-de-devolucoes', 'Assistente de devoluções', 'SIM']
];
const CODE_SECONDS = 600;
const SESSION_SECONDS = 28800;

function instalarAutenticacao() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Abra este projeto pela planilha: Extensões > Apps Script.');
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty('SPREADSHEET_ID', book.getId());
  if (!properties.getProperty('AUTH_SECRET')) {
    properties.setProperty('AUTH_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  Object.keys(AUTH_TABLES).forEach(name => {
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    const headers = AUTH_TABLES[name];
    if (!sheet.getLastRow()) sheet.appendRow(headers);
    if (JSON.stringify(sheet.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers)) {
      throw new Error('Cabeçalhos incompatíveis na aba ' + name + '. Use uma planilha exclusiva.');
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setBackground('#ee4d2d').setFontColor('#ffffff').setFontWeight('bold');
    sheet.autoResizeColumns(1, headers.length);
  });
  const modules = book.getSheetByName('MODULOS');
  const existing = rows_(modules).map(row => String(row[0]));
  AUTH_MODULES.forEach(row => { if (!existing.includes(row[0])) modules.appendRow(row); });
  setValidation_(book.getSheetByName('USUARIOS'), 4, ['ATIVO', 'BLOQUEADO']);
  setValidation_(modules, 3, ['SIM', 'NAO']);
  setValidation_(book.getSheetByName('PERMISSOES'), 4, ['PENDENTE', 'APROVADO', 'NEGADO']);
  book.getSheetByName('SESSOES').hideSheet();
  // Requests MailApp authorization at installation, without sending an email.
  MailApp.getRemainingDailyQuota();
}

function setValidation_(sheet, column, values) {
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  sheet.getRange(2, column, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

function onEdit(event) {
  const range = event && event.range;
  if (!range || range.getSheet().getName() !== 'PERMISSOES' || range.getRow() < 2 ||
      range.getColumn() > 4 || range.getLastColumn() < 4) return;
  const count = range.getNumRows();
  const editor = Session.getActiveUser().getEmail() || '';
  range.getSheet().getRange(range.getRow(), 5, count, 2)
    .setValues(Array.from({ length: count }, () => [new Date(), editor]));
}

function doGet() {
  return json_({ ok: true, service: 'SPX Hub Authentication', version: '1.0.0' });
}

function doPost(event) {
  let lock;
  try {
    const contents = event && event.postData && event.postData.contents || '';
    if (!contents || contents.length > 4096) fail_('INVALID_REQUEST', 'Solicitação inválida.');
    let body;
    try { body = JSON.parse(contents); } catch (_) { fail_('INVALID_REQUEST', 'Solicitação inválida.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail_('INVALID_REQUEST', 'Solicitação inválida.');
    const allowed = ['policy', 'request_code', 'verify_code', 'session', 'logout'];
    if (!allowed.includes(body.action)) fail_('INVALID_REQUEST', 'Operação inválida.');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) fail_('BUSY', 'Aguarde alguns segundos e tente novamente.');
    const book = book_();
    let result;
    if (body.action === 'policy') result = { modules: policies_(book) };
    if (body.action === 'request_code') result = requestCode_(book, body);
    if (body.action === 'verify_code') result = verifyCode_(book, body);
    if (body.action === 'session') result = session_(book, body.token);
    if (body.action === 'logout') result = logout_(book, body.token);
    return json_(Object.assign({ ok: true }, result));
  } catch (error) {
    return json_({
      ok: false,
      code: error.publicCode || 'SERVICE_ERROR',
      error: error.publicCode ? error.message : 'Serviço indisponível. Confira a configuração do Apps Script.'
    });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function requestCode_(book, body) {
  const email = email_(body.email);
  const domainSetting = PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAIL_DOMAINS') || '';
  const domains = domainSetting.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (domains.length && !domains.includes(email.split('@')[1])) fail_('EMAIL_DOMAIN', 'Use um e-mail de um domínio permitido.');
  const cache = CacheService.getScriptCache();
  const key = digest_('email:' + email);
  const now = Date.now();
  const rateKey = 'rate:' + key;
  const rate = JSON.parse(cache.get(rateKey) || '{"count":0,"last":0,"until":0}');
  if (rate.until < now) { rate.count = 0; rate.until = now + 3600000; }
  if (now - rate.last < 60000) fail_('RATE_LIMIT', 'Aguarde 60 segundos antes de pedir outro código.');
  if (rate.count >= 3) fail_('RATE_LIMIT', 'Limite de três códigos por hora para este e-mail.');
  const properties = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  const daily = JSON.parse(properties.getProperty('DAILY_EMAIL_COUNT') || '{}');
  const count = daily.day === day ? Number(daily.count || 0) : 0;
  if (count >= 100 || MailApp.getRemainingDailyQuota() < 1) fail_('RATE_LIMIT', 'Envio de códigos indisponível no momento. Tente mais tarde.');
  const nonce = Utilities.getUuid();
  const hex = digest_('code-random:' + nonce + ':' + now);
  const code = String(parseInt(hex.slice(0, 8), 16) % 1000000).padStart(6, '0');
  const record = { hash: digest_('code:' + email + ':' + code), expires: now + CODE_SECONDS * 1000, attempts: 0 };
  rate.count += 1;
  rate.last = now;
  cache.put(rateKey, JSON.stringify(rate), Math.max(1, Math.ceil((rate.until - now) / 1000)));
  properties.setProperty('DAILY_EMAIL_COUNT', JSON.stringify({ day: day, count: count + 1 }));
  cache.put('otp:' + key, JSON.stringify(record), CODE_SECONDS);
  try {
    MailApp.sendEmail({
      to: email,
      subject: code + ' — seu código de acesso ao SPX Hub',
      body: 'Seu código de acesso ao SPX Extension Hub é: ' + code +
        '\n\nEle expira em 10 minutos e só pode ser usado uma vez.' +
        '\nNão compartilhe este código. Se você não solicitou o acesso, ignore este e-mail.',
      name: 'SPX Extension Hub'
    });
  } catch (_) {
    cache.remove('otp:' + key);
    fail_('MAIL_FAILED', 'Não foi possível enviar o código. Aguarde um minuto e tente novamente.');
  }
  return { expiresIn: CODE_SECONDS, retryAfter: 60 };
}

function verifyCode_(book, body) {
  const email = email_(body.email);
  const code = String(body.code || '').trim();
  if (!/^\d{6}$/.test(code)) fail_('INVALID_CODE', 'Informe o código de seis dígitos.');
  const cache = CacheService.getScriptCache();
  const key = 'otp:' + digest_('email:' + email);
  const raw = cache.get(key);
  if (!raw) fail_('INVALID_CODE', 'Código inválido ou expirado. Solicite um novo código.');
  const record = JSON.parse(raw);
  if (record.expires <= Date.now() || record.attempts >= 5) {
    cache.remove(key);
    fail_('INVALID_CODE', 'Código inválido ou expirado. Solicite um novo código.');
  }
  record.attempts += 1;
  if (!equal_(record.hash, digest_('code:' + email + ':' + code))) {
    if (record.attempts >= 5) cache.remove(key);
    else cache.put(key, JSON.stringify(record), Math.max(1, Math.ceil((record.expires - Date.now()) / 1000)));
    fail_('INVALID_CODE', 'Código inválido ou expirado.');
  }
  cache.remove(key);
  const users = book.getSheetByName('USUARIOS');
  const data = rows_(users);
  const matches = data.map((row, index) => ({ row: row, index: index })).filter(item => normalizeEmail_(item.row[1]) === email);
  if (matches.length > 1) fail_('ACCOUNT_BLOCKED', 'Cadastro duplicado. Solicite a revisão do administrador.');
  if (matches.length) {
    if (String(matches[0].row[3]).toUpperCase() !== 'ATIVO') fail_('ACCOUNT_BLOCKED', 'Seu usuário está bloqueado. Contate o responsável.');
    users.getRange(matches[0].index + 2, 6).setValue(new Date());
  } else {
    users.appendRow([Utilities.getUuid(), email, safeCell_(String(body.name || '').trim().slice(0, 100)), 'ATIVO', new Date(), new Date()]);
  }
  ensurePermissions_(book, email);
  cleanSessions_(book);
  const token = digest_('session-random:' + Utilities.getUuid() + Utilities.getUuid() + Date.now());
  const expires = Date.now() + SESSION_SECONDS * 1000;
  book.getSheetByName('SESSOES').appendRow([digest_('session:' + token), email, new Date(expires)]);
  return Object.assign({ token: token }, access_(book, email, expires));
}

function ensurePermissions_(book, email) {
  const sheet = book.getSheetByName('PERMISSOES');
  const existing = rows_(sheet).filter(row => normalizeEmail_(row[0]) === email).map(row => String(row[1]));
  policies_(book).forEach(module => {
    if (!existing.includes(module.id)) sheet.appendRow([email, module.id, module.name, 'PENDENTE', new Date(), '']);
  });
}

function session_(book, token) {
  const session = findSession_(book, token);
  ensurePermissions_(book, session.email);
  return access_(book, session.email, session.expires);
}

function findSession_(book, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail_('SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.');
  const hash = digest_('session:' + token);
  const sessions = rows_(book.getSheetByName('SESSOES'));
  const index = sessions.findIndex(row => equal_(String(row[0]), hash));
  const row = sessions[index];
  const expires = row ? new Date(row[2]).getTime() : 0;
  if (!row || !Number.isFinite(expires) || expires <= Date.now()) fail_('SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.');
  return { index: index + 2, email: normalizeEmail_(row[1]), expires: expires };
}

function logout_(book, token) {
  try {
    const session = findSession_(book, token);
    book.getSheetByName('SESSOES').deleteRow(session.index);
  } catch (error) {
    if (error.publicCode !== 'SESSION_EXPIRED') throw error;
  }
  return {};
}

function access_(book, email, expires) {
  const users = rows_(book.getSheetByName('USUARIOS')).filter(row => normalizeEmail_(row[1]) === email);
  if (users.length !== 1 || String(users[0][3]).toUpperCase() !== 'ATIVO') fail_('ACCOUNT_BLOCKED', 'Seu usuário está bloqueado. Contate o responsável.');
  const permissions = rows_(book.getSheetByName('PERMISSOES')).filter(row => normalizeEmail_(row[0]) === email);
  return {
    user: { email: email, name: String(users[0][2] || '').replace(/^'/, '') },
    expiresAt: expires,
    modules: policies_(book).map(module => {
      const entries = permissions.filter(row => String(row[1]) === module.id);
      // Duplicate/unknown statuses never grant access.
      const status = entries.length === 1 ? String(entries[0][3]).trim().toUpperCase() : 'PENDENTE';
      return Object.assign({}, module, {
        status: module.restricted ? (['APROVADO', 'NEGADO'].includes(status) ? status : 'PENDENTE') : 'LIVRE',
        allowed: !module.restricted || (entries.length === 1 && status === 'APROVADO')
      });
    })
  };
}

function policies_(book) {
  const data = rows_(book.getSheetByName('MODULOS'));
  const counts = {};
  data.forEach(row => { counts[String(row[0])] = (counts[String(row[0])] || 0) + 1; });
  return data.filter(row => /^[a-z0-9][a-z0-9-]{0,99}$/.test(String(row[0]))).map(row => ({
    id: String(row[0]),
    name: String(row[1] || row[0]),
    restricted: counts[String(row[0])] !== 1 || !['NAO', 'NÃO'].includes(String(row[2]).trim().toUpperCase())
  }));
}

function cleanSessions_(book) {
  const sheet = book.getSheetByName('SESSOES');
  const data = rows_(sheet);
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const expires = new Date(data[index][2]).getTime();
    if (!Number.isFinite(expires) || expires <= Date.now()) sheet.deleteRow(index + 2);
  }
}

function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) fail_('NOT_CONFIGURED', 'O administrador precisa executar instalarAutenticacao.');
  return SpreadsheetApp.openById(id);
}

function rows_(sheet) {
  if (!sheet) fail_('NOT_CONFIGURED', 'O administrador precisa executar instalarAutenticacao.');
  return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
}

function normalizeEmail_(value) { return String(value || '').trim().toLowerCase(); }

function email_(value) {
  const email = normalizeEmail_(value);
  if (email.length > 254 || !/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,63}$/.test(email)) fail_('INVALID_EMAIL', 'Informe um e-mail válido.');
  return email;
}

function digest_(value) {
  const secret = PropertiesService.getScriptProperties().getProperty('AUTH_SECRET');
  if (!secret) fail_('NOT_CONFIGURED', 'O administrador precisa executar instalarAutenticacao.');
  return Utilities.computeHmacSha256Signature(value, secret).map(byte => ('0' + (byte & 255).toString(16)).slice(-2)).join('');
}

function equal_(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function safeCell_(value) { return /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value; }

function fail_(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  throw error;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
