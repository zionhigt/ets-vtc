# ets-vtc

Plateforme VTC pour Euro Truck Simulator 2 : un serveur de télémétrie, un tracker
client et un site public. Le cahier des charges fait référence ; ce dépôt
l'implémente phase par phase.

| Phase | Contenu | État |
| --- | --- | --- |
| 0 · Socle | monorepo, base de données, comptes et tokens, ingestion brute, rejeu NDJSON | fait |
| 1 · MVP | tracker Electron, job livraisons, site (accueil, liste), admin web | à faire |
| 2 · Entreprise | employés et grades, finances simulées, classements, actus, fiches de paie | à faire |
| 3 · Confort | page Live avec carte, mise à jour du tracker, admin complet, ATS | à faire |

## Structure

```
apps/server        API Express v1 (auth, admin, ingestion)
packages/shared    contrat d'événements partagé (tracker, serveur, outils)
tools/             outils (rejeu de sessions NDJSON)
```

## Démarrage local

Node 22.13 ou plus récent (SQLite intégré à Node, rien d'autre à installer).

```sh
npm install
cp apps/server/.env.example apps/server/.env     # puis adapter
npm run create-admin -- admin "Nom de l'admin"   # affiche le token personnel de l'admin
npm run dev                                       # API sur http://localhost:3000/api/v1
npm test
```

## API v1

| Méthode | Route | Accès |
| --- | --- | --- |
| GET | `/health`, `/version` | public |
| POST | `/auth/token` `{ token }` → jeton d'accès (15 min) + jeton de rafraîchissement | token personnel |
| POST | `/auth/refresh` `{ refreshToken }` → nouvelle paire (rotation) | jeton de rafraîchissement |
| GET | `/me`, `/me/events/stats` | chauffeur |
| POST | `/telemetry/events` `{ events: [{ id, seq?, ts, type, data? }] }` (500 max, idempotent) | chauffeur |
| GET, POST | `/admin/users` | admin |
| GET, PATCH, DELETE | `/admin/users/:id` | admin |
| POST | `/admin/users/:id/token` (révoque et régénère) | admin |

Les routes protégées attendent `Authorization: Bearer <jeton d'accès>`.

## Rejouer une session enregistrée

```sh
node tools/replay-ndjson.js --file logs/session.ndjson --token vtc_xxx --server http://localhost:3000
```

Les snapshots sont réduits aux champs utiles (`--snapshots slim`, par défaut).
Les identifiants sont déterministes : rejouer le même fichier ne crée aucun doublon.

## Déploiement sur o2switch

1. cPanel → **Bases de données MySQL** : créer une base et un utilisateur.
2. Cloner le dépôt sur l'hébergement (cPanel → Git Version Control, ou SSH).
3. cPanel → **Setup Node.js App** → Create Application :
   - Node.js version : 22 ou plus récent ;
   - Application root : le dossier du dépôt ;
   - Application startup file : `apps/server/app.cjs` ;
   - variables d'environnement : celles de `apps/server/.env.example`, avec
     `NODE_ENV=production`, `DB_CLIENT=mysql`, les `MYSQL_*` et un `JWT_SECRET`
     aléatoire de 32 caractères minimum.
4. **Run NPM Install**, puis **Restart**. Le schéma est appliqué au démarrage.
5. Créer l'admin via le terminal cPanel (après avoir activé l'environnement Node
   indiqué en haut de la page de l'application) :
   `npm run create-admin -- admin "Nom de l'admin"`.
