import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/services/users.js';

// TEST_DB_CLIENT=mysql (+ MYSQL_*) fait tourner les tests sur MySQL/MariaDB
// (base vidée à chaque fichier : lancer avec --test-concurrency=1). Sinon SQLite en mémoire.
function testDbConfig() {
  if (process.env.TEST_DB_CLIENT !== 'mysql') return { client: 'sqlite', sqliteFile: ':memory:' };
  return {
    client: 'mysql',
    mysql: {
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    },
  };
}

const TABLES = [
  'site_links',
  'company_settings',
  'job_cursors',
  'deliveries',
  'audit_log',
  'raw_events',
  'refresh_tokens',
  'personal_tokens',
  'users',
];

/** Démarre l'API sur un port libre avec une base de test vierge. */
export async function startTestServer(configOverrides = {}) {
  const config = loadConfig({
    skipDotenv: true,
    env: { NODE_ENV: 'test' },
    config: {
      db: testDbConfig(),
      jwtSecret: 'test-secret-test-secret-test-secret-123',
      rateLimit: false,
      siteAccess: 'public',
      ...configOverrides,
    },
  });
  const db = await openDb(config.db);
  if (db.dialect === 'mysql') for (const table of TABLES) await db.run(`DROP TABLE IF EXISTS ${table}`);
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
