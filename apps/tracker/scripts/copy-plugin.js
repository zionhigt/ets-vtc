// Place la DLL du plugin de télémétrie (scs-sdk-plugin de RenCloud, v1.12.1,
// version prise en charge par trucksim-telemetry 1.0.0) dans resources/plugin,
// pour qu'elle soit embarquée dans l'exécutable. La DLL n'est pas versionnée.
//
//   node scripts/copy-plugin.js [chemin\vers\scs-telemetry.dll]
//     sans argument : copie celle de l'installation ETS2 détectée
//   node scripts/copy-plugin.js --check
//     vérifie seulement sa présence (avant le build)
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGameInstalls, pluginDir, PLUGIN_FILE } from '../src/core/game.js';

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'plugin', PLUGIN_FILE);
const arg = process.argv[2];

if (arg === '--check') {
  if (!existsSync(target)) {
    console.error(`DLL absente : ${target}\nLance d'abord : npm run plugin:copy`);
    process.exit(1);
  }
  console.log(`DLL présente (${statSync(target).size} octets).`);
  process.exit(0);
}

let source = arg;
if (!source) {
  const [game] = await findGameInstalls();
  if (!game) {
    console.error('Aucune installation ETS2 trouvée : passe le chemin de scs-telemetry.dll en argument.');
    process.exit(1);
  }
  source = path.join(pluginDir(game), PLUGIN_FILE);
}
if (!existsSync(source)) {
  console.error(`Introuvable : ${source}\nTélécharge scs-sdk-plugin v1.12.1 (https://github.com/RenCloud/scs-sdk-plugin/releases) et passe le chemin de la DLL win_x64.`);
  process.exit(1);
}
mkdirSync(path.dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Copié : ${source} → ${target}`);
