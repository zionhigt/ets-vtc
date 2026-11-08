// Régression : après un redémarrage brutal du serveur, un envoi restait bloqué
// indéfiniment et plus aucun lot ne partait (ni Arrêter/Démarrer ne débloquait).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApiClient, OfflineError } from '../src/core/client.js';
import { PersistentQueue } from '../src/core/queue.js';
import { Tracker } from '../src/core/tracker.js';

test("une requête sans réponse est coupée au délai, même si fetch ignore l'annulation", async () => {
  const neverEnding = () => new Promise(() => {}); // fetch qui ne se termine jamais, annulation comprise
  const client = new ApiClient({ serverUrl: 'http://127.0.0.1:1', personalToken: 'x', fetch: neverEnding, timeoutMs: 200 });
  const started = Date.now();
  await assert.rejects(client.login(), OfflineError);
  assert.ok(Date.now() - started < 1000);
});

test('un serveur qui accepte la connexion mais ne répond jamais ne bloque pas le client', async () => {
  const sockets = [];
  const mute = createServer((s) => sockets.push(s)).listen(0);
  await new Promise((r) => mute.once('listening', r));
  try {
    const client = new ApiClient({ serverUrl: `http://127.0.0.1:${mute.address().port}`, personalToken: 'x', timeoutMs: 300 });
    await assert.rejects(client.login(), /pas de réponse|Serveur injoignable/);
  } finally {
    sockets.forEach((s) => s.destroy());
    mute.close();
  }
});

test('chien de garde : un envoi bloqué est abandonné, le suivant part, la file reste juste', async () => {
  let now = 0;
  const calls = [];
  let release;
  const client = {
    sendEvents(batch) {
      calls.push(batch.map((e) => e.id));
      // Premier envoi : bloqué jusqu'à ce qu'on le libère. Les suivants réussissent.
      if (calls.length === 1) return new Promise((r) => (release = r));
      return Promise.resolve({ accepted: batch.length });
    },
  };
  const queue = new PersistentQueue(mkdtempSync(path.join(tmpdir(), 'ets-vtc-wd-')));
  const tracker = new Tracker({
    createTelemetry: () => new EventEmitter(),
    client,
    queue,
    stuckAfterMs: 60_000,
    now: () => now,
  });
  const logs = [];
  tracker.on('log', (m) => logs.push(m));
  queue.push({ id: 'a', type: 'engine' });
  queue.push({ id: 'b', type: 'engine' });

  const stuck = tracker.flush();
  await tracker.flush(); // pendant le blocage : ignoré
  assert.equal(calls.length, 1);

  now = 61_000; // une minute plus tard
  await tracker.flush();
  assert.equal(calls.length, 2, 'le chien de garde relance un envoi');
  assert.equal(queue.size, 0);
  assert.match(logs.join('\n'), /envoi bloqué depuis 61 s/);

  // L'ancien envoi se termine enfin : il ne doit pas acquitter une seconde fois.
  queue.push({ id: 'c', type: 'engine' });
  release({ accepted: 2 });
  await stuck;
  assert.deepEqual(queue.peek(10).map((e) => e.id), ['c'], "l'envoi abandonné n'a rien retiré de la file");
});
