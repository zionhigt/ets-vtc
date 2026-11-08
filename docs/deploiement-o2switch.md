# Déployer ets-vtc sur o2switch, de zéro

Ce guide part de **l'offre o2switch et d'un nom de domaine, rien d'autre** : pas de
sous-domaine, pas de base, pas d'application Node. À la fin, le site de la VTC est
en ligne en HTTPS, l'API reçoit les données des trackers, et tu as ton compte admin.

Compter environ 45 minutes la première fois. La suite (comptes, liens d'accès,
tracker des chauffeurs) est dans le [guide d'administration](guide-admin.md).

Dans tout le guide :

- `mondomaine.fr` est ton domaine, `vtc.mondomaine.fr` l'adresse choisie pour le site ;
- `<identifiant>` est ton identifiant cPanel o2switch (visible en haut à droite de cPanel).

## Ce que l'offre permet, et comment le projet s'y adapte

L'offre unique Cloud d'o2switch est un hébergement mutualisé géré par cPanel, pas un
VPS : pas d'accès root, pas de Docker, pas de processus permanent. Le projet en
tient compte :

| Besoin | Sur o2switch |
| --- | --- |
| Application Node | lancée à la demande par Passenger (cPanel → **Setup Node.js App**) |
| Base de données | MySQL/MariaDB, fournie par cPanel |
| Calculs (livraisons, km, temps de conduite) | faits à l'arrivée des données, pas en tâche de fond |
| Site en direct | long polling (requêtes courtes, compatibles Passenger) |
| HTTPS | certificat gratuit Let's Encrypt (AutoSSL) |
| Tracker des chauffeurs | construit par GitHub Actions, rien n'est compilé sur l'hébergement |

Le site, l'admin et l'API sont servis à la même adresse : site sur `/`, admin sur
`/admin`, API sur `/api/v1`.

## 1. Le domaine pointe-t-il vers o2switch ?

Deux cas :

- **Domaine acheté chez o2switch, ou dont les serveurs DNS sont ceux d'o2switch**
  (`ns1.o2switch.net`, `ns2.o2switch.net`) : rien à faire. cPanel crée lui-même
  l'enregistrement DNS du sous-domaine à l'étape 2. **Aucun CNAME à créer.**
- **Domaine chez un autre registraire qui garde ses propres DNS** : chez ce
  registraire, crée un enregistrement **A** `vtc` → l'adresse IP de ton
  hébergement o2switch (cPanel → panneau de droite *Informations générales* →
  *Adresse IP partagée*). Compter de quelques minutes à quelques heures de
  propagation.

Pour vérifier : `nslookup vtc.mondomaine.fr` doit renvoyer l'IP de l'hébergement
(après l'étape 2 dans le premier cas).

## 2. Créer le sous-domaine

`vtc.mondomaine.fr` est un **sous-domaine** de ton domaine. Selon la version de
cPanel, il se crée à l'un de ces deux endroits (même résultat) :

- **Interface récente** : cPanel → **Domaines** → **Créer un nouveau domaine** →
  saisir `vtc.mondomaine.fr`. cPanel le rattache lui-même à ton domaine principal.
  Décocher « partager la racine du document » si la case est proposée.
- **Interface plus ancienne** : cPanel → **Sous-domaines** → sous-domaine `vtc`,
  domaine `mondomaine.fr`.

Laisser cPanel proposer le dossier racine (`~/vtc.mondomaine.fr`) : il ne servira
pas, c'est l'application Node qui répondra pour cette adresse. Valider.

**Variante** : si le domaine sert uniquement à la VTC, inutile de créer un
sous-domaine. Sauter cette étape et utiliser `mondomaine.fr` partout où ce guide
écrit `vtc.mondomaine.fr` (Application URL à l'étape 5, `PUBLIC_URL`, liens).

### Certificat HTTPS

cPanel → **SSL/TLS Status** (ou **Let's Encrypt SSL** selon l'interface) : vérifier
que `vtc.mondomaine.fr` a un certificat valide, sinon lancer **Run AutoSSL**. Le
certificat peut mettre quelques minutes à apparaître après la création du
sous-domaine (et après la propagation DNS dans le second cas de l'étape 1).

## 3. Créer la base de données

1. cPanel → **Bases de données MySQL**.
2. **Créer une base** : `vtc`. Elle s'appellera `<identifiant>_vtc`.
3. **Ajouter un utilisateur** : `vtc`, avec un mot de passe fort (bouton
   *Générateur de mot de passe*, le noter). Il s'appellera `<identifiant>_vtc`.
4. **Ajouter l'utilisateur à la base** : choisir les deux, cocher **TOUS LES
   PRIVILÈGES**, valider.

À noter pour l'étape 5 : nom de la base, nom de l'utilisateur, mot de passe. L'hôte
est `localhost`. Les tables se créent seules au premier démarrage.

## 4. Récupérer le code

Le dépôt GitHub est public : cPanel peut le cloner directement.

1. cPanel → **Git™ Version Control** → **Create**.
2. Cocher **Clone a Repository**, puis :
   - Clone URL : `https://github.com/zionhigt/ets-vtc.git`
   - Repository Path : `apps/ets-vtc`
   - Repository Name : `ets-vtc`
3. **Create**. Le code est dans `~/apps/ets-vtc`, branche `main`.

## 5. Créer l'application Node

cPanel → **Setup Node.js App** → **Create Application** :

| Champ | Valeur |
| --- | --- |
| Node.js version | la plus récente proposée : **20 minimum** (la liste propose aussi de très vieilles versions comme la 10, qui ne fonctionnent pas) |
| Application mode | Production |
| Application root | `apps/ets-vtc` |
| Application URL | `vtc.mondomaine.fr` (chemin vide) |
| Application startup file | `apps/server/app.cjs` |
| Passenger log file | `/home/<identifiant>/logs/ets-vtc.log` |

Puis **Add Variable** pour chacune de ces variables d'environnement :

| Variable | Valeur |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_CLIENT` | `mysql` |
| `MYSQL_HOST` | `localhost` |
| `MYSQL_PORT` | `3306` |
| `MYSQL_DATABASE` | `<identifiant>_vtc` |
| `MYSQL_USER` | `<identifiant>_vtc` |
| `MYSQL_PASSWORD` | le mot de passe de l'étape 3 |
| `JWT_SECRET` | une chaîne aléatoire d'au moins 32 caractères (voir ci-dessous) |
| `TRUST_PROXY` | `1` |
| `SITE_ACCESS` | `restricted` : site visible uniquement avec un lien d'accès (`public` pour l'ouvrir à tous) |
| `PUBLIC_URL` | `https://vtc.mondomaine.fr` |
| `MIN_TRACKER_VERSION` | `0.1.1` |

Pour `JWT_SECRET`, n'importe quel générateur de mots de passe fait l'affaire
(48 caractères). Le garder secret : le changer déconnecte tous les chauffeurs (leur
tracker se reconnecte seul avec leur token personnel).

Cliquer sur **Create**.

## 6. Installer les dépendances et démarrer

1. Sur la page de l'application, bouton **Run NPM Install**. Attendre la fin.
2. Bouton **Restart**.

Si **Run NPM Install** échoue, le faire en ligne de commande (étape 7 pour ouvrir un
terminal) : copier la commande d'activation affichée en haut de la page de
l'application (elle commence par `source /home/<identifiant>/nodevenv/...`), puis :

```sh
source /home/<identifiant>/nodevenv/apps/ets-vtc/<version>/bin/activate && cd ~/apps/ets-vtc
npm install --omit=dev
```

Point à surveiller : o2switch remplace le dossier `node_modules` de l'application
par un lien vers son environnement Node. Si un vrai dossier `node_modules` existe
déjà dans `~/apps/ets-vtc`, le supprimer avant l'installation.

Vérifier dans un navigateur : `https://vtc.mondomaine.fr/api/v1/health` doit
afficher `{"status":"ok"}`.

## 7. Ouvrir un terminal sur l'hébergement

Les étapes suivantes se font en ligne de commande. Deux possibilités :

- cPanel → **Terminal** (si présent dans ton interface) ;
- sinon SSH : cPanel → **Autorisation SSH** (outil o2switch) → autoriser ton
  adresse IP, puis `ssh <identifiant>@mondomaine.fr` avec le mot de passe cPanel.

Dans le terminal, **toujours activer l'environnement Node d'abord** (commande
`source …` de l'étape 6), puis `cd ~/apps/ets-vtc`.

## 8. Donner la configuration aux commandes en ligne

Les variables saisies dans cPanel ne sont transmises qu'à l'application lancée par
Passenger, **pas** au terminal. Les commandes d'administration (`create-admin`,
`site-link`) lisent, elles, le fichier `apps/server/.env`. Sans lui, elles
écriraient dans une base SQLite locale et non dans ta base MySQL.

```sh
cp apps/server/.env.example apps/server/.env
chmod 600 apps/server/.env
nano apps/server/.env
```

Y mettre les **mêmes valeurs que dans cPanel** (étape 5) : `NODE_ENV=production`,
`DB_CLIENT=mysql`, les `MYSQL_*`, `JWT_SECRET`, `SITE_ACCESS`, `PUBLIC_URL`.
Dans nano, coller se fait par clic droit ou `Ctrl+Shift+V` ; enregistrer avec
`Ctrl+O` puis Entrée, quitter avec `Ctrl+X`.

Ce fichier est ignoré par Git (`git pull` n'y touche pas) et n'est pas servi par
le site ; `chmod 600` le rend lisible par toi seul. Chaque commande affiche la base
utilisée : elle doit indiquer `MySQL mupa0403_vtc@localhost/…`.

Astuce terminal : une commande copiée avec son retour à la ligne s'exécute dès le
collage. Pour saisir un mot de passe sans le montrer ni le coller dans une commande :
`read -rs -p "Mot de passe : " VAR; echo; export VAR`.

## 9. Créer ton compte admin

```sh
npm run create-admin -- admin "Ton nom"
```

La commande affiche le **token personnel de l'admin** (`vtc_…`). Le copier dans un
gestionnaire de mots de passe : il ne sera plus affiché. Ce token sert à te
connecter à l'admin web **et** à ton propre tracker si tu roules.

## 10. Créer ton lien d'accès au site

Avec `SITE_ACCESS=restricted`, le site (pages, admin web) ne s'affiche qu'après
ouverture d'un lien d'accès. Crée le tien :

```sh
npm run site-link -- create "Moi"
```

Ouvre le lien affiché (`https://vtc.mondomaine.fr/acces/vsl_…`) dans ton
navigateur : il dépose un cookie et t'amène sur l'accueil. Le lien sert aussi sur
tes autres appareils.

## 11. Vérifier

1. `https://vtc.mondomaine.fr` : l'accueil « Dispatch » s'affiche (vide pour l'instant).
2. Lien **Administration** en bas de page, ou `https://vtc.mondomaine.fr/admin` :
   te connecter avec le token admin de l'étape 9.
3. Depuis un autre navigateur, sans lien : la page « Accès réservé » s'affiche.

C'est en ligne. La suite : identité de l'entreprise, comptes des chauffeurs, liens
d'accès et tracker, dans le [guide d'administration](guide-admin.md).

## Mettre à jour

Dans le terminal (environnement activé, `cd ~/apps/ets-vtc`) :

```sh
git pull
npm install --omit=dev
mkdir -p tmp && touch tmp/restart.txt      # redémarre l'application
```

Ou dans cPanel : **Git™ Version Control** → *Manage* → *Pull or Deploy* → **Update
from Remote**, puis **Setup Node.js App** → **Run NPM Install** → **Restart**.

Le schéma de base et les données calculées (livraisons, km, temps de conduite) se
mettent à jour seuls au redémarrage.

## Sauvegardes

- **Base** : JetBackup (cPanel) la sauvegarde automatiquement. Copie manuelle :
  cPanel → phpMyAdmin → base `<identifiant>_vtc` → Exporter.
- **Configuration** : noter les variables de l'étape 5 dans un gestionnaire de mots
  de passe. Le code, lui, est sur GitHub.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| Page d'erreur Passenger, « Incomplete response » | lire le fichier *Passenger log file* (`~/logs/ets-vtc.log`) |
| Page Passenger « something went wrong » en Production mais tout va bien en Development | `JWT_SECRET` absent, mal nommé ou de moins de 32 caractères (exigé en production seulement) |
| `ER_DBACCESS_DENIED_ERROR` | l'utilisateur n'a pas de droits sur la base : section *Ajouter un utilisateur à une base de données*, puis TOUS LES PRIVILÈGES |
| `Cannot find package 'dotenv'` ou `'express'` | dépendances non installées : étape 6 (dépôt à jour requis, `git pull`) |
| Pour voir l'erreur exacte | *Application mode* → Development le temps du diagnostic : Passenger affiche le détail ; revenir ensuite en Production |
| `ER_ACCESS_DENIED_ERROR` (*using password: YES*) | mot de passe refusé : vérifier `MYSQL_PASSWORD`, le préfixe `<identifiant>_` de l'utilisateur ; tester avec `mysql -u <identifiant>_vtc -p <identifiant>_vtc` (le collage dans une invite de mot de passe échoue souvent : voir l'astuce de l'étape 8) |
| Le domaine affiche une page o2switch par défaut | *Application URL* de l'étape 5 incorrecte, ou DNS pas encore propagé (étape 1) |
| Avertissement de certificat | AutoSSL pas encore passé : étape 2, *Run AutoSSL* |
| Page « Accès réservé » pour toi | ouvrir ton lien d'accès (étape 10) dans ce navigateur |
| Premier affichage lent | normal : Passenger arrête l'application inactive et la relance à la requête suivante |

Les intitulés des menus cPanel peuvent varier légèrement selon la version de
l'interface. Ce guide n'a pas encore été déroulé sur un compte o2switch réel : il
sera corrigé au premier déploiement.
