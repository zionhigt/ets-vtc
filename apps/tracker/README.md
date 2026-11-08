# Tracker ets-vtc

Application Windows (Electron) que chaque chauffeur lance pendant qu'il joue.
Elle installe le plugin de télémétrie dans Euro Truck Simulator 2, lit la
télémétrie et envoie les événements au serveur de la VTC.

## Pour le chauffeur

1. Lancer `ets-vtc-<version>.exe` (exécutable portable, sans installation).
2. Saisir l'adresse du site de la VTC et le token personnel donné par l'admin.
3. Cliquer sur **Détecter** (ou **Choisir le dossier…**), puis **Installer le plugin**,
   jeu fermé.
4. Lancer le jeu et valider le message sur les fonctionnalités SDK avancées.

Le suivi démarre seul. Fermer la fenêtre laisse le tracker actif dans la zone de
notification ; **Quitter** depuis l'icône l'arrête. Sans réseau, les événements
sont gardés sur le disque et envoyés au retour de la connexion.

Données locales, dans `%APPDATA%\ets-vtc` : `config.json` (paramètres),
`token.bin` (token chiffré par Windows pour l'utilisateur courant), `queue/`
(événements en attente d'envoi).

## Pour le développement

Le tracker n'est pas dans les workspaces npm du dépôt : il ne doit pas être installé
sur l'hébergement du serveur.

```sh
cd apps/tracker
npm install            # Electron et le module natif de télémétrie (outils C++ requis)
npm test               # modules sans Electron + intégration avec l'API
npm start              # lance l'application
```

Prérequis Windows : Node 22+, Visual Studio Build Tools (charge de travail
« Développement Desktop en C++ ») pour compiler `trucksim-telemetry`.

## Construire l'exécutable

```sh
npm run plugin:copy    # copie scs-telemetry.dll depuis le jeu installé (ou: npm run plugin:copy -- chemin\vers\scs-telemetry.dll)
npm run dist           # dist/ets-vtc-<version>.exe
```

La DLL est le plugin [scs-sdk-plugin](https://github.com/RenCloud/scs-sdk-plugin)
de RenCloud, version **1.12.1** (celle prise en charge par `trucksim-telemetry`
1.0.0). Elle n'est pas versionnée dans le dépôt.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `src/core/*` | logique testable sans Electron : configuration, détection du jeu et plugin, file persistante, client API, tracker |
| `src/main/main.js` | processus principal : fenêtre, icône de notification, IPC |
| `src/main/telemetry-worker.cjs` | lit la télémétrie dans un processus isolé : la librairie n'a pas de méthode d'arrêt et plante quand le jeu est fermé |
| `src/main/preload.cjs` | pont minimal entre l'interface et le processus principal |
| `src/renderer/*` | interface |
