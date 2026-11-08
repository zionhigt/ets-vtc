import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toNumber,
  slimSnapshot,
  recordToEvent,
  normalizeEventType,
  deterministicEventId,
  safeStringify,
  EVENT_ID_PATTERN,
  MAX_EVENT_DATA_BYTES,
} from '../src/index.js';

const fixture = readFileSync(new URL('./fixtures/convoy-session.ndjson', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

test('toNumber convertit les BigInt et les BigInt sérialisés', () => {
  assert.equal(toNumber(12n), 12);
  assert.equal(toNumber('968'), 968);
  assert.equal(toNumber('-3.5'), -3.5);
  assert.equal(toNumber('abc'), 'abc');
  assert.equal(toNumber(4.2), 4.2);
});

test('normalizeEventType retire le préfixe du logger', () => {
  assert.equal(normalizeEventType('event:job-delivered'), 'job-delivered');
  assert.equal(normalizeEventType('snapshot'), 'snapshot');
});

test('deterministicEventId est stable et respecte le format', () => {
  const a = deterministicEventId('session.ndjson', 3);
  assert.equal(a, deterministicEventId('session.ndjson', 3));
  assert.notEqual(a, deterministicEventId('session.ndjson', 4));
  assert.match(a, EVENT_ID_PATTERN);
});

test('slimSnapshot réduit un snapshot réel sous la limite par événement', () => {
  const raw = fixture.find((r) => r.type === 'snapshot');
  assert.ok(safeStringify(raw.data).length > MAX_EVENT_DATA_BYTES / 2, 'le snapshot brut doit être volumineux');
  const slim = slimSnapshot(raw.data);
  assert.equal(typeof slim.coordinateX, 'number');
  assert.equal(typeof slim.timeAbs, 'number');
  assert.equal(typeof slim.multiplayerTimeOffset, 'number');
  assert.ok(safeStringify(slim).length < 2048);
});

test('recordToEvent convertit les lignes du logger et ignore les erreurs', () => {
  const delivered = fixture.find((r) => r.type === 'event:job-delivered');
  const ev = recordToEvent(delivered, { source: 'f', index: 7 });
  assert.equal(ev.type, 'job-delivered');
  assert.equal(ev.seq, 7);
  assert.equal(ev.data.jobDeliveredRevenue, '968');
  assert.equal(recordToEvent({ ts: 1, type: 'error', data: 'x' }, { source: 'f', index: 0 }), null);
  const snap = fixture.find((r) => r.type === 'snapshot');
  assert.equal(recordToEvent(snap, { source: 'f', index: 1, snapshots: 'skip' }), null);
});

test('la fixture contient une livraison complète', () => {
  const types = new Set(fixture.map((r) => r.type));
  for (const t of ['event:job-started', 'event:job-delivered', 'event:fine', 'snapshot']) {
    assert.ok(types.has(t), `type manquant : ${t}`);
  }
});

test('safeStringify accepte les BigInt', () => {
  assert.equal(safeStringify({ a: 10n }), '{"a":"10"}');
});
