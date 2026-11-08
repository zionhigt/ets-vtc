// Applique le schéma (idempotent). Le serveur le fait aussi au démarrage.
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';

const config = loadConfig();
const db = await openDb(config.db);
await db.migrate();
await db.close();
console.log(`Schéma appliqué (${config.db.client}).`);
