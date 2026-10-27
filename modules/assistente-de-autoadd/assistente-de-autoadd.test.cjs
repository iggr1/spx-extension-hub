'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'assistente-de-autoadd.js'), 'utf8');
function sourceBetween(first, last) {
  const start = source.indexOf(first);
  const end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start, 'Funções do assistente devem estar presentes');
  return source.slice(start, end);
}
const { classifyAutoAddHistory } = vm.runInNewContext(
  sourceBetween('  function previousAutoAddOnHold(events, originIndex) {',
    '  function flattenOverviewTracking(list) {') +
  '\n({ classifyAutoAddHistory })', { Intl, Date }
);
const { overviewMissingBatchCounts } = vm.runInNewContext(
  sourceBetween('  function overviewMissingBatchCounts(rows) {',
    '  function downloadOverviewMissing(doc, vt, rows, format) {') +
  '\n({ overviewMissingBatchCounts })'
);

const AT = 'AT20261026ORIGEM';
const NEXT = 'AT20261027NOVA';
const stamp = iso => Date.parse(iso) / 1000;
const evt = (status, iso, message, operator = 'operador') => ({
  status, timestamp: stamp(iso), message, operator, station_id: 5264
});

function history({ withOnHold = true, newAt = null, confirmation = true,
  departure = null, repeated = false } = {}) {
  const events = [];
  if (withOnHold) events.push(evt(5, '2026-10-25T09:00:00-03:00', 'Pedido em espera: [Cliente Ausente]'));
  events.push(evt(1, '2026-10-26T06:59:59-03:00', 'Pedido chegou ao Last Mile Hub'));
  events.push(evt(49, '2026-10-26T07:00:00-03:00',
    'Pedido em processamento na Assignment Task [' + AT + ']', 'Admin(Polygon Auto Add)'));
  events.push(evt(581, '2026-10-26T07:10:00-03:00', 'Order marked as missing'));
  if (repeated) events.push(evt(581, '2026-10-26T08:00:00-03:00', 'Order marked as missing'));
  if (newAt) {
    events.push(evt(49, '2026-10-26T10:00:00-03:00',
      'Pedido em processamento na Assignment Task [' + newAt + ']', 'Admin(Dynamic Routing)'));
    if (confirmation) events.push(evt(50, departure || '2026-10-27T06:00:00-03:00',
      'Pedido adicionado à Assignment Task [' + newAt + ']'));
  }
  if (departure) events.push(evt(2,
    newAt && confirmation ? new Date(stamp(departure) * 1000 + 30000).toISOString() : departure,
    'Pedido em processo de entrega'));
  return events;
}
const classify = args => classifyAutoAddHistory(history(args), AT);

test('Missing sem qualquer AT posterior não implica falha de gaiola', () => {
  const result = classify();
  assert.equal(result.code, 'MISSING_SEM_DESFECHO');
  assert.equal(result.origin, 'Retorno de On Hold');
  assert.equal(result.physicalCause, 'Não comprovada pelo histórico');
  assert.equal(result.physicalCauseConfidence, 'unknown');
});

test('Missing após recebimento comum não é classificado como erro de separação sem evidência', () => {
  const result = classify({ withOnHold: false });
  assert.equal(result.code, 'MISSING_SEM_DESFECHO');
  assert.equal(result.origin, 'Recebimento sem On Hold associado');
});

test('Saída em outra AT no mesmo dia é classificada como D0', () => {
  const result = classify({ newAt: NEXT, departure: '2026-10-26T12:00:00-03:00' });
  assert.equal(result.code, 'MISSING_REPLANEJADO_D0');
  assert.equal(result.destinationAt, NEXT);
  assert.equal(result.confidence, 'confirmed');
});

test('Saída em outra AT no dia seguinte é classificada como D+1', () => {
  const result = classify({ newAt: NEXT, departure: '2026-10-27T06:00:00-03:00' });
  assert.equal(result.code, 'MISSING_REPLANEJADO_D1');
  assert.equal(result.resolutionEvent.status, 2);
});

test('Mesmo AT: Missing seguido por status 50 e saída não é falha comprovada de gaiola', () => {
  const result = classify({ newAt: AT, departure: '2026-10-26T07:15:00-03:00' });
  assert.equal(result.code, 'MISSING_RECUPERADO_MESMA_AT');
  assert.equal(result.destinationAt, '');
});

test('Replanejamento sem status 50 ou saída registrada não é tratado como expedido', () => {
  const result = classify({ newAt: NEXT, confirmation: false });
  assert.equal(result.code, 'MISSING_OUTRA_AT_SEM_SAIDA');
  assert.match(result.outcome, /Planejado/);
});

test('Status 50 isolado não equivale a saída para entrega', () => {
  const result = classify({ newAt: AT });
  assert.equal(result.code, 'MISSING_REGULARIZADO_SEM_SAIDA');
});

test('Missing reincidente fica explícito mesmo com saída posterior', () => {
  const result = classify({ newAt: NEXT, repeated: true, departure: '2026-10-27T06:00:00-03:00' });
  assert.equal(result.missingCount, 2);
  assert.equal(result.code, 'MISSING_REPLANEJADO_D1');
});

test('Sem confirmação de nova AT, saída posterior não prova AT de origem nem destino', () => {
  const result = classify({ departure: '2026-10-26T12:00:00-03:00' });
  assert.equal(result.code, 'MISSING_SAIDA_SEM_AT');
});

test('Missing simultâneo agrupa somente registros com mesma AT e mesmo segundo', () => {
  const original = { code: 'MISSING_REPLANEJADO_D1', evidenceEvent: { status: 581, timestamp: 100 } };
  const rows = [
    { at: AT, state: original },
    { at: AT, state: { ...original } },
    { at: NEXT, state: original },
    { at: AT, state: { ...original, evidenceEvent: { status: 581, timestamp: 101 } } },
    { at: AT, state: { code: 'CAPACIDADE', evidenceEvent: { status: 650, timestamp: 100 } } }
  ];
  overviewMissingBatchCounts(rows);
  assert.deepEqual(rows.map(item => item.missingBatchCount), [2, 2, 1, 1, 0]);
});
