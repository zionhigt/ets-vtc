// Détection des installations d'ETS2 et gestion du plugin de télémétrie (DLL).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);

export const ETS2_APP_ID = '227300';
export const ETS2_EXE = 'eurotrucks2.exe';
export const PLUGIN_FILE = 'scs-telemetry.dll';
const ETS2_FOLDER = 'Euro Truck Simulator 2';

/** Extrait les chemins des bibliothèques Steam (et celles qui contiennent ETS2) d'un libraryfolders.vdf. */
export function parseLibraryFolders(vdf) {
  const libraries = [];
  const blocks = vdf.split(/\n\s*"\d+"\s*\n\s*\{/).slice(1);
  for (const block of blocks) {
    const p = block.match(/"path"\s+"([^"]+)"/);
    if (!p) continue;
    const libPath = p[1].replace(/\\\\/g, '\\');
    const apps = block.match(/"apps"\s*\{([^}]*)\}/);
    const hasEts2 = apps ? new RegExp(`"${ETS2_APP_ID}"`).test(apps[1]) : null;
    libraries.push({ path: libPath, hasEts2 });
  }
  return libraries;
}

export async function steamPathFromRegistry() {
  try {
    const { stdout } = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true });
    const m = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
    return m ? path.normalize(m[1].trim()) : null;
  } catch {
    return null;
  }
}

export function pluginDir(gameDir) {
  return path.join(gameDir, 'bin', 'win_x64', 'plugins');
}

export function isGameDir(dir) {
  return Boolean(dir) && existsSync(path.join(dir, 'bin', 'win_x64', ETS2_EXE));
}

/** Liste les installations d'ETS2 trouvées via Steam. */
export async function findGameInstalls({ steamPath } = {}) {
  const candidates = new Set();
  const steam = steamPath ?? (await steamPathFromRegistry()) ?? 'C:\\Program Files (x86)\\Steam';
  const vdfFile = path.join(steam, 'steamapps', 'libraryfolders.vdf');
  const libraries = existsSync(vdfFile) ? parseLibraryFolders(readFileSync(vdfFile, 'utf8')) : [{ path: steam, hasEts2: null }];
  for (const lib of libraries) {
    if (lib.hasEts2 === false) continue;
    candidates.add(path.join(lib.path, 'steamapps', 'common', ETS2_FOLDER));
  }
  return [...candidates].filter(isGameDir);
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * État du plugin dans une installation.
 * @returns {{gameFound:boolean, installed:boolean, upToDate:boolean|null, path:string}}
 */
export function pluginStatus(gameDir, bundledDll) {
  const target = path.join(pluginDir(gameDir), PLUGIN_FILE);
  if (!isGameDir(gameDir)) return { gameFound: false, installed: false, upToDate: null, path: target };
  const installed = existsSync(target);
  const upToDate = installed && bundledDll && existsSync(bundledDll) ? sha256(target) === sha256(bundledDll) : null;
  return { gameFound: true, installed, upToDate, path: target };
}

/** Copie la DLL fournie dans le jeu ; l'ancienne est conservée en .bak. */
export function installPlugin(gameDir, bundledDll) {
  if (!isGameDir(gameDir)) throw new Error("Ce dossier n'est pas une installation d'Euro Truck Simulator 2");
  if (!bundledDll || !existsSync(bundledDll)) throw new Error('Plugin introuvable dans le tracker');
  const dir = pluginDir(gameDir);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, PLUGIN_FILE);
  if (existsSync(target)) renameSync(target, `${target}.bak`);
  copyFileSync(bundledDll, target);
  return pluginStatus(gameDir, bundledDll);
}

export function uninstallPlugin(gameDir) {
  const target = path.join(pluginDir(gameDir), PLUGIN_FILE);
  if (existsSync(target)) unlinkSync(target);
  return pluginStatus(gameDir, null);
}

export async function isGameRunning() {
  try {
    const { stdout } = await run('tasklist', ['/FI', `IMAGENAME eq ${ETS2_EXE}`, '/NH'], { windowsHide: true });
    return stdout.toLowerCase().includes(ETS2_EXE);
  } catch {
    return false;
  }
}
