// Gestion des liens d'accès au site (mode restreint).
//
//   npm run site-link -- create "Paul"     crée un lien et l'affiche (une seule fois)
//   npm run site-link -- list              liste les liens
//   npm run site-link -- revoke <id>       révoque un lien (effet sous 30 s)
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { createLink, listLinks, revokeLink, linkUrl } from '../src/services/site-access.js';
import { audit } from '../src/services/users.js';

const [command, arg] = process.argv.slice(2);
const usage = `Usage :
  npm run site-link -- create "<pour qui>"
  npm run site-link -- list
  npm run site-link -- revoke <id>`;

const config = loadConfig();
const db = await openDb(config.db);
const date = (ts) => (ts ? new Date(Number(ts)).toLocaleString('fr-FR') : '–');

try {
  await db.migrate();
  if (command === 'create') {
    const label = (arg ?? '').trim();
    if (!label) throw new Error(`Indique pour qui est le lien.\n${usage}`);
    const { id, token } = await createLink(db, label.slice(0, 128));
    await audit(db, null, 'site_link.create', `site_link:${id}`, { label });
    console.log(`Lien n°${id} pour « ${label} » (à transmettre, il ne sera plus affiché) :\n${linkUrl(config.publicUrl, token)}`);
    if (!config.publicUrl) console.log('\nAstuce : définis PUBLIC_URL pour afficher l\'adresse complète du site.');
    if (config.siteAccess === 'public') console.log('\nAttention : SITE_ACCESS=public, le site est actuellement ouvert à tous.');
  } else if (command === 'list') {
    const links = await listLinks(db);
    if (!links.length) console.log('Aucun lien.');
    for (const l of links) {
      const state = l.revoked_at ? `révoqué le ${date(l.revoked_at)}` : 'actif';
      console.log(`n°${l.id}  ${l.label}  · créé le ${date(l.created_at)} · ${l.uses} ouverture(s), dernière ${date(l.last_used_at)} · ${state}`);
    }
  } else if (command === 'revoke') {
    const id = Number(arg);
    if (!Number.isInteger(id)) throw new Error(usage);
    if (!(await revokeLink(db, id))) throw new Error(`Lien n°${id} introuvable ou déjà révoqué.`);
    await audit(db, null, 'site_link.revoke', `site_link:${id}`);
    console.log(`Lien n°${id} révoqué : les personnes qui l'ont utilisé perdent l'accès (sous 30 s).`);
  } else {
    console.log(usage);
    process.exitCode = command ? 1 : 0;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
