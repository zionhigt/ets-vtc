// Crée le premier compte admin et affiche son token personnel.
// Usage : npm run create-admin -- <username> "<Nom affiché>"
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { createUser } from '../src/services/users.js';

const [username, displayName = username] = process.argv.slice(2);
if (!username) {
  console.error('Usage : npm run create-admin -- <username> "<Nom affiché>"');
  process.exit(1);
}

const config = loadConfig();
const db = await openDb(config.db);
try {
  await db.migrate();
  const { user, token } = await createUser(db, { username, displayName, role: 'admin' });
  console.log(`Admin créé : ${user.username} (id ${user.id})`);
  console.log(`Token personnel (à conserver, il ne sera plus affiché) :\n${token}`);
} catch (e) {
  console.error(`Échec : ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
