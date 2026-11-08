// Pont minimal et typé entre l'interface (sandboxée) et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

const call = async (name, arg) => {
  const r = await ipcRenderer.invoke(name, arg);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

contextBridge.exposeInMainWorld('vtc', {
  getState: () => call('getState'),
  login: (serverUrl, token) => call('login', { serverUrl, token }),
  logout: () => call('logout'),
  detectGames: () => call('detectGames'),
  chooseGameDir: () => call('chooseGameDir'),
  installPlugin: () => call('installPlugin'),
  uninstallPlugin: () => call('uninstallPlugin'),
  start: () => call('start'),
  stop: () => call('stop'),
  saveSettings: (patch) => call('saveSettings', patch),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
});
