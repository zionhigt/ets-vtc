// Intégration : tracker (télémétrie simulée à partir de la session réelle) → API → site public.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from '../../server/test/helpers.js';
import { ApiClient } from '../src/core/client.js';
import { PersistentQueue } from '../src/core/queue.js';
import { Tracker } from '../src/core/tracker.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../../../packages/shared/test/fixtures/convoy-session.ndjson', import.meta.url)),
  'utf8',
)
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

class FakeTelemetry extends EventEmitter {
  data = null;
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

let t;
let personalToken;
before(async () => {
  t = await startTestServer();
  const admin = (await t.login(t.adminToken)).accessToken;
  const r = await t.call('POST', '/admin/users', { token: admin, body: { username: 'seb', displayName: 'Séb' } });
  personalToken = r.body.personalToken;
});
after(() => t.close());

function makeTracker(serverUrl, queueDir) {
  const telemetry = new FakeTelemetry();
  const tracker = new Tracker({
    createTelemetry: () => telemetry,
    client: new ApiClient({ serverUrl, personalToken, timeoutMs: 2000 }),
    queue: new PersistentQueue(queueDir),
    snapshotIntervalMs: 60_000,
    sendIntervalMs: 60_000,
  });
  return { tracker, telemetry };
}

/** Rejoue les événements (hors snapshots) de la session réelle dans la télémétrie simulée. */
function playSession(telemetry) {
  for (const r of fixture) if (r.type !== 'snapshot') telemetry.emit(r.type.replace(/^event:/, ''), r.data);
}

test('hors ligne, les événements attendent dans la file puis partent au retour du réseau', async () => {
  const queueDir = mkdtempSync(path.join(tmpdir(), 'ets-vtc-q-'));
  const offline = makeTracker('http://127.0.0.1:9', queueDir);
  offline.tracker.start();
  playSession(offline.telemetry);
  // La session se termine par « disconnected » : le tracker attend de nouveau le jeu.
  assert.equal(offline.tracker.status.state, 'waitingGame');
  await offline.tracker.flush();
  const queued = offline.tracker.status.queued;
  const expected = fixture.filter((r) => r.type !== 'snapshot' && r.type !== 'event:time').length;
  assert.equal(queued, expected, 'tous les événements sauf « time » sont en file');
  assert.equal(offline.tracker.status.server.ok, false);
  await offline.tracker.stop();
  assert.equal(offline.telemetry.stopped, true);

  // Redémarrage du tracker (nouvelle instance, même dossier) avec le réseau revenu.
  const online = makeTracker(t.url, queueDir);
  assert.equal(online.tracker.status.queued, queued);
  await online.tracker.flush();
  assert.equal(online.tracker.status.queued, 0);
  assert.equal(online.tracker.status.server.ok, true);

  const [delivery] = (await t.call('GET', '/public/deliveries')).body;
  assert.equal(delivery.driver.name, 'Séb');
  assert.equal(delivery.to.city, 'Frankfurt am Main');
  assert.equal(delivery.revenue, 968);
});

test("l'état suit la partie : en attente du jeu, jeu détecté, livraison en cours", async () => {
  const { tracker, telemetry } = makeTracker(t.url, mkdtempSync(path.join(tmpdir(), 'ets-vtc-q-')));
  const states = [];
  tracker.on('status', (s) => states.push(s.state));
  tracker.start();
  assert.equal(tracker.status.state, 'waitingGame');
  telemetry.emit('connected');
  assert.equal(tracker.status.state, 'inGame');
  telemetry.emit('job-started', fixture.find((r) => r.type === 'event:job-started').data);
  assert.deepEqual(tracker.status.job, { cargo: 'Touret vide', from: 'Metz', to: 'Frankfurt am Main', plannedDistanceKm: 376 });
  assert.equal(tracker.status.state, 'onJob');
  telemetry.emit('time', 123); // ignoré
  telemetry.emit('job-delivered', fixture.find((r) => r.type === 'event:job-delivered').data);
  assert.equal(tracker.status.state, 'inGame');
  assert.equal(tracker.queue.peek(100).some((e) => e.type === 'time'), false);
  await tracker.stop();
  assert.equal(tracker.status.state, 'stopped');
  assert.deepEqual([...new Set(states)], ['waitingGame', 'inGame', 'onJob', 'stopped']);
});

test('un token révoqué arrête proprement les envois et le signale', async () => {
  const admin = (await t.login(t.adminToken)).accessToken;
  const r = await t.call('POST', '/admin/users', { token: admin, body: { username: 'revoque', displayName: 'Révoqué' } });
  const telemetry = new FakeTelemetry();
  const tracker = new Tracker({
    createTelemetry: () => telemetry,
    client: new ApiClient({ serverUrl: t.url, personalToken: r.body.personalToken }),
    queue: new PersistentQueue(mkdtempSync(path.join(tmpdir(), 'ets-vtc-q-'))),
    snapshotIntervalMs: 60_000,
    sendIntervalMs: 60_000,
  });
  await t.call('POST', `/admin/users/${r.body.user.id}/token`, { token: admin });
  let authError = false;
  tracker.on('auth-error', () => (authError = true));
  tracker.start();
  telemetry.emit('connected');
  await tracker.flush();
  assert.equal(authError, true);
  assert.equal(tracker.status.server.auth, true);
  assert.equal(tracker.status.queued, 1, 'les événements restent en file pour un envoi ultérieur');
  await tracker.stop();
});
