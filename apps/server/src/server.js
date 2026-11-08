// Point d'entrée. Compatible avec Passenger (o2switch, « Setup Node.js App ») :
// Passenger fournit le port via PORT et intercepte listen().
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { createApp } from './app.js';
import { ensureJobsUpToDate } from './services/deliveries.js';

const config = loadConfig();
const db = await openDb(config.db);
await db.migrate();
await ensureJobsUpToDate(db, (m) => console.log(`[ets-vtc] ${m}`));

const server = createApp({ db, config }).listen(config.port, () => {
  console.log(`[ets-vtc] API v1 en écoute sur le port ${config.port} (${config.db.client}, ${config.env})`);
});

async function shutdown(signal) {
  console.log(`[ets-vtc] arrêt (${signal})`);
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
