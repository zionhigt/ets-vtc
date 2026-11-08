import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { createLink, revokeLink } from '../src/services/site-access.js';

let t;
before(async () => {
  // Cache désactivé : une révocation (faite par la CLI, donc hors du serveur) se voit tout de suite.
  t = await startTestServer({ siteAccess: 'restricted', siteAccessCacheMs: 0 });
});
after(() => t.close());

const get = (route, cookie) => fetch(`${t.url}${route}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });

test('sans lien, le site et son API publique sont fermés', async () => {
  for (const route of ['/', '/livraisons', '/admin', '/assets/home.js']) {
    const res = await get(route);
    assert.equal(res.status, 401, route);
    assert.match(await res.text(), /Accès réservé/);
  }
  const api = await get('/api/v1/public/stats');
  assert.equal(api.status, 401);
  assert.equal((await api.json()).error, 'site_access_required');
  assert.equal((await get('/')).headers.get('x-robots-tag'), 'noindex, nofollow');
  // La page de refus garde sa mise en forme.
  assert.equal((await get('/assets/style.css')).status, 200);
  assert.equal((await get('/assets/brand/logo.png')).status, 200);
});

test("le tracker et l'admin ne dépendent pas du lien", async () => {
  assert.equal((await get('/api/v1/health')).status, 200);
  const session = await t.login(t.adminToken);
  const users = await t.call('GET', '/admin/users', { token: session.accessToken });
  assert.equal(users.status, 200);
  const ingest = await t.call('POST', '/telemetry/events', {
    token: session.accessToken,
    body: { events: [{ id: 'evt-gate0001', ts: Date.now(), type: 'engine', data: true }] },
  });
  assert.equal(ingest.status, 200);
});

test('un lien valide ouvre le site ; révoqué, il le referme', async () => {
  const { id, token } = await createLink(t.db, 'Paul');
  const enter = await get(`/acces/${token}`);
  assert.equal(enter.status, 303);
  assert.equal(enter.headers.get('location'), '/');
  const setCookie = enter.headers.get('set-cookie');
  assert.match(setCookie, /vtc_site=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(';')[0];

  assert.equal((await get('/', cookie)).status, 200);
  assert.equal((await get('/livraisons', cookie)).status, 200);
  assert.equal((await get('/api/v1/public/stats', cookie)).status, 200);

  const row = await t.db.get('SELECT uses, last_used_at FROM site_links WHERE id = ?', [id]);
  assert.equal(Number(row.uses), 1);

  // Révocation directement en base, comme le fait la CLI.
  await revokeLink(t.db, id);
  assert.equal((await get('/', cookie)).status, 401, 'le cookie d\'un lien révoqué ne donne plus accès');
  assert.equal((await get('/api/v1/public/stats', cookie)).status, 401);
  assert.equal((await get(`/acces/${token}`)).status, 403, 'un lien révoqué ne pose plus de cookie');
});

test('un cookie falsifié ou un faux lien sont refusés', async () => {
  const { id } = await createLink(t.db, 'Marie');
  for (const cookie of [`vtc_site=${id}.faux`, `vtc_site=${id}`, 'vtc_site=abc.def', `vtc_site=${id + 1000}.x`]) {
    assert.equal((await get('/', cookie)).status, 401, cookie);
  }
  assert.equal((await get('/acces/vsl_nimportequoi')).status, 403);
});
