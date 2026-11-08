// Configuration locale du tracker : %APPDATA%\ets-vtc\config.json.
// Le token personnel n'y figure jamais : il est chiffré à part (voir secrets.js).
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  serverUrl: '',
  gameDir: '',
  snapshotIntervalMs: 5000,
  autoStartTracking: true,
};

const LIMITS = { snapshotIntervalMs: [1000, 60000] };

export function loadConfig(dir) {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8'));
    return sanitize({ ...DEFAULT_CONFIG, ...raw });
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(dir, config) {
  const clean = sanitize({ ...DEFAULT_CONFIG, ...config });
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(clean, null, 2));
  renameSync(`${file}.tmp`, file);
  return clean;
}

export function sanitize(config) {
  const out = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) out[key] = config[key] ?? DEFAULT_CONFIG[key];
  out.serverUrl = normalizeServerUrl(out.serverUrl);
  const [min, max] = LIMITS.snapshotIntervalMs;
  out.snapshotIntervalMs = Math.min(max, Math.max(min, Number(out.snapshotIntervalMs) || DEFAULT_CONFIG.snapshotIntervalMs));
  out.autoStartTracking = Boolean(out.autoStartTracking);
  out.gameDir = String(out.gameDir ?? '');
  return out;
}

/** "vtc.exemple.fr/" → "https://vtc.exemple.fr" ; http accepté seulement en local. */
export function normalizeServerUrl(value) {
  let v = String(value ?? '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  const url = new URL(v);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol === 'http:' && !local) url.protocol = 'https:';
  return url.origin;
}
