const $ = (id) => document.getElementById(id);
let current = null;

function showError(message) {
  const box = $('error');
  box.textContent = message;
  box.hidden = !message;
}

async function action(fn) {
  showError('');
  try {
    render(await fn());
  } catch (err) {
    showError(err.message);
  }
}

function render(s) {
  if (!s) return;
  current = s;
  $('version').textContent = `v${s.appVersion}`;
  $('login-view').hidden = s.loggedIn;
  $('main-view').hidden = !s.loggedIn;
  if (!s.loggedIn) {
    if (!$('server').value) $('server').value = s.config.serverUrl.replace(/^https:\/\//, '');
    if (!s.encryptionAvailable) showError("Chiffrement Windows indisponible : le token ne pourra pas être mémorisé.");
    return;
  }

  const t = s.tracker;
  $('who').textContent = `${s.user.displayName} · ${s.config.serverUrl.replace(/^https?:\/\//, '')}`;
  $('state-label').textContent = t.label;
  $('dot').className = `dot ${t.state}`;
  $('toggle').textContent = t.running ? 'Arrêter' : 'Démarrer';
  $('toggle').className = t.running ? 'secondary small' : 'small';
  $('job').hidden = !t.job;
  if (t.job) $('job').textContent = `${t.job.from ?? '?'} → ${t.job.to ?? '?'} · ${t.job.cargo ?? ''}`;
  $('server-line').textContent = t.server?.message ?? '';
  $('server-line').className = t.server?.ok === false ? 'warn' : 'muted';
  $('queue-line').textContent = t.queued ? `${t.queued} événement(s) en attente d'envoi` : '';

  $('game-dir').textContent = s.config.gameDir || 'Aucune installation sélectionnée';
  const p = s.plugin;
  let pluginText = '';
  if (!s.config.gameDir) pluginText = 'Détecte ou choisis le dossier du jeu.';
  else if (!p?.gameFound) pluginText = "Ce dossier ne contient pas le jeu.";
  else if (!p.installed) pluginText = 'Plugin de télémétrie absent : installe-le pour que le suivi fonctionne.';
  else if (p.upToDate === false) pluginText = 'Plugin installé, mais différent de celui fourni : mets-le à jour.';
  else pluginText = 'Plugin de télémétrie installé.';
  $('plugin-line').textContent = pluginText;
  $('plugin-line').className = p?.installed && p.upToDate !== false ? 'ok' : 'warn';
  $('install').hidden = !p?.gameFound || !s.bundledPlugin || (p.installed && p.upToDate !== false);
  $('install').textContent = p?.installed ? 'Mettre à jour le plugin' : 'Installer le plugin';
  $('uninstall').hidden = !p?.installed;

  const f = $('settings');
  f.snapshotIntervalMs.value = String(s.config.snapshotIntervalMs);
  f.autoStartTracking.checked = s.config.autoStartTracking;
}

$('login').addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Connexion…';
  action(async () => {
    try {
      const s = await window.vtc.login(e.target.server.value, e.target.token.value);
      e.target.token.value = '';
      if (!s.config.gameDir) return (await window.vtc.detectGames()).state;
      return s;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Se connecter';
    }
  });
});

$('toggle').addEventListener('click', () => action(() => (current?.tracker.running ? window.vtc.stop() : window.vtc.start())));
$('detect').addEventListener('click', () =>
  action(async () => {
    const r = await window.vtc.detectGames();
    if (!r.installs.length) throw new Error('Aucune installation Steam trouvée : choisis le dossier à la main.');
    return r.state;
  }),
);
$('choose').addEventListener('click', () => action(() => window.vtc.chooseGameDir()));
$('install').addEventListener('click', () => action(() => window.vtc.installPlugin()));
$('uninstall').addEventListener('click', () => action(() => window.vtc.uninstallPlugin()));
$('logout').addEventListener('click', () => action(() => window.vtc.logout()));
$('settings').addEventListener('change', (e) => {
  const f = e.currentTarget;
  action(() =>
    window.vtc.saveSettings({
      snapshotIntervalMs: Number(f.snapshotIntervalMs.value),
      autoStartTracking: f.autoStartTracking.checked,
    }),
  );
});

window.vtc.onState(render);
render(await window.vtc.getState());
