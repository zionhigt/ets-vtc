// Job « Activité » : à partir des snapshots, mission ou non :
//  - kilométrage réel d'après le compteur du camion (truckOdometer), par jour UTC ;
//  - temps de conduite (camion en mouvement), par jour UTC ;
//  - dernier état connu du chauffeur, pour l'affichage en direct.
//
// Le compteur appartient au camion : changer de camion, ou un compteur qui
// recule, provoque un saut. Une progression plus rapide que MAX_KM_PER_S (sur la
// durée écoulée), ou négative, réinitialise la référence sans rien compter.

// Le compteur compte en km « du jeu » (même unité que les distances de mission) :
// le monde étant compressé (~1:19 sur route), il avance bien plus vite que la
// vitesse affichée. Mesuré sur session réelle : ~0,36 km/s sur autoroute.
const MAX_KM_PER_S = 1;
const SLACK_KM = 1;
// Temps de conduite : intervalle entre deux snapshots compté si le camion roule
// et que l'intervalle est court (au-delà, le tracker était coupé ou le jeu en pause).
const MOVING_M_PER_S = 1;
const MAX_GAP_S = 60;

const day = (ts) => new Date(ts).toISOString().slice(0, 10);

async function addActivity(db, userId, d, km, seconds) {
  const updated = await db.run(
    'UPDATE daily_activity SET distance_km = distance_km + ?, driving_s = driving_s + ? WHERE user_id = ? AND day = ?',
    [km, seconds, userId, d],
  );
  if (!updated.changes) {
    await db.insertIgnore('daily_activity', ['user_id', 'day', 'distance_km', 'driving_s'], [[userId, d, km, seconds]]);
  }
}

async function saveLive(db, userId, ts, data) {
  const json = JSON.stringify(data);
  const updated = await db.run('UPDATE live_state SET ts = ?, data = ? WHERE user_id = ? AND ts <= ?', [ts, json, userId, ts]);
  if (!updated.changes) await db.insertIgnore('live_state', ['user_id', 'ts', 'data'], [[userId, ts, json]]);
}

export async function applySnapshot(db, userId, ev) {
  let data;
  try {
    data = JSON.parse(ev.data);
  } catch {
    return;
  }
  if (!data || typeof data !== 'object') return;
  const ts = Number(ev.client_ts);
  await saveLive(db, userId, ts, data);

  const odometer = Number(data.truckOdometer);
  // Jeu non chargé : compteur à zéro, rien à compter.
  if (!Number.isFinite(odometer) || odometer <= 0) return;

  const state = await db.get('SELECT last_odometer, last_ts FROM driving_state WHERE user_id = ?', [userId]);
  if (!state) {
    await db.insertIgnore('driving_state', ['user_id', 'last_odometer', 'last_ts'], [[userId, odometer, ts]]);
    return;
  }

  const delta = odometer - Number(state.last_odometer);
  const elapsedS = Math.max(0, (ts - Number(state.last_ts)) / 1000);
  const plausible = delta > 0 && delta <= SLACK_KM + elapsedS * MAX_KM_PER_S;
  const moving = Math.abs(Number(data.speed) || 0) >= MOVING_M_PER_S && !data.paused;
  const drivingS = moving && elapsedS <= MAX_GAP_S ? Math.round(elapsedS) : 0;

  if (plausible || drivingS) await addActivity(db, userId, day(ts), plausible ? delta : 0, drivingS);
  // Dans tous les cas (y compris saut ou arrêt), la référence devient la dernière valeur lue.
  if (delta !== 0 || ts > Number(state.last_ts)) {
    await db.run('UPDATE driving_state SET last_odometer = ?, last_ts = ? WHERE user_id = ?', [odometer, ts, userId]);
  }
}
