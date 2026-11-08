// Contrat partagé entre le tracker, le serveur et les outils.
import { createHash } from 'node:crypto';

/** Nombre maximal d'événements acceptés par lot d'ingestion. */
export const MAX_BATCH_SIZE = 500;

/** Taille maximale (octets, JSON sérialisé) du champ `data` d'un événement. */
export const MAX_EVENT_DATA_BYTES = 64 * 1024;

/** Format d'un identifiant d'événement : 8 à 64 caractères [A-Za-z0-9_-]. */
export const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Champs conservés d'un snapshot complet (~47 Ko) pour l'envoi au serveur.
 * Suffisent pour la position live, le tracé, les km et le carburant.
 */
export const SNAPSHOT_FIELDS = [
  'game',
  'paused',
  'timeAbs',
  'multiplayerTimeOffset',
  'speed',
  'speedLimit',
  'cruiseControlSpeed',
  'engineRpm',
  'gear',
  'fuel',
  'fuelCapacity',
  'fuelAvgConsumption',
  'truckOdometer',
  'routeDistance',
  'routeTime',
  'coordinateX',
  'coordinateY',
  'coordinateZ',
  'rotationX',
  'cargoDamage',
  'onJob',
  'isCargoLoaded',
  'truckBrand',
  'truckName',
];

/**
 * Convertit une valeur numérique de la télémétrie (nombre, BigInt, ou BigInt
 * sérialisé en texte) en Number. Renvoie la valeur telle quelle sinon.
 */
export function toNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/**
 * Réduit un snapshot de la librairie trucksim-telemetry aux champs utiles.
 * Accepte l'objet `{ current, previous }` de la librairie ou l'état direct.
 */
export function slimSnapshot(snapshot) {
  const state = snapshot && typeof snapshot === 'object' && 'current' in snapshot ? snapshot.current : snapshot;
  if (!state || typeof state !== 'object') return null;
  const out = {};
  for (const key of SNAPSHOT_FIELDS) {
    if (key in state) out[key] = toNumber(state[key]);
  }
  return out;
}

/** Normalise un nom d'événement : `event:job-started` → `job-started`. */
export function normalizeEventType(type) {
  return String(type).replace(/^event:/, '');
}

/** Identifiant déterministe : rejouer la même source produit les mêmes ids. */
export function deterministicEventId(source, index) {
  return createHash('sha256').update(`${source}:${index}`).digest('hex').slice(0, 32);
}

/**
 * Convertit une ligne du logger NDJSON (`{ ts, type, data }`) en événement
 * d'ingestion. Renvoie `null` pour les lignes à ignorer (erreurs du logger).
 *
 * @param {{ts:number, type:string, data:unknown}} record
 * @param {{source:string, index:number, snapshots?:'slim'|'skip'|'full'}} opts
 */
export function recordToEvent(record, { source, index, snapshots = 'slim' }) {
  if (!record || typeof record !== 'object' || typeof record.type !== 'string') return null;
  if (record.type === 'error') return null;
  const type = normalizeEventType(record.type);
  let data = record.data ?? null;
  if (type === 'snapshot') {
    if (snapshots === 'skip') return null;
    if (snapshots === 'slim') data = slimSnapshot(data);
  }
  return {
    id: deterministicEventId(source, index),
    seq: index,
    ts: Number(record.ts),
    type,
    data,
  };
}

/** JSON.stringify qui accepte les BigInt (sérialisés en texte). */
export function safeStringify(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}
