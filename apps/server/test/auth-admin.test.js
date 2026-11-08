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

test('health et version sont publics', async () => {
  assert.deepEqual((await t.call('GET', '/health')).body, { status: 'ok' });
  const v = await t.call('GET', '/version');
  assert.equal(v.status, 200);
  assert.equal(v.body.minTrackerVersion, '0.0.0');
});

test('un token personnel invalide est refusé', async () => {
  const r = await t.call('POST', '/auth/token', { body: { token: 'vtc_nimportequoi' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'invalid_personal_token');
});

test('les routes protégées exigent un jeton', async () => {
  assert.equal((await t.call('GET', '/me')).status, 401);
  assert.equal((await t.call('GET', '/admin/users', { token: 'abc' })).status, 401);
});

test("l'admin crée un chauffeur qui se connecte avec son token personnel", async () => {
  const created = await t.call('POST', '/admin/users', {
    token: admin,
    body: { username: 'seb', displayName: 'Séb' },
  });
  assert.equal(created.status, 201);
  assert.match(created.body.personalToken, /^vtc_/);
  assert.equal(created.body.user.role, 'driver');

  const session = await t.login(created.body.personalToken);
  assert.equal(session.user.displayName, 'Séb');
  const me = await t.call('GET', '/me', { token: session.accessToken });
  assert.equal(me.body.username, 'seb');

  // Un chauffeur n'a pas accès à l'admin.
  assert.equal((await t.call('GET', '/admin/users', { token: session.accessToken })).status, 403);
});

test('un nom d\'utilisateur en double ou invalide est refusé', async () => {
  const dup = await t.call('POST', '/admin/users', { token: admin, body: { username: 'admin', displayName: 'X' } });
  assert.equal(dup.status, 409);
  const bad = await t.call('POST', '/admin/users', { token: admin, body: { username: 'Pas Valide', displayName: 'X' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_payload');
});

test('le rafraîchissement fait tourner le jeton (usage unique)', async () => {
  const { body } = await t.call('POST', '/admin/users', { token: admin, body: { username: 'rot', displayName: 'Rot' } });
  const s1 = await t.login(body.personalToken);
  const r1 = await t.call('POST', '/auth/refresh', { body: { refreshToken: s1.refreshToken } });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refreshToken, s1.refreshToken);
  const replayed = await t.call('POST', '/auth/refresh', { body: { refreshToken: s1.refreshToken } });
  assert.equal(replayed.status, 401);
});

test('régénérer le token révoque l\'ancien et les sessions', async () => {
  const { body } = await t.call('POST', '/admin/users', { token: admin, body: { username: 'regen', displayName: 'Regen' } });
  const s = await t.login(body.personalToken);
  const regen = await t.call('POST', `/admin/users/${body.user.id}/token`, { token: admin });
  assert.equal(regen.status, 200);
  assert.equal((await t.call('POST', '/auth/token', { body: { token: body.personalToken } })).status, 401);
  assert.equal((await t.call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } })).status, 401);
  assert.equal((await t.login(regen.body.personalToken)).user.username, 'regen');
});

test('un compte désactivé perd l\'accès immédiatement', async () => {
  const { body } = await t.call('POST', '/admin/users', { token: admin, body: { username: 'off', displayName: 'Off' } });
  const s = await t.login(body.personalToken);
  const patch = await t.call('PATCH', `/admin/users/${body.user.id}`, { token: admin, body: { active: false } });
  assert.equal(patch.body.active, false);
  assert.equal((await t.call('GET', '/me', { token: s.accessToken })).status, 401);
  assert.equal((await t.call('POST', '/auth/token', { body: { token: body.personalToken } })).status, 401);
});

test("l'admin ne peut ni se désactiver ni se supprimer", async () => {
  const me = await t.call('GET', '/me', { token: admin });
  assert.equal((await t.call('PATCH', `/admin/users/${me.body.id}`, { token: admin, body: { active: false } })).status, 400);
  assert.equal((await t.call('DELETE', `/admin/users/${me.body.id}`, { token: admin })).status, 400);
});

test('la suppression efface le compte et ses événements (RGPD)', async () => {
  const { body } = await t.call('POST', '/admin/users', { token: admin, body: { username: 'gone', displayName: 'Gone' } });
  const s = await t.login(body.personalToken);
  await t.call('POST', '/telemetry/events', {
    token: s.accessToken,
    body: { events: [{ id: 'evt-00000001', ts: Date.now(), type: 'engine', data: true }] },
  });
  assert.equal((await t.call('DELETE', `/admin/users/${body.user.id}`, { token: admin })).status, 204);
  assert.equal((await t.call('GET', `/admin/users/${body.user.id}`, { token: admin })).status, 404);
  const left = await t.db.get('SELECT COUNT(*) AS n FROM raw_events WHERE user_id = ?', [body.user.id]);
  assert.equal(Number(left.n), 0);
  const audit = await t.db.all("SELECT action FROM audit_log WHERE target = ?", [`user:${body.user.id}`]);
  assert.deepEqual(audit.map((a) => a.action), ['user.create', 'user.delete']);
});
