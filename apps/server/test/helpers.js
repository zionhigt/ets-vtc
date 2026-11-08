import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/services/users.js';

/** Démarre l'API sur un port libre avec une base SQLite en mémoire. */
export async function startTestServer(configOverrides = {}) {
  const config = loadConfig({
    skipDotenv: true,
    env: { NODE_ENV: 'test' },
    config: {
      db: { client: 'sqlite', sqliteFile: ':memory:' },
      jwtSecret: 'test-secret-test-secret-test-secret-123',
      rateLimit: false,
      ...configOverrides,
    },
  });
  const db = await openDb(config.db);
  await db.migrate();
  const server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;

  const { token: adminToken } = await createUser(db, { username: 'admin', displayName: 'Admin', role: 'admin' });

  async function call(method, route, { body, token } = {}) {
    const res = await fetch(`${url}/api/v1${route}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function login(personalToken) {
    const r = await call('POST', '/auth/token', { body: { token: personalToken } });
    if (r.status !== 200) throw new Error(`login ${r.status}`);
    return r.body;
  }

  return {
    url,
    db,
    config,
    call,
    login,
    adminToken,
    async close() {
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}
