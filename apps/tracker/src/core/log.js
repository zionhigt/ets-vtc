// Journal local du tracker (%APPDATA%\ets-vtc\tracker.log), pour le support.
// Taille plafonnée : au-delà de maxBytes, le fichier devient tracker.log.1.
import { appendFileSync, existsSync, renameSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function createLog(dir, { maxBytes = 1024 * 1024, echo = true } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'tracker.log');
  return function log(...parts) {
    const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack ?? p.message : String(p))).join(' ')}\n`;
    if (echo) process.stdout.write(`[ets-vtc] ${line}`);
    try {
      if (existsSync(file) && statSync(file).size > maxBytes) renameSync(file, `${file}.1`);
      appendFileSync(file, line);
    } catch {
      /* le journal ne doit jamais faire tomber le tracker */
    }
  };
}
