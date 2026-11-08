import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let t;
let admin;
before(async () => {
  t = await startTestServer();
  admin = (await t.login(t.adminToken)).accessToken;
});
after(() => t.close());

let seq = 0;
async function driver(username) {
  const { body } = await t.call('POST', '/admin/users', { token: admin, body: { username, displayName: username } });
  const session = await t.login(body.personalToken);
  const snap = (ts, truckOdometer) =>
    t.call('POST', '/telemetry/events', {
      token: session.accessToken,
      body: { events: [{ id: `evt-mile-${String(++seq).padStart(6, '0')}`, ts, type: 'snapshot', data: { truckOdometer, speed: 20 } }] },
    });
  return { id: body.user.id, snap };
}

const T0 = Date.UTC(2026, 10, 8, 23, 59, 0);
const km = async (userId) => {
  const rows = await t.db.all('SELECT day, distance_km FROM driving_days WHERE user_id = ? ORDER BY day', [userId]);
  return rows.map((r) => [r.day, Math.round(Number(r.distance_km) * 1000) / 1000]);
};

test('les km parcourus se comptent hors mission, par jour', async () => {
  const d = await driver('roule');
  await d.snap(T0, 1000);
  await d.snap(T0 + 5000, 1001.5);
  await d.snap(T0 + 10000, 1001.5); // à l'arrêt
  await d.snap(T0 + 65000, 1010); // minuit passé : jour suivant
  assert.deepEqual(await km(d.id), [
    ['2026-11-08', 1.5],
    ['2026-11-09', 8.5],
  ]);
  const stats = (await t.call('GET', '/public/stats')).body;
  assert.equal(stats.distanceKm, 10);
  assert.equal(stats.deliveries, 0, 'aucune livraison nécessaire pour compter les km');
  const drivers = (await t.call('GET', '/public/drivers')).body;
  assert.equal(drivers.find((x) => x.id === d.id).distanceKm, 10);
});

test('changement de camion, compteur qui recule ou jeu non chargé : rien compté', async () => {
  const d = await driver('saut');
  await d.snap(T0, 5000);
  await d.snap(T0 + 5000, 5002); // +2 km : normal
  await d.snap(T0 + 10000, 250_000); // autre camion : saut énorme
  await d.snap(T0 + 15000, 250_001); // +1 km depuis la nouvelle référence
  await d.snap(T0 + 20000, 0); // jeu au menu : compteur à zéro
  await d.snap(T0 + 25000, 120); // camion plus récent : compteur plus bas
  await d.snap(T0 + 30000, 121); // +1 km
  assert.deepEqual(await km(d.id), [['2026-11-08', 4]]);
});

test('le recalcul complet redonne le même kilométrage', async () => {
  const before = await t.db.all('SELECT user_id, day, distance_km FROM driving_days ORDER BY user_id, day');
  assert.equal((await t.call('POST', '/admin/jobs/rebuild', { token: admin })).status, 200);
  const after = await t.db.all('SELECT user_id, day, distance_km FROM driving_days ORDER BY user_id, day');
  assert.deepEqual(after, before);
});
