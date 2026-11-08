#!/usr/bin/env node
// Rejoue une session NDJSON enregistrée vers l'API, comme le ferait le tracker.
// Les identifiants d'événements sont déterministes : rejouer deux fois le même
// fichier ne crée aucun doublon (critère de sortie de la phase 0).
//
// Usage :
//   node tools/replay-ndjson.js --file logs/session.ndjson --token vtc_xxx \
//     [--server http://localhost:3000] [--batch 200] [--snapshots slim|skip|full]
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordToEvent, MAX_BATCH_SIZE } from '../packages/shared/src/index.js';

export async function replay({ file, server = 'http://localhost:3000', token, batchSize = 200, snapshots = 'slim', log = () => {} }) {
  if (!file || !token) throw new Error('--file et --token sont obligatoires');
  batchSize = Math.min(Math.max(1, Number(batchSize)), MAX_BATCH_SIZE);
  const api = `${server.replace(/\/$/, '')}/api/v1`;
  const source = path.basename(file);

  async function call(method, route, body, accessToken) {
    const res = await fetch(`${api}${route}`, {
      method,
      headers: { 'content-type': 'application/json', ...(accessToken && { authorization: `Bearer ${accessToken}` }) },
      body: body && JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  const login = await call('POST', '/auth/token', { token });
  if (login.status !== 200) throw new Error(`Connexion refusée (${login.status}) : ${login.json.message ?? login.json.error}`);
  let { accessToken, refreshToken } = login.json;
  log(`Connecté en tant que ${login.json.user.displayName}`);

  const summary = { lines: 0, invalid: 0, skipped: 0, sent: 0, accepted: 0, duplicates: 0, batches: 0 };
  let batch = [];

  async function flush() {
    if (!batch.length) return;
    let r = await call('POST', '/telemetry/events', { events: batch }, accessToken);
    if (r.status === 401) {
      const ref = await call('POST', '/auth/refresh', { refreshToken });
      if (ref.status !== 200) throw new Error('Session expirée et rafraîchissement refusé');
      ({ accessToken, refreshToken } = ref.json);
      r = await call('POST', '/telemetry/events', { events: batch }, accessToken);
    }
    if (r.status !== 200) throw new Error(`Lot refusé (${r.status}) : ${JSON.stringify(r.json)}`);
    summary.sent += batch.length;
    summary.accepted += r.json.accepted;
    summary.duplicates += r.json.duplicates;
    summary.batches += 1;
    batch = [];
    if (summary.batches % 10 === 0) log(`${summary.sent} événements envoyés…`);
  }

  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const index = summary.lines++;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      summary.invalid++;
      continue;
    }
    const event = recordToEvent(record, { source, index, snapshots });
    if (!event) {
      summary.skipped++;
      continue;
    }
    batch.push(event);
    if (batch.length >= batchSize) await flush();
  }
  await flush();

  summary.lossless = summary.accepted + summary.duplicates === summary.sent;
  return summary;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const s = await replay({ ...args, batchSize: args.batch, log: (m) => console.log(m) });
    console.log(
      `Lignes : ${s.lines} | ignorées : ${s.skipped} | invalides : ${s.invalid} | envoyées : ${s.sent} ` +
        `| acceptées : ${s.accepted} | doublons : ${s.duplicates} | sans perte : ${s.lossless ? 'oui' : 'NON'}`,
    );
    process.exitCode = s.lossless ? 0 : 2;
  } catch (e) {
    console.error(`Échec : ${e.message}`);
    process.exitCode = 1;
  }
}
