import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { ensureJobsUpToDate, JOBS_VERSION } from '../src/services/deliveries.js';

let t;
let admin;
before(async () => {
  t = await startTestServer();
  admin = (await t.login(t.adminToken)).accessToken;
});
after(() => t.close());

let seq = 0;
async function driver(username, displayName) {
  const { body } = await t.call('POST', '/admin/users', { token: admin, body: { username, displayName } });
  const session = await t.login(body.personalToken);
  const send = (type, ts, data) =>
    t.call('POST', '/telemetry/events', {
      token: session.accessToken,
      body: { events: [{ id: `evt-dash-${String(++seq).padStart(6, '0')}`, ts, type, data }] },
    });
  return { id: body.user.id, send };
}

const snap = (odo, speedMs, extra = {}) => ({
  truckOdometer: odo,
  speed: speedMs,
  speedLimit: 80 / 3.6,
  gear: 11,
  engineRpm: 1180,
  fuel: 700,
  fuelCapacity: 1400,
  cargoDamage: 0.012,
  routeDistance: 152_400,
  routeTime: 7_380,
  onJob: true,
  truckBrand: 'Volvo',
  truckName: 'FH3',
  ...extra,
});

test('tableau de bord chauffeur : direct, temps de conduite, mois, classement, mission', async () => {
  const now = Date.now();
  const lea = await driver('lea', 'Léa');
  await lea.send('job-started', now - 60_000, {
    cargo: 'Pièces automobiles', cargoId: 'car_parts', citySrc: 'Calais', citySrcId: 'calais',
    cityDst: 'München', cityDstId: 'munchen', jobIncome: '48320', plannedDistanceKm: 980, cargoMass: 18400,
  });
  // 3 snapshots en roulant à 86 km/h, 5 s d'écart : 10 s de conduite, 2 km.
  await lea.send('snapshot', now - 10_000, snap(5000, 24));
  await lea.send('snapshot', now - 5_000, snap(5001, 24));
  await lea.send('snapshot', now, snap(5002, 24));
  // Un autre chauffeur roule davantage ce mois-ci : Léa est 2ᵉ.
  const jakub = await driver('jakub', 'Jakub');
  await jakub.send('snapshot', now - 5_000, snap(100, 25));
  await jakub.send('snapshot', now, snap(104, 25));

  const r = await t.call('GET', `/public/drivers/${lea.id}`);
  assert.equal(r.status, 200);
  const d = r.body;
  assert.equal(d.name, 'Léa');
  assert.deepEqual(
    { online: d.live.online, speed: d.live.speedKmh, limit: d.live.speedLimitKmh, gear: d.live.gear, fuel: d.live.fuelPct, dmg: d.live.cargoDamagePct, km: d.live.routeKm, min: d.live.routeGameMin, truck: d.live.truck },
    { online: true, speed: 86, limit: 80, gear: 11, fuel: 50, dmg: 1.2, km: 152.4, min: 123, truck: 'Volvo FH3' },
  );
  assert.equal(d.today.drivingS, 10);
  assert.equal(d.today.distanceKm, 2);
  assert.equal(d.week.drivingS, 10);
  assert.equal(d.month.distanceKm, 2);
  assert.equal(d.month.rank, 2);
  assert.equal(d.ranking[0].name, 'Jakub');
  assert.equal(d.current.to.city, 'München');
  assert.equal(d.current.income, 48320);

  const road = (await t.call('GET', '/public/on-road')).body.find((x) => x.driver.id === lea.id);
  assert.equal(road.live.routeKm, 152.4);
  assert.equal(road.live.online, true);

  const stats = (await t.call('GET', '/public/stats')).body;
  assert.equal(stats.driversOnline, 2);
  assert.equal(stats.month.distanceKm, 6);
  assert.equal(stats.month.distanceChangePct, null, 'pas de mois précédent');

  const list = (await t.call('GET', '/public/drivers')).body;
  assert.equal(list.find((x) => x.id === lea.id).online, true);
  assert.equal(list.find((x) => x.id === lea.id).monthKm, 2);

  assert.equal((await t.call('GET', '/public/drivers/99999')).status, 404);
  // Le public n'expose jamais l'identifiant de connexion.
  assert.ok(!JSON.stringify(d).includes('"lea"'));
});

test("une pause longue ou le jeu en pause ne comptent pas comme conduite", async () => {
  const base = Date.now() - 700_000; // fenêtre courte : reste dans la journée
  const d = await driver('pause', 'Pause');
  await d.send('snapshot', base, snap(10, 20));
  await d.send('snapshot', base + 5_000, snap(10.1, 20, { paused: true }));
  await d.send('snapshot', base + 10_000, snap(10.2, 0));
  await d.send('snapshot', base + 600_000, snap(10.3, 20)); // 10 min sans snapshot : tracker coupé
  await d.send('snapshot', base + 605_000, snap(10.4, 20));
  const dash = (await t.call('GET', `/public/drivers/${d.id}`)).body;
  assert.equal(dash.today.drivingS, 5);
});

test('un changement de version des règles déclenche un recalcul au démarrage', async () => {
  assert.equal(await ensureJobsUpToDate(t.db), true, 'base neuve : recalcul initial');
  assert.equal(await ensureJobsUpToDate(t.db), false, 'déjà à jour');
  const before = await t.db.all('SELECT user_id, day, distance_km, driving_s FROM daily_activity ORDER BY user_id, day');
  await t.db.run("UPDATE app_meta SET meta_value = 'ancienne' WHERE meta_key = 'jobs_version'");
  assert.equal(await ensureJobsUpToDate(t.db), true);
  const after = await t.db.all('SELECT user_id, day, distance_km, driving_s FROM daily_activity ORDER BY user_id, day');
  assert.deepEqual(after, before);
  assert.equal((await t.db.get("SELECT meta_value FROM app_meta WHERE meta_key = 'jobs_version'")).meta_value, JOBS_VERSION);
});
