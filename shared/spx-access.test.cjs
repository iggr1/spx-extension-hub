const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'spx-access.js'), 'utf8');
const { evaluateSpxAccess, createSpxAccessChecker } = new Function(source + ';return {evaluateSpxAccess,createSpxAccessChecker};')();
const basic = { retcode: 0, data: { id: 123, email: 'person@shopee.com' } };
const permissions = { retcode: 0, data: { perm_list: [{ perm_alias: ['RESOLVE_EO'] }, { perm_alias: ['CANCEL_EO_REASON'] }] } };
async function main() {
  assert.equal(evaluateSpxAccess(basic, permissions).allowed, true);
  for (const email of ['ops123', '[Ops123]Name', 'person@gmail.com', 'person@shopee.com.evil.test', 'a@@shopee.com', '.a@shopee.com', 'a..b@shopee.com', 'a b@shopee.com', '']) {
    assert.equal(evaluateSpxAccess({ ...basic, data: { ...basic.data, email } }, permissions).allowed, false, email);
  }
  for (const aliases of [[], ['RESOLVE_EO'], ['CANCEL_EO_REASON'], ['HUB_RESOLVE_EO', 'AM_HUB_RESOLVE_EO']]) {
    assert.equal(evaluateSpxAccess(basic, { retcode: 0, data: { perm_list: [{ perm_alias: aliases }] } }).allowed, false);
  }
  for (const bad of [null, {}, { retcode: 1, data: basic.data }]) assert.equal(evaluateSpxAccess(bad, permissions).allowed, false);
  assert.equal(evaluateSpxAccess(basic, { retcode: 0, data: {} }).allowed, false);
  let fingerprint = 'account-a', calls = 0;
  const checker = createSpxAccessChecker(async url => { calls++; return url.endsWith('basic_info') ? basic : permissions; }, () => fingerprint);
  assert.equal((await checker.check()).allowed, true);
  assert.equal(calls, 3);
  await checker.check(); assert.equal(calls, 3);
  fingerprint = 'account-b'; await checker.check(); assert.equal(calls, 6);
  await Promise.all([checker.check(true), checker.check(true)]); assert.equal(calls, 9);
  let reads = 0;
  const changed = createSpxAccessChecker(async url => {
    reads++; return url.endsWith('user_permission_info') ? permissions : reads === 1 ? basic : { ...basic, data: { ...basic.data, id: 456 } };
  });
  assert.equal((await changed.check()).allowed, false);
  const failed = createSpxAccessChecker(async () => { throw new Error('offline'); });
  assert.equal((await failed.check()).allowed, false);
  const runtime = fs.readFileSync(path.join(__dirname, '../modules/assistente-de-devolucoes/assistente-de-devolucoes.js'), 'utf8');
  assert(runtime.includes(source), 'Catalog and runtime must embed exactly the same policy');
  console.log('SPX access checks passed: corporate domain, both permissions, errors, account changes, cache, concurrent checks and policy parity.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
