# Guide d'administration ets-vtc

Ce guide suit le [déploiement](deploiement-o2switch.md) : le site est en ligne, tu
as ton token admin et ton lien d'accès. Il couvre la configuration de
l'entreprise, l'arrivée d'un chauffeur, puis la gestion courante.

Deux outils servent à l'administration :

| Outil | Pour | Où |
| --- | --- | --- |
| **Admin web** | identité de l'entreprise, comptes des chauffeurs, tokens, recalcul | lien **Administration** en bas de chaque page, ou `/admin` |
| **Terminal o2switch** | liens d'accès au site, création du premier admin | cPanel → Terminal ou SSH, environnement Node activé, `cd ~/apps/ets-vtc` (étape 7 du déploiement) ; nécessite `apps/server/.env` (étape 8) |

## 1. Configurer l'entreprise

Admin web → **Identité de l'entreprise** :

- **Nom** : affiché dans l'en-tête et le titre des pages ;
- **Slogan** et **Présentation** : sous le nom, et sur l'accueil ;
- **Couleur principale** : couleur d'accent du site ;
- **URL du logo** : une image en `https://` ; sans logo, celui de la plateforme s'affiche.

**Enregistrer** : c'est visible aussitôt sur le site, sans redémarrage. Les
chauffeurs ne voient cette identité que sur le site ; le tracker reste neutre
(`ets-vtc`).

## 2. Publier le tracker (une fois par version)

Les chauffeurs téléchargent le tracker sur la page des releases GitHub. Pour publier
la version actuelle (celle indiquée dans `apps/tracker/package.json`, ici `0.1.1`),
depuis ton poste, dans le dépôt :

```sh
git tag tracker-v0.1.1
git push origin tracker-v0.1.1
```

GitHub Actions construit l'exe (environ 5 minutes) et le publie dans une release.
Lien à donner aux chauffeurs :
`https://github.com/zionhigt/ets-vtc/releases/latest`

Pour une nouvelle version : changer `version` dans `apps/tracker/package.json`,
pousser, puis taguer `tracker-v<nouvelle version>`. Penser à relever
`MIN_TRACKER_VERSION` côté serveur (variables de l'application dans cPanel) si
l'ancienne version ne doit plus être acceptée.

## 3. Accueillir un chauffeur

Pour chaque nouveau chauffeur, trois choses à lui transmettre, **par un canal
privé** (message direct, pas un salon public) :

| Quoi | Sert à | Créé dans |
| --- | --- | --- |
| Son **token personnel** `vtc_…` | connecter son tracker | admin web |
| Son **lien d'accès** `https://…/acces/vsl_…` | voir le site | terminal |
| L'**adresse du site** et le **lien du tracker** | installer et configurer | — |

### 3.1 Créer son compte (admin web)

Admin web → **Ajouter un compte** :

- **Nom affiché sur le site** : son pseudo, tel qu'il apparaîtra partout ;
- **Identifiant** : minuscules, chiffres, `.` `_` `-` (sert à le reconnaître dans
  l'admin, jamais affiché sur le site) ;
- **Rôle** : *Chauffeur*. Choisir *Administrateur* seulement pour quelqu'un qui doit
  gérer les comptes.

Après **Créer le compte et son token**, le token s'affiche **une seule fois** :
bouton **Copier**, et le lui transmettre.

### 3.2 Créer son lien d'accès au site (terminal)

```sh
npm run site-link -- create "Paul"
```

Un lien par personne : on pourra ainsi couper l'accès de l'un sans toucher aux
autres. Le lien s'affiche une seule fois.

### 3.3 Message type à lui envoyer

> Salut ! Voici tes accès à la VTC.
> 1. Le site : ouvre ce lien une fois, il te garde connecté : `<lien d'accès>`
> 2. Le tracker : télécharge `ets-vtc-x.y.z.exe` ici
>    https://github.com/zionhigt/ets-vtc/releases/latest
>    (exécutable portable, pas d'installation). Au premier lancement, saisis :
>    - adresse du serveur : `vtc.mondomaine.fr`
>    - token : `<son token vtc_…>` (garde-le pour toi)
> 3. Dans le tracker : **Détecter**, puis **Installer le plugin**, jeu fermé.
> 4. Lance ETS2 et valide le message sur les fonctionnalités SDK avancées.
> C'est tout : tes livraisons apparaîtront sur le site.

Windows peut afficher un avertissement SmartScreen au premier lancement (l'exe
n'est pas signé) : *Informations complémentaires* → *Exécuter quand même*.

## 4. Gestion courante

### Comptes (admin web, liste « Chauffeurs »)

| Besoin | Action |
| --- | --- |
| Changer un pseudo, un identifiant ou un rôle | **Modifier** sur sa ligne, puis **Enregistrer** : le nouveau nom s'affiche aussitôt sur le site, tout l'historique suit, le token ne change pas |
| Token perdu, ou divulgué | **Nouveau token** (deux clics) : l'ancien est révoqué, son tracker est déconnecté ; transmettre le nouveau |
| Pause d'un chauffeur | **Désactiver** : il disparaît du site, son tracker ne peut plus envoyer ; **Réactiver** pour revenir |
| Départ définitif | **Supprimer** (deux clics) : le compte et toutes ses données sont effacés, sans retour possible |

Tu ne peux ni te désactiver ni te supprimer toi-même : passe par un autre compte
administrateur.

### Liens d'accès au site (terminal)

```sh
npm run site-link -- list          # liens, nombre d'ouvertures, dernière utilisation
npm run site-link -- revoke 3      # coupe l'accès de tous ceux qui ont utilisé le lien n°3
```

La révocation prend effet en moins de 30 secondes. Un lien perdu ne peut pas être
réaffiché : en créer un nouveau et révoquer l'ancien.

Le lien d'accès et le token sont indépendants : révoquer un lien ne déconnecte pas
le tracker, et désactiver un compte ne coupe pas l'accès au site. Pour un départ,
faire les deux.

### Recalculer les données

Admin web → **Maintenance** → **Recalculer les livraisons** : reconstruit
livraisons, kilométrage et temps de conduite depuis les données brutes reçues.
Utile seulement après un incident ; une mise à jour qui change les règles de calcul
le fait d'elle-même au redémarrage.

## 5. Questions fréquentes

**Un chauffeur ne voit pas sa livraison.** Elle apparaît à la livraison dans le jeu.
Vérifier dans son tracker l'état « Connecté au serveur » et le nombre d'événements
en attente ; une mission commencée avant le lancement du tracker est bien comptée,
à sa livraison.

**Le tracker dit « Token personnel invalide ou révoqué ».** Le token a été régénéré
ou le compte désactivé : lui transmettre un nouveau token.

**Un chauffeur n'apparaît pas « en ligne ».** Il l'est quand son tracker a envoyé des
données dans les 2 dernières minutes, jeu lancé.

**Le journal du tracker** (pour aider un chauffeur) : `%APPDATA%\ets-vtc\tracker.log`
sur son PC.
