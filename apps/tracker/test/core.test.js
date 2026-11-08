import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig, normalizeServerUrl } from '../src/core/config.js';
import { parseLibraryFolders, pluginStatus, installPlugin, uninstallPlugin, findGameInstalls, isGameDir } from '../src/core/game.js';
import { PersistentQueue } from '../src/core/queue.js';
import { SecretStore } from '../src/core/secrets.js';
import { compareVersions } from '../src/core/client.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'ets-vtc-'));

test("normalizeServerUrl accepte une adresse saisie à la main et force https hors local", () => {
  assert.equal(normalizeServerUrl('vtc.exemple.fr/'), 'https://vtc.exemple.fr');
  assert.equal(normalizeServerUrl('http://vtc.exemple.fr/admin'), 'https://vtc.exemple.fr');
  assert.equal(normalizeServerUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeServerUrl(''), '');
});

test('la configuration est bornée et persistée', () => {
  const dir = tmp();
  assert.equal(loadConfig(dir).snapshotIntervalMs, 5000);
  const saved = saveConfig(dir, { serverUrl: 'vtc.exemple.fr', snapshotIntervalMs: 10, inconnu: 1 });
  assert.equal(saved.snapshotIntervalMs, 1000);
  assert.equal(saved.serverUrl, 'https://vtc.exemple.fr');
  assert.equal('inconnu' in saved, false);
  assert.deepEqual(loadConfig(dir), saved);
  assert.equal(readFileSync(path.join(dir, 'config.json'), 'utf8').includes('token'), false);
});

const VDF = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"apps"
		{
			"228980"		"227818703"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
		"apps"
		{
			"227300"		"38096140043"
		}
	}
}`;

test('parseLibraryFolders repère la bibliothèque qui contient ETS2', () => {
  assert.deepEqual(parseLibraryFolders(VDF), [
    { path: 'C:\\Program Files (x86)\\Steam', hasEts2: false },
    { path: 'D:\\SteamLibrary', hasEts2: true },
  ]);
});

function fakeGame(root) {
  const game = path.join(root, 'steamapps', 'common', 'Euro Truck Simulator 2');
  mkdirSync(path.join(game, 'bin', 'win_x64'), { recursive: true });
  writeFileSync(path.join(game, 'bin', 'win_x64', 'eurotrucks2.exe'), 'exe');
  return game;
}

test('findGameInstalls trouve le jeu via libraryfolders.vdf', async () => {
  const steam = tmp();
  const game = fakeGame(steam);
  mkdirSync(path.join(steam, 'steamapps'), { recursive: true });
  writeFileSync(
    path.join(steam, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam.replace(/\\/g, '\\\\')}"\n\t\t"apps"\n\t\t{\n\t\t\t"227300"\t\t"1"\n\t\t}\n\t}\n}`,
  );
  assert.deepEqual(await findGameInstalls({ steamPath: steam }), [game]);
});

test('installation, mise à jour et retrait du plugin', () => {
  const root = tmp();
  const game = fakeGame(root);
  const dll = path.join(root, 'bundled.dll');
  writeFileSync(dll, 'dll v2');

  assert.equal(isGameDir(game), true);
  assert.deepEqual(
    { ...pluginStatus(game, dll), path: undefined },
    { gameFound: true, installed: false, upToDate: null, path: undefined },
  );

  // Ancienne version présente : signalée, puis remplacée avec sauvegarde.
  mkdirSync(path.join(game, 'bin', 'win_x64', 'plugins'));
  writeFileSync(path.join(game, 'bin', 'win_x64', 'plugins', 'scs-telemetry.dll'), 'dll v1');
  assert.equal(pluginStatus(game, dll).upToDate, false);
  const after = installPlugin(game, dll);
  assert.equal(after.upToDate, true);
  assert.equal(readFileSync(`${after.path}.bak`, 'utf8'), 'dll v1');

  assert.equal(uninstallPlugin(game).installed, false);
  assert.throws(() => installPlugin(root, dll), /installation d'Euro Truck Simulator 2/);
});

test('la file survit à un redémarrage et à une ligne tronquée', () => {
  const dir = tmp();
  const q = new PersistentQueue(dir);
  for (let i = 0; i < 5; i++) q.push({ id: `evt-${i}`, type: 'gear-change', data: { big: 10n } });
  q.ack(2);
  appendFileSync(path.join(dir, 'queue.ndjson'), '{"id":"tronq'); // plantage pendant l'écriture

  const reloaded = new PersistentQueue(dir);
  assert.deepEqual(reloaded.peek(10).map((e) => e.id), ['evt-2', 'evt-3', 'evt-4']);
  assert.equal(reloaded.peek(1)[0].data.big, '10');
});

test('file pleine : les snapshots les plus anciens sont sacrifiés, jamais les missions', () => {
  const q = new PersistentQueue(tmp(), { maxItems: 3 });
  q.push({ id: 'a', type: 'snapshot' });
  q.push({ id: 'b', type: 'job-started' });
  q.push({ id: 'c', type: 'snapshot' });
  q.push({ id: 'd', type: 'job-delivered' });
  assert.deepEqual(q.peek(10).map((e) => e.id), ['b', 'c', 'd']);
  q.push({ id: 'e', type: 'fine' });
  assert.deepEqual(q.peek(10).map((e) => e.id), ['b', 'd', 'e']);
  assert.equal(q.push({ id: 'f', type: 'fine' }), false);
  assert.equal(q.dropped, 2);
});

test('le token est stocké chiffré, jamais en clair', () => {
  const dir = tmp();
  const fakeCrypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s).reverse(),
    decryptString: (b) => Buffer.from(b).reverse().toString(),
  };
  const store = new SecretStore(dir, fakeCrypto);
  store.save('vtc_secret');
  assert.equal(readFileSync(path.join(dir, 'token.bin')).includes('vtc_secret'), false);
  assert.equal(store.load(), 'vtc_secret');
  store.clear();
  assert.equal(existsSync(path.join(dir, 'token.bin')), false);
  assert.throws(() => new SecretStore(dir, { ...fakeCrypto, isEncryptionAvailable: () => false }).save('x'), /Chiffrement indisponible/);
});

test('compareVersions', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
});
