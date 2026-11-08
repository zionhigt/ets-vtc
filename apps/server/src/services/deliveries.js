// Job « Reconstitution des livraisons » : transforme le journal brut d'un chauffeur
// en livraisons (job-started → job-delivered / job-cancelled), avec amendes et péages.
// Incrémental (curseur par chauffeur) et rejouable (rebuildAll).
import { toNumber } from '../shared.js';
import { applySnapshot } from './mileage.js';

const JOB_TYPES = ['job-started', 'job-delivered', 'job-cancelled', 'fine', 'tollgate', 'snapshot'];
const PAGE = 500;

const num = (v) => {
  const n = toNumber(v);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const bool = (v) => (v === undefined || v === null ? null : v ? 1 : 0);

/** Champs communs à job-started et job-delivered. */
function jobFields(d) {
  return {
    cargo: d.cargo ?? null,
    cargo_id: d.cargoId ?? null,
    cargo_mass: num(d.cargoMass),
    city_src: d.citySrc ?? null,
    city_src_id: d.citySrcId ?? null,
    city_dst: d.cityDst ?? null,
    city_dst_id: d.cityDstId ?? null,
    company_src: d.compSrc ?? null,
    company_dst: d.compDst ?? null,
    job_market: d.jobMarket ?? null,
    special_job: d.specialJob ? 1 : 0,
    planned_distance_km: num(d.plannedDistanceKm),
  };
}

/** Même mission ? (le jeu ne fournit pas d'identifiant de mission) */
function sameJob(delivery, d) {
  return delivery.cargo_id === (d.cargoId ?? null) && delivery.city_dst_id === (d.cityDstId ?? null) && delivery.city_src_id === (d.citySrcId ?? null);
}

async function insertDelivery(db, userId, ev, status, fields) {
  const row = { user_id: userId, status, source_event_id: ev.event_id, started_at: Number(ev.client_ts), ...fields };
  const cols = Object.keys(row);
  await db.insertIgnore('deliveries', cols, [Object.values(row)]);
  return db.get('SELECT * FROM deliveries WHERE user_id = ? AND source_event_id = ?', [userId, ev.event_id]);
}

async function updateDelivery(db, id, fields) {
  const cols = Object.keys(fields);
  await db.run(`UPDATE deliveries SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...Object.values(fields), id]);
}

async function currentDelivery(db, userId) {
  return db.get("SELECT * FROM deliveries WHERE user_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1", [userId]);
}

async function applyEvent(db, userId, ev) {
  const d = ev.data ? JSON.parse(ev.data) : {};
  const ts = Number(ev.client_ts);
  const open = await currentDelivery(db, userId);

  switch (ev.type) {
    case 'job-started': {
      if (open) {
        if (sameJob(open, d)) return; // reprise de la même mission (relance du jeu ou du tracker)
        await updateDelivery(db, open.id, { status: 'interrupted', ended_at: ts });
      }
      await insertDelivery(db, userId, ev, 'in_progress', { ...jobFields(d), income: num(d.jobIncome) });
      return;
    }
    case 'job-delivered': {
      const result = {
        status: 'delivered',
        ended_at: ts,
        revenue: num(d.jobDeliveredRevenue),
        distance_km: num(d.jobDeliveredDistanceKm),
        delivery_time_min: num(d.jobDeliveredDeliveryTime),
        earned_xp: num(d.jobDeliveredEarnedXp),
        cargo_damage: num(d.jobDeliveredCargoDamage),
        autopark: bool(d.jobDeliveredAutoparkUsed),
        autoload: bool(d.jobDeliveredAutoloadUsed),
      };
      if (open && sameJob(open, d)) {
        await updateDelivery(db, open.id, result);
        return;
      }
      if (open) await updateDelivery(db, open.id, { status: 'interrupted', ended_at: ts });
      // Mission commencée avant le lancement du tracker : livraison créée à la livraison.
      const created = await insertDelivery(db, userId, ev, 'delivered', { ...jobFields(d), income: num(d.jobIncome) });
      await updateDelivery(db, created.id, result);
      return;
    }
    case 'job-cancelled': {
      if (!open) return;
      await updateDelivery(db, open.id, { status: 'cancelled', ended_at: ts, cancel_penalty: num(d.jobCancelledPenalty ?? d.cancelPenalty) });
      return;
    }
    case 'fine': {
      if (!open) return;
      await updateDelivery(db, open.id, { fines_count: open.fines_count + 1, fines_total: open.fines_total + (num(d.fineAmount) ?? 0) });
      return;
    }
    case 'tollgate': {
      if (!open) return;
      await updateDelivery(db, open.id, { tolls_total: open.tolls_total + (num(d.tollgatePayAmount) ?? 0) });
      return;
    }
  }
}

// Un seul traitement à la fois par chauffeur (deux lots simultanés ne doivent pas
// compter deux fois la même amende). Suffisant : Passenger lance un seul processus.
const locks = new Map();

/** Traite les nouveaux événements d'un chauffeur depuis le dernier passage. */
export function processUser(db, userId) {
  const previous = locks.get(userId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => processUserNow(db, userId));
  locks.set(userId, run);
  run.finally(() => locks.get(userId) === run && locks.delete(userId)).catch(() => {});
  return run;
}

async function processUserNow(db, userId) {
  const cursor = await db.get('SELECT last_raw_id FROM job_cursors WHERE user_id = ?', [userId]);
  let last = cursor ? Number(cursor.last_raw_id) : 0;
  const placeholders = JOB_TYPES.map(() => '?').join(', ');
  let processed = 0;
  for (;;) {
    const events = await db.all(
      `SELECT id, event_id, type, client_ts, data FROM raw_events
       WHERE user_id = ? AND id > ? AND type IN (${placeholders}) ORDER BY id LIMIT ${PAGE}`,
      [userId, last, ...JOB_TYPES],
    );
    if (!events.length) break;
    for (const ev of events) {
      if (ev.type === 'snapshot') await applySnapshot(db, userId, ev);
      else await applyEvent(db, userId, ev);
      last = Number(ev.id);
      processed++;
    }
    if (events.length < PAGE) break;
  }
  if (!processed) return 0;
  if (cursor) await db.run('UPDATE job_cursors SET last_raw_id = ? WHERE user_id = ?', [last, userId]);
  else await db.insertIgnore('job_cursors', ['user_id', 'last_raw_id'], [[userId, last]]);
  return processed;
}

/**
 * Version des règles des jobs. À incrémenter quand un job change ce qu'il
 * produit : au démarrage, le serveur recalcule alors tout depuis le journal brut.
 */
export const JOBS_VERSION = '3';

export async function ensureJobsUpToDate(db, log = () => {}) {
  const row = await db.get("SELECT meta_value FROM app_meta WHERE meta_key = 'jobs_version'");
  if (row?.meta_value === JOBS_VERSION) return false;
  log(`règles des jobs v${row?.meta_value ?? 'aucune'} → v${JOBS_VERSION} : recalcul depuis le journal brut`);
  const processed = await rebuildAll(db);
  const updated = await db.run("UPDATE app_meta SET meta_value = ? WHERE meta_key = 'jobs_version'", [JOBS_VERSION]);
  if (!updated.changes) await db.insertIgnore('app_meta', ['meta_key', 'meta_value'], [['jobs_version', JOBS_VERSION]]);
  log(`recalcul terminé (${processed} événements)`);
  return true;
}

/** Recalcule livraisons, activité et état en direct depuis le journal brut. */
export async function rebuildAll(db) {
  await db.run('DELETE FROM deliveries');
  await db.run('DELETE FROM daily_activity');
  await db.run('DELETE FROM driving_state');
  await db.run('DELETE FROM live_state');
  await db.run('DELETE FROM job_cursors');
  const users = await db.all('SELECT id FROM users ORDER BY id');
  let processed = 0;
  for (const u of users) processed += await processUser(db, Number(u.id));
  return processed;
}
