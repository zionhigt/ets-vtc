# ets-vtc

Plateforme VTC pour Euro Truck Simulator 2 : un serveur de télémétrie, un tracker
client et un site public. Le cahier des charges fait référence ; ce dépôt
l'implémente phase par phase.

| Phase | Contenu | État |
| --- | --- | --- |
| 0 · Socle | monorepo, base de données, comptes et tokens, ingestion brute, rejeu NDJSON | fait |
| 1 · MVP | tracker Electron, job livraisons, site (accueil, liste), admin web | fait, à valider en conditions réelles |
| 2 · Entreprise | employés et grades, finances simulées, classements, actus, fiches de paie | à faire |
| 3 · Confort | page Live avec carte, mise à jour du tracker, admin complet, ATS | à faire |

## Structure

```
apps/server        API Express v1 (auth, admin, ingestion, jobs, API publique)
apps/web/public    site public et admin web (statique, servi par l'API)
apps/tracker       tracker Windows Electron (hors workspaces, voir son README)
packages/shared    contrat d'événements partagé (tracker, serveur, outils)
tools/             outils (rejeu de sessions NDJSON)
docs/              guide de déploiement o2switch
```

Pages du site : `/` (dispatch : chiffres du mois, chauffeurs en route en direct, classement), `/chauffeur?id=<n>` (vue cabine : compteur en direct, mission, temps de conduite, registre), `/livraisons`, `/admin`.

Accès au site : par défaut (`SITE_ACCESS=restricted`), le site et l'API publique ne
sont visibles qu'avec un lien d'accès, créé en ligne de commande
(`npm run site-link -- create "Paul"`, puis `list`, `revoke <id>`). Le tracker et
l'API admin utilisent leurs propres jetons et n'en dépendent pas.

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
| GET, PUT | `/admin/company` (identité de l'entreprise) | admin |
| POST | `/admin/jobs/rebuild` (recalcule les livraisons) | admin |
| GET | `/me/deliveries` | chauffeur |
| GET | `/public/company`, `/public/stats`, `/public/deliveries`, `/public/drivers`, `/public/drivers/:id`, `/public/on-road` | public (lien d'accès) |
| GET | `/public/changes?since=<version>` : long polling, répond à l'arrivée d'un lot (25 s max) | public (lien d'accès) |

Les routes protégées attendent `Authorization: Bearer <jeton d'accès>`.

## Rejouer une session enregistrée

```sh
node tools/replay-ndjson.js --file logs/session.ndjson --token vtc_xxx --server http://localhost:3000
```

Les snapshots sont réduits aux champs utiles (`--snapshots slim`, par défaut).
Les identifiants sont déterministes : rejouer le même fichier ne crée aucun doublon.

## Déploiement sur o2switch

Voir le guide pas à pas : [docs/deploiement-o2switch.md](docs/deploiement-o2switch.md).
