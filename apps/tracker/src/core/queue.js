// File d'envoi persistante : les événements survivent à une coupure réseau, à la
// fermeture du tracker ou à un plantage, et sont renvoyés dans l'ordre.
// Format : un événement JSON par ligne (queue.ndjson) + le nombre de lignes déjà
// acquittées par le serveur (queue.offset). Compactée quand la moitié est acquittée.
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { safeStringify } from '@ets-vtc/shared';

export class PersistentQueue {
  constructor(dir, { maxItems = 200_000 } = {}) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'queue.ndjson');
    this.offsetFile = path.join(dir, 'queue.offset');
    this.maxItems = maxItems;
    this.dropped = 0;
    const lines = existsSync(this.file) ? readFileSync(this.file, 'utf8').split('\n').filter(Boolean) : [];
    const offset = existsSync(this.offsetFile) ? Number(readFileSync(this.offsetFile, 'utf8')) || 0 : 0;
    this.items = [];
    // Une dernière ligne tronquée (plantage pendant l'écriture) est ignorée.
    for (const line of lines.slice(offset)) {
      try {
        this.items.push(JSON.parse(line));
      } catch {
        /* ligne incomplète */
      }
    }
    this.acked = 0;
    this.#rewrite();
  }

  get size() {
    return this.items.length;
  }

  push(event) {
    if (this.items.length >= this.maxItems) {
      // File pleine (longue coupure) : on sacrifie les snapshots les plus anciens, jamais les événements de mission.
      const i = this.items.findIndex((e) => e.type === 'snapshot');
      if (i === -1) return false;
      this.items.splice(i, 1);
      this.dropped++;
      this.#rewrite();
    }
    this.items.push(event);
    appendFileSync(this.file, `${safeStringify(event)}\n`);
    return true;
  }

  peek(n) {
    return this.items.slice(0, n);
  }

  /** Retire les n premiers événements, confirmés par le serveur. */
  ack(n) {
    this.items.splice(0, n);
    this.acked += n;
    if (this.acked > 1000 && this.acked > this.items.length) this.#rewrite();
    else writeFileSync(this.offsetFile, String(this.acked));
  }

  #rewrite() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.items.map((e) => `${safeStringify(e)}\n`).join(''));
    renameSync(tmp, this.file);
    writeFileSync(this.offsetFile, '0');
    this.acked = 0;
  }
}
