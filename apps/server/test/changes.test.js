import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { ChangeFeed } from '../src/services/changes.js';

let t;
let driver;
before(async () => {
  t = await startTestServer();
  const admin = (await t.login(t.adminToken)).accessToken;
  const { body } = await t.call('POST', '/admin/users', { token: admin, body: { username: 'poll', displayName: 'Poll' } });
  driver = (await t.login(body.personalToken)).accessToken;
});
after(() => t.close());

const changes = (since) => t.call('GET', `/public/changes?since=${since}`);

test('une version inconnue répond immédiatement', async () => {
  const started = Date.now();
  const r = await changes(0);
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.version, 'number');
  assert.ok(Date.now() - started < 1000);
});

test("l'attente se termine à l'arrivée d'un lot, une seule fois par lot", async () => {
  const { version } = (await changes(0)).body;
  const started = Date.now();
  const waiting = changes(version);
  await new Promise((r) => setTimeout(r, 300));
  // Un lot de 3 événements : un seul réveil.
  await t.call('POST', '/telemetry/events', {
    token: driver,
    body: {
      events: ['a', 'b', 'c'].map((x) => ({ id: `evt-poll-${x}-${version}`, ts: Date.now(), type: 'snapshot', data: { truckOdometer: 1 } })),
    },
  });
  const next = (await waiting).body.version;
  assert.ok(next > version);
  assert.ok(Date.now() - started < 3000, 'réveillé par le lot, pas par l\'expiration');
  // La version ne bouge plus sans nouveau lot : un doublon ne réveille personne.
  await t.call('POST', '/telemetry/events', {
    token: driver,
    body: { events: [{ id: `evt-poll-a-${version}`, ts: Date.now(), type: 'snapshot', data: { truckOdometer: 1 } }] },
  });
  assert.equal((await changes(0)).body.version, next);
});

test("sans nouveauté, l'attente se termine à l'expiration", async () => {
  const feed = new ChangeFeed();
  const started = Date.now();
  assert.equal(await feed.wait(feed.version, { timeoutMs: 150 }), feed.version);
  assert.ok(Date.now() - started >= 140);
  const aborted = new AbortController();
  const p = feed.wait(feed.version, { timeoutMs: 10_000, signal: aborted.signal });
  aborted.abort();
  await p;
  assert.equal(feed.emitter.listenerCount('change'), 0, 'aucune écoute laissée derrière');
});
