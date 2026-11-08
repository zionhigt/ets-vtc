import { safeStringify } from '@ets-vtc/shared';

const COLUMNS = ['user_id', 'event_id', 'seq', 'type', 'client_ts', 'received_at', 'data'];

/**
 * Enregistre un lot d'événements dans le journal brut (immuable).
 * Idempotent : un événement déjà reçu (même user + même id) est ignoré.
 * @returns {{received:number, accepted:number, duplicates:number}}
 */
export async function ingestEvents(db, userId, events) {
  const receivedAt = Date.now();
  // Dédoublonnage dans le lot lui-même (le même id envoyé deux fois dans un lot).
  const unique = new Map();
  for (const e of events) if (!unique.has(e.id)) unique.set(e.id, e);
  const rows = [...unique.values()].map((e) => [
    userId,
    e.id,
    e.seq ?? null,
    e.type,
    e.ts,
    receivedAt,
    e.data === undefined ? null : safeStringify(e.data),
  ]);
  const accepted = await db.insertIgnore('raw_events', COLUMNS, rows);
  return { received: events.length, accepted, duplicates: events.length - accepted };
}

export async function eventStats(db, userId) {
  const total = await db.get(
    'SELECT COUNT(*) AS count, MIN(client_ts) AS first_ts, MAX(client_ts) AS last_ts FROM raw_events WHERE user_id = ?',
    [userId],
  );
  const byType = await db.all(
    'SELECT type, COUNT(*) AS count FROM raw_events WHERE user_id = ? GROUP BY type ORDER BY type',
    [userId],
  );
  return {
    count: Number(total.count),
    firstTs: total.first_ts === null ? null : Number(total.first_ts),
    lastTs: total.last_ts === null ? null : Number(total.last_ts),
    byType: Object.fromEntries(byType.map((r) => [r.type, Number(r.count)])),
  };
}
