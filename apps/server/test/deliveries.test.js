import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers.js';
import { replay } from '../../../tools/replay-ndjson.js';

const fixture = fileURLToPath(new URL('../../../packages/shared/test/fixtures/convoy-session.ndjson', import.meta.url));

let t;
let admin;
before(async () => {
  t = await startTestServer();
  admin = (await t.login(t.adminToken)).accessToken;
});
after(() => t.close());

async function newDriver(username, displayName = username) {
  const { body } = await t.call('POST', '/admin/users', { token: admin, body: { username, displayName } });
  return { ...body, session: await t.login(body.personalToken) };
}

let seq = 0;
const job = (cargoId, extra = {}) => ({
  cargo: cargoId,
  cargoId,
  citySrc: 'Metz',
  citySrcId: 'metz',
  cityDst: 'Lyon',
  cityDstId: 'lyon',
  compSrc: 'A',
  compDst: 'B',
  jobIncome: '1000',
  plannedDistanceKm: 400,
  ...extra,
});
const send = (driver, type, data) =>
  t.call('POST', '/telemetry/events', {
    token: driver.session.accessToken,
    body: { events: [{ id: `evt-synth-${String(++seq).padStart(6, '0')}`, ts: 1794129000000 + seq * 1000, type, data }] },
  });

test("critère de sortie phase 1 : la session réelle produit une livraison visible sur l'API publique", async () => {
  await newDriver('seb', 'Séb');
  const d = await t.call('GET', '/admin/users', { token: admin });
  const seb = d.body.find((u) => u.username === 'seb');
  const token = (await t.call('POST', `/admin/users/${seb.id}/token`, { token: admin })).body.personalToken;
  await replay({ file: fixture, server: t.url, token });

  const list = await t.call('GET', '/public/deliveries');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  const [delivery] = list.body;
  assert.equal(delivery.driver.name, 'Séb');
  assert.equal(delivery.status, 'delivered');
  assert.equal(delivery.from.city, 'Metz');
  assert.equal(delivery.to.city, 'Frankfurt am Main');
  assert.equal(delivery.cargo, 'Touret vide');
  assert.equal(delivery.revenue, 968);
  assert.equal(delivery.distanceKm, 382);
  assert.equal(delivery.plannedDistanceKm, 376);
  assert.deepEqual(delivery.fines, { count: 2, total: 3520 });

  const stats = (await t.call('GET', '/public/stats')).body;
  assert.equal(stats.deliveries, 1);
  assert.equal(stats.deliveredKm, 382);
  // Kilométrage réel : compteur des 3 snapshots de la fixture (2971,36 → 3043,63 → 3115,87 km).
  assert.equal(Math.round(stats.distanceKm * 100) / 100, 144.51);
  assert.equal(stats.revenue, 968);
  assert.equal(stats.activeDrivers30d >= 0, true);

  const drivers = (await t.call('GET', '/public/drivers')).body;
  assert.equal(drivers.find((x) => x.name === 'Séb').deliveries, 1);
  // Les admins roulent aussi : ils figurent parmi les employés.
  assert.ok(drivers.some((x) => x.name === 'Admin'));
  assert.equal(stats.drivers, drivers.length);

  // Aucune donnée sensible dans le public.
  const raw = JSON.stringify([list.body, stats, drivers]);
  for (const forbidden of ['username', 'token', 'personal', 'seb"']) assert.ok(!raw.includes(forbidden), forbidden);

  // Le rejeu complet redonne exactement le même résultat.
  const rebuilt = await t.call('POST', '/admin/jobs/rebuild', { token: admin });
  assert.equal(rebuilt.status, 200);
  const after = (await t.call('GET', '/public/deliveries')).body;
  assert.deepEqual({ ...after[0], id: 0 }, { ...delivery, id: 0 });
});

test('mission annulée, mission interrompue, livraison sans début', async () => {
  const d = await newDriver('synth');
  await send(d, 'job-started', job('c1'));
  await send(d, 'tollgate', { tollgatePayAmount: '12' });
  await send(d, 'job-cancelled', { jobCancelledPenalty: '250' });

  await send(d, 'job-started', job('c2'));
  await send(d, 'job-started', job('c3')); // c2 jamais livrée → interrompue

  // Reprise de la même mission (jeu relancé) : pas de doublon.
  await send(d, 'job-started', job('c3'));
  await send(d, 'fine', { fineOffence: 'speeding', fineAmount: '700' });
  await send(d, 'job-delivered', { ...job('c3'), jobDeliveredRevenue: '1100', jobDeliveredDistanceKm: 410 });

  // Livraison d'une mission commencée avant le lancement du tracker.
  await send(d, 'job-delivered', { ...job('c4'), jobDeliveredRevenue: '500', jobDeliveredDistanceKm: 120 });

  const rows = await t.db.all('SELECT cargo_id, status, cancel_penalty, tolls_total, fines_total, revenue FROM deliveries WHERE user_id = ? ORDER BY id', [d.user.id]);
  assert.deepEqual(
    rows.map((r) => [r.cargo_id, r.status, Number(r.cancel_penalty ?? 0), Number(r.tolls_total), Number(r.fines_total), Number(r.revenue ?? 0)]),
    [
      ['c1', 'cancelled', 250, 12, 0, 0],
      ['c2', 'interrupted', 0, 0, 0, 0],
      ['c3', 'delivered', 0, 0, 700, 1100],
      ['c4', 'delivered', 0, 0, 0, 500],
    ],
  );

  const mine = await t.call('GET', '/me/deliveries', { token: d.session.accessToken });
  assert.equal(mine.body.current, null);
  assert.equal(mine.body.recent.length, 2);
});

test('les missions en cours apparaissent dans « En route » puis en sortent à la livraison', async () => {
  const d = await newDriver('enroute', 'En Route');
  await send(d, 'job-started', job('route1', { cityDst: 'Berlin', cityDstId: 'berlin' }));
  let onRoad = (await t.call('GET', '/public/on-road')).body;
  const mine = onRoad.find((x) => x.driver.name === 'En Route');
  assert.equal(mine.to.city, 'Berlin');
  assert.equal(mine.income, 1000);
  assert.equal((await t.call('GET', '/public/stats')).body.driversOnJob >= 1, true);
  await send(d, 'job-delivered', { ...job('route1', { cityDst: 'Berlin', cityDstId: 'berlin' }), jobDeliveredRevenue: '1000' });
  onRoad = (await t.call('GET', '/public/on-road')).body;
  assert.equal(onRoad.some((x) => x.driver.name === 'En Route'), false);
});

test("l'identité de l'entreprise est modifiable par l'admin et publique", async () => {
  assert.equal((await t.call('GET', '/public/company')).body.name, 'Ma VTC');
  const put = await t.call('PUT', '/admin/company', {
    token: admin,
    body: { name: 'Transports Séb', slogan: 'On livre.', primaryColor: '#0f766e' },
  });
  assert.equal(put.status, 200);
  const pub = (await t.call('GET', '/public/company')).body;
  assert.equal(pub.name, 'Transports Séb');
  assert.equal(pub.primaryColor, '#0f766e');
  await t.call('PUT', '/admin/company', { token: admin, body: { name: 'Transports Séb 2' } });
  assert.equal((await t.call('GET', '/public/company')).body.name, 'Transports Séb 2');

  for (const body of [{ name: '' }, { primaryColor: 'rouge' }, { logoUrl: 'http://pas-https.fr/logo.png' }, {}]) {
    assert.equal((await t.call('PUT', '/admin/company', { token: admin, body })).status, 400, JSON.stringify(body));
  }
  const driver = await newDriver('pasadmin');
  assert.equal((await t.call('PUT', '/admin/company', { token: driver.session.accessToken, body: { name: 'X' } })).status, 403);
});

test('le site est servi sur le même domaine', async () => {
  for (const route of ['/', '/livraisons', '/admin']) {
    const res = await fetch(`${t.url}${route}`);
    assert.equal(res.status, 200, route);
    assert.match(res.headers.get('content-type'), /text\/html/);
  }
  const missing = await fetch(`${t.url}/nexiste-pas`);
  assert.equal(missing.status, 404);
  assert.equal((await fetch(`${t.url}/api/v1/nexiste-pas`)).status, 404);
});
