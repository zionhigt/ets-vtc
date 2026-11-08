import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startTestServer } from './helpers.js';
import { replay } from '../../../tools/replay-ndjson.js';

const fixture = fileURLToPath(new URL('../../../packages/shared/test/fixtures/convoy-session.ndjson', import.meta.url));
const fixtureLines = readFileSync(fixture, 'utf8').trim().split('\n');

let t;
let admin;
before(async () => {
  t = await startTestServer();
  admin = (await t.login(t.adminToken)).accessToken;
});
after(() => t.close());

async function newDriver(username) {
  const { body } = await t.call('POST', '/admin/users', { token: admin, body: { username, displayName: username } });
  return { ...body, session: await t.login(body.personalToken) };
}

const ev = (id, extra = {}) => ({ id, ts: 1794129319912, type: 'gear-change', data: { gear: 3 }, ...extra });

test("l'ingestion est idempotente, y compris à l'intérieur d'un lot", async () => {
  const d = await newDriver('idem');
  const token = d.session.accessToken;
  const r1 = await t.call('POST', '/telemetry/events', {
    token,
    body: { events: [ev('evt-aaaaaaa1'), ev('evt-aaaaaaa2'), ev('evt-aaaaaaa1')] },
  });
  assert.deepEqual(r1.body, { received: 3, accepted: 2, duplicates: 1 });
  const r2 = await t.call('POST', '/telemetry/events', { token, body: { events: [ev('evt-aaaaaaa2'), ev('evt-aaaaaaa3')] } });
  assert.deepEqual(r2.body, { received: 2, accepted: 1, duplicates: 1 });
});

test('les ids sont propres à chaque chauffeur', async () => {
  const a = await newDriver('chauffeur-a');
  const b = await newDriver('chauffeur-b');
  const body = { events: [ev('evt-shared01')] };
  assert.equal((await t.call('POST', '/telemetry/events', { token: a.session.accessToken, body })).body.accepted, 1);
  assert.equal((await t.call('POST', '/telemetry/events', { token: b.session.accessToken, body })).body.accepted, 1);
});

test('les lots invalides sont refusés', async () => {
  const d = await newDriver('invalide');
  const token = d.session.accessToken;
  const cases = [
    { events: [] },
    { events: [ev('court')] },
    { events: [ev('evt-bbbbbbb1', { ts: 'hier' })] },
    { events: Array.from({ length: 501 }, (_, i) => ev(`evt-bulk${String(i).padStart(4, '0')}`)) },
    { events: [ev('evt-bbbbbbb2', { data: { blob: 'x'.repeat(70_000) } })] },
  ];
  for (const body of cases) {
    const r = await t.call('POST', '/telemetry/events', { token, body });
    assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 200));
  }
  assert.equal((await t.call('POST', '/telemetry/events', { token, body: '{pas du json' })).status, 400);
  const stats = await t.call('GET', '/me/events/stats', { token });
  assert.equal(stats.body.count, 0);
});

test('critère de sortie phase 0 : une session NDJSON réelle est ingérée sans perte, et le rejeu ne crée aucun doublon', async () => {
  const d = await newDriver('replay');
  const run = () => replay({ file: fixture, server: t.url, token: d.personalToken, batchSize: 50 });

  const first = await run();
  assert.equal(first.lines, fixtureLines.length);
  assert.equal(first.invalid, 0);
  assert.equal(first.sent, first.lines - first.skipped);
  assert.equal(first.accepted, first.sent);
  assert.equal(first.duplicates, 0);
  assert.ok(first.lossless);

  const stats = await t.call('GET', '/me/events/stats', { token: d.session.accessToken });
  assert.equal(stats.body.count, first.sent);
  assert.equal(stats.body.byType['job-delivered'], 1);
  assert.equal(stats.body.byType['job-started'], 1);
  assert.equal(stats.body.byType.snapshot, 3);

  // Le journal brut conserve fidèlement la livraison.
  const row = await t.db.get("SELECT data FROM raw_events WHERE user_id = ? AND type = 'job-delivered'", [d.user.id]);
  const delivered = JSON.parse(row.data);
  assert.equal(delivered.jobDeliveredRevenue, '968');
  assert.equal(delivered.jobDeliveredDistanceKm, 382);

  const second = await run();
  assert.equal(second.accepted, 0);
  assert.equal(second.duplicates, second.sent);
  assert.equal((await t.call('GET', '/me/events/stats', { token: d.session.accessToken })).body.count, first.sent);
});
