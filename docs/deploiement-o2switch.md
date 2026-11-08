# Déployer ets-vtc sur o2switch

Ce guide met en ligne le serveur (API + site public + admin web) sur un hébergement
o2switch, via cPanel. Le tracker, lui, est distribué aux chauffeurs sous forme
d'exécutable et n'est pas installé sur l'hébergement.

Compter 30 minutes pour un premier déploiement.

Ce guide vise l'**offre unique Cloud** d'o2switch : un hébergement mutualisé géré
par cPanel, et non un VPS. Pas d'accès root, pas de Docker, pas de processus qui
tourne en permanence. Le projet en tient compte :

- l'application Node est lancée à la demande par Passenger ;
- les jobs (reconstitution des livraisons) tournent au moment où les événements
  arrivent, pas dans un processus de fond ;
- la base est MySQL/MariaDB, fournie par cPanel ;
- le tracker est construit par GitHub Actions, rien n'est compilé sur l'hébergement.

## Vue d'ensemble

| Élément | Sur o2switch |
| --- | --- |
| Application Node | lancée par Passenger (cPanel → **Setup Node.js App**) |
| Base de données | MySQL/MariaDB (cPanel → **Bases de données MySQL**) |
| Domaine | un sous-domaine dédié, par exemple `vtc.mondomaine.fr` |
| HTTPS | certificat gratuit AutoSSL / Let's Encrypt, géré par o2switch |
| Sauvegardes | JetBackup, inclus dans l'offre |

Le serveur sert tout sur le même domaine : le site public sur `/`, l'admin sur
`/admin`, l'API sur `/api/v1`.

## 1. Créer le sous-domaine

1. cPanel → **Domaines** → Créer un domaine : `vtc.mondomaine.fr`.
2. Laisser cPanel proposer le dossier racine (par exemple `~/vtc.mondomaine.fr`).
   Ce dossier ne servira pas : c'est Passenger qui répondra pour ce domaine.
3. cPanel → **Lets Encrypt SSL** (ou SSL/TLS Status → AutoSSL) : vérifier que le
   sous-domaine a un certificat. Il peut falloir quelques minutes après la création.

## 2. Créer la base de données

1. cPanel → **Bases de données MySQL**.
2. Créer une base, par exemple `vtc`. cPanel la préfixe avec ton identifiant :
   elle s'appellera `<identifiant>_vtc`.
3. Créer un utilisateur, par exemple `vtc`, avec un mot de passe fort généré.
   Il s'appellera `<identifiant>_vtc`.
4. Ajouter l'utilisateur à la base avec **tous les privilèges**.
5. Noter : nom de la base, utilisateur, mot de passe. L'hôte est `localhost`.

Le schéma est créé automatiquement au premier démarrage de l'application.

## 3. Récupérer le code

Le code vit dans son propre dossier, hors des dossiers publics, par exemple
`~/apps/ets-vtc`.

**Si le dépôt GitHub est public** : cPanel → **Git Version Control** → Create :

- Clone URL : `https://github.com/zionhigt/ets-vtc.git`
- Repository Path : `apps/ets-vtc`
- Repository Name : `ets-vtc`

**Si le dépôt est privé** : cPanel → **Terminal** (ou SSH), puis créer une clé de
déploiement en lecture seule :

```sh
ssh-keygen -t ed25519 -f ~/.ssh/ets-vtc-deploy -N ""
cat ~/.ssh/ets-vtc-deploy.pub
```

Ajouter cette clé publique sur GitHub (dépôt → Settings → Deploy keys, sans
droit d'écriture), puis :

```sh
cat >> ~/.ssh/config <<'EOF'
Host github-ets-vtc
  HostName github.com
  IdentityFile ~/.ssh/ets-vtc-deploy
EOF
mkdir -p ~/apps && git clone git@github-ets-vtc:zionhigt/ets-vtc.git ~/apps/ets-vtc
```

Choisir la branche à déployer (`main` une fois les phases fusionnées) :

```sh
cd ~/apps/ets-vtc && git checkout main
```

## 4. Créer l'application Node

cPanel → **Setup Node.js App** → **Create Application** :

| Champ | Valeur |
| --- | --- |
| Node.js version | la plus récente proposée (20 minimum, 22 ou plus conseillé) |
| Application mode | Production |
| Application root | `apps/ets-vtc` |
| Application URL | `vtc.mondomaine.fr` (laisser le chemin vide) |
| Application startup file | `apps/server/app.cjs` |
| Passenger log file | `/home/<identifiant>/logs/ets-vtc.log` |

Puis ajouter les **variables d'environnement** (bouton Add Variable) :

| Variable | Valeur |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_CLIENT` | `mysql` |
| `MYSQL_HOST` | `localhost` |
| `MYSQL_PORT` | `3306` |
| `MYSQL_DATABASE` | `<identifiant>_vtc` |
| `MYSQL_USER` | `<identifiant>_vtc` |
| `MYSQL_PASSWORD` | le mot de passe de l'étape 2 |
| `JWT_SECRET` | une chaîne aléatoire d'au moins 32 caractères (voir ci-dessous) |
| `TRUST_PROXY` | `1` |
| `MIN_TRACKER_VERSION` | `0.1.0` |
| `SITE_ACCESS` | `restricted` (site visible uniquement avec un lien d'accès) ou `public` |
| `PUBLIC_URL` | `https://vtc.mondomaine.fr` (sert à afficher les liens d'accès) |

Pour générer `JWT_SECRET`, dans le Terminal cPanel :

```sh
openssl rand -base64 48
```

Ne jamais réutiliser ni publier ce secret : le changer déconnecte tous les chauffeurs
(ils se reconnectent automatiquement avec leur token personnel).

Cliquer sur **Create**.

## 5. Installer les dépendances

Sur la page de l'application, cliquer sur **Run NPM Install**.

Si le bouton échoue, le faire en ligne de commande. Copier la commande d'activation
affichée en haut de la page de l'application (elle commence par
`source /home/<identifiant>/nodevenv/...`), puis dans le Terminal :

```sh
source /home/<identifiant>/nodevenv/apps/ets-vtc/<version>/bin/activate && cd ~/apps/ets-vtc
npm install --omit=dev
```

Point à surveiller : o2switch (CloudLinux) remplace le dossier `node_modules` de
l'application par un lien vers son environnement Node. S'il existe déjà un vrai
dossier `node_modules` dans `~/apps/ets-vtc`, le supprimer avant l'installation.

Puis cliquer sur **Restart**.

## 6. Créer le compte admin

Dans le Terminal, environnement Node activé (commande `source` de l'étape 5) :

```sh
cd ~/apps/ets-vtc
npm run create-admin -- admin "Ton nom"
```

La commande affiche le **token personnel de l'admin**. Le conserver en lieu sûr :
il ne sera plus affiché. En cas de perte, en régénérer un depuis un autre compte
admin, ou recréer un admin avec un autre identifiant.

## 7. Créer ton lien d'accès au site

Avec `SITE_ACCESS=restricted`, le site (pages, admin web, API publique) n'est
visible que pour les personnes qui ont ouvert un lien d'accès. Le tracker des
chauffeurs n'est pas concerné : il utilise son propre token.

Dans le Terminal, environnement Node activé :

```sh
cd ~/apps/ets-vtc
npm run site-link -- create "Moi"       # affiche https://vtc.mondomaine.fr/acces/vsl_…
```

Ouvrir ce lien dans son navigateur : il pose un cookie et redirige vers l'accueil.
Le lien reste valable et peut être ouvert sur d'autres appareils.

Gérer les liens :

```sh
npm run site-link -- create "Paul"      # un lien par personne : on pourra le révoquer seul
npm run site-link -- list               # liens, nombre d'ouvertures, dernière utilisation
npm run site-link -- revoke 3           # coupe l'accès de tous ceux qui ont utilisé le lien n°3 (sous 30 s)
```

Un lien affiché ne peut pas être réaffiché : en cas de perte, en créer un nouveau
et révoquer l'ancien.

## 8. Vérifier

```sh
curl https://vtc.mondomaine.fr/api/v1/health     # {"status":"ok"}
curl https://vtc.mondomaine.fr/api/v1/version
```

Puis, depuis le navigateur où le lien d'accès a été ouvert, aller sur
`https://vtc.mondomaine.fr/admin`, se connecter avec le token admin, renseigner
l'identité de l'entreprise et créer les comptes des chauffeurs.

## Mettre à jour

```sh
source /home/<identifiant>/nodevenv/apps/ets-vtc/<version>/bin/activate && cd ~/apps/ets-vtc
git pull
npm install --omit=dev
mkdir -p tmp && touch tmp/restart.txt      # redémarrage Passenger
```

Ou, depuis cPanel : Git Version Control → Update from Remote, puis Setup Node.js App
→ Run NPM Install → Restart.

Le schéma de base est mis à jour automatiquement au redémarrage.

## Sauvegardes

- **Base** : JetBackup (cPanel) sauvegarde automatiquement les bases. Pour une copie
  manuelle : cPanel → phpMyAdmin → Exporter.
- **Code** : il est sur GitHub ; rien d'autre à sauvegarder côté hébergement, à part
  les variables d'environnement (les noter dans un gestionnaire de mots de passe).

## Dépannage

| Symptôme | Piste |
| --- | --- |
| Page d'erreur Passenger, « Incomplete response » | lire le fichier défini dans *Passenger log file* |
| `JWT_SECRET doit faire au moins 32 caractères` | variable absente ou trop courte, puis Restart |
| `ER_ACCESS_DENIED_ERROR` | utilisateur non ajouté à la base, ou préfixe oublié dans `MYSQL_USER` / `MYSQL_DATABASE` |
| `Cannot find module 'express'` | dépendances non installées : étape 5 |
| Le site répond lentement au premier accès | normal : Passenger arrête l'application inactive et la relance à la requête suivante |
| Page « Accès réservé » | ouvrir un lien d'accès (étape 7) dans ce navigateur ; un lien révoqué ne fonctionne plus |

Les points propres à o2switch (noms des menus cPanel, chemin de l'environnement
Node, comportement de `node_modules`) sont à confirmer au premier déploiement ; ce
guide sera corrigé en conséquence.
