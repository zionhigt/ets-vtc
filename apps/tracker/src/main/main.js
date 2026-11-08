// Processus principal Electron : fenêtre, icône de notification, IPC, cycle de vie.
import { app, BrowserWindow, Tray, Menu, ipcMain, safeStorage, dialog, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, saveConfig, normalizeServerUrl } from '../core/config.js';
import { SecretStore } from '../core/secrets.js';
import { PersistentQueue } from '../core/queue.js';
import { ApiClient, AuthError, compareVersions } from '../core/client.js';
import { Tracker } from '../core/tracker.js';
import { findGameInstalls, pluginStatus, installPlugin, uninstallPlugin, isGameRunning, isGameDir } from '../core/game.js';
import { WorkerTelemetry } from './worker-telemetry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.env.ETS_VTC_SMOKE === '1';

if (!app.requestSingleInstanceLock()) app.quit();

const dataDir = app.getPath('userData');
const log = (...a) => console.log('[ets-vtc]', ...a);

/** DLL fournie avec le tracker (resources/plugin en dev, à côté de l'exe une fois packagé). */
function bundledDll() {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'plugin', 'scs-telemetry.dll'),
    path.join(here, '..', '..', 'resources', 'plugin', 'scs-telemetry.dll'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

let config = loadConfig(dataDir);
const secrets = new SecretStore(dataDir, safeStorage);
const queue = new PersistentQueue(path.join(dataDir, 'queue'));
let client = null;
let tracker = null;
let user = null;
let win = null;
let tray = null;
let versionInfo = null;

function state() {
  return {
    appVersion: app.getVersion(),
    config,
    loggedIn: Boolean(user),
    user,
    hasToken: Boolean(secrets.load()),
    encryptionAvailable: secrets.available,
    tracker: tracker?.status ?? { state: 'stopped', label: 'Arrêté', running: false, job: null, queued: queue.size, server: {} },
    plugin: config.gameDir ? pluginStatus(config.gameDir, bundledDll()) : null,
    bundledPlugin: Boolean(bundledDll()),
    update: versionInfo,
  };
}

function push() {
  win?.webContents.send('state', state());
  const s = tracker?.status;
  tray?.setToolTip(`ets-vtc · ${s?.label ?? 'Arrêté'}${s?.queued ? ` · ${s.queued} en attente` : ''}`);
}

function buildTracker() {
  tracker?.stop();
  tracker = new Tracker({
    createTelemetry: () => new WorkerTelemetry({ log }),
    client,
    queue,
    snapshotIntervalMs: config.snapshotIntervalMs,
  });
  tracker.on('status', push);
  tracker.on('auth-error', () => {
    tracker.stop();
    user = null;
    push();
  });
}

async function connect(serverUrl, token) {
  const c = new ApiClient({ serverUrl, personalToken: token });
  const version = await c.version();
  versionInfo = { min: version.minTrackerVersion, outdated: compareVersions(app.getVersion(), version.minTrackerVersion) < 0 };
  if (versionInfo.outdated) throw new Error(`Version du tracker trop ancienne : ${version.minTrackerVersion} minimum requise`);
  user = await c.login();
  client = c;
  buildTracker();
  if (config.autoStartTracking) tracker.start();
  push();
}

// --- IPC (appelé par l'interface via preload.cjs) ---
const handlers = {
  getState: () => state(),

  async login({ serverUrl, token }) {
    const url = normalizeServerUrl(serverUrl);
    if (!url) throw new Error("Renseigne l'adresse du serveur");
    await connect(url, token.trim());
    secrets.save(token.trim());
    config = saveConfig(dataDir, { ...config, serverUrl: url });
    return state();
  },

  async logout() {
    await tracker?.stop();
    tracker = null;
    client = null;
    user = null;
    secrets.clear();
    return state();
  },

  async detectGames() {
    const installs = await findGameInstalls();
    if (!config.gameDir && installs[0]) config = saveConfig(dataDir, { ...config, gameDir: installs[0] });
    return { installs, state: state() };
  },

  async chooseGameDir() {
    const r = await dialog.showOpenDialog(win, { title: "Dossier d'installation d'Euro Truck Simulator 2", properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return state();
    if (!isGameDir(r.filePaths[0])) throw new Error("Ce dossier ne contient pas Euro Truck Simulator 2 (bin\\win_x64\\eurotrucks2.exe)");
    config = saveConfig(dataDir, { ...config, gameDir: r.filePaths[0] });
    return state();
  },

  async installPlugin() {
    if (await isGameRunning()) throw new Error("Ferme Euro Truck Simulator 2 avant d'installer le plugin");
    installPlugin(config.gameDir, bundledDll());
    return state();
  },

  async uninstallPlugin() {
    if (await isGameRunning()) throw new Error("Ferme Euro Truck Simulator 2 avant de retirer le plugin");
    uninstallPlugin(config.gameDir);
    return state();
  },

  start() {
    if (!tracker) throw new Error("Connecte-toi d'abord");
    tracker.start();
    return state();
  },

  async stop() {
    await tracker?.stop();
    return state();
  },

  saveSettings(patch) {
    const allowed = ['snapshotIntervalMs', 'autoStartTracking', 'startWithWindows'];
    const next = { ...config };
    for (const k of allowed) if (k in patch) next[k] = patch[k];
    config = saveConfig(dataDir, next);
    app.setLoginItemSettings({ openAtLogin: config.startWithWindows, args: ['--hidden'] });
    if (tracker) {
      const wasRunning = tracker.running;
      buildTracker();
      if (wasRunning) tracker.start();
    }
    return state();
  },
};

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(name, async (_e, arg) => {
    try {
      return { ok: true, value: await fn(arg) };
    } catch (err) {
      return { ok: false, error: err instanceof AuthError ? `${err.message}. Demande un nouveau token à l'admin.` : err.message };
    }
  });
}

// --- Fenêtre et zone de notification ---
function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 420,
    show: false,
    title: 'ets-vtc',
    autoHideMenuBar: true,
    icon: path.join(here, '..', 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadFile(path.join(here, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden') && !SMOKE) win.show();
  });
  // Fermer la fenêtre garde le tracker actif dans la zone de notification.
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(here, '..', 'renderer', process.platform === 'win32' ? 'icon.ico' : 'icon.png')));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir', click: () => win.show() },
      { label: 'Démarrer le suivi', click: () => tracker?.start() },
      { label: 'Arrêter le suivi', click: () => tracker?.stop() },
      { type: 'separator' },
      { label: 'Quitter', click: () => quit() },
    ]),
  );
  tray.on('double-click', () => win.show());
}

async function quit() {
  app.isQuitting = true;
  await tracker?.stop();
  app.quit();
}

app.on('second-instance', () => win?.show());
app.on('window-all-closed', (e) => e.preventDefault?.());

app.whenReady().then(async () => {
  createWindow();
  createTray();
  const token = secrets.load();
  if (token && config.serverUrl) {
    try {
      await connect(config.serverUrl, token);
    } catch (err) {
      log(`reconnexion impossible : ${err.message}`);
    }
  }
  push();
  if (SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      const title = await win.webContents.executeJavaScript('document.querySelector("h1")?.textContent ?? ""');
      log(`SMOKE OK · fenêtre chargée (« ${title} ») · plugin fourni : ${Boolean(bundledDll())} · jeux : ${(await findGameInstalls()).length}`);
      app.isQuitting = true;
      app.quit();
    });
  }
});
