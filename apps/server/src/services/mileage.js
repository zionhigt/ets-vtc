// Job « Kilométrage » : distance réellement parcourue, d'après le compteur du
// camion (truckOdometer) des snapshots, mission ou non. Rangée par jour (UTC).
//
// Le compteur appartient au camion : changer de camion, ou un compteur qui
// recule, provoque un saut. Une progression plus rapide que MAX_KM_PER_S (sur la
// durée écoulée), ou négative, réinitialise la référence sans rien compter.

// Le compteur compte en km « du jeu » (même unité que les distances de mission) :
// le monde étant compressé (~1:19 sur route), il avance bien plus vite que la
// vitesse affichée. Mesuré sur session réelle : ~0,36 km/s sur autoroute.
const MAX_KM_PER_S = 1;
const SLACK_KM = 1;

const day = (ts) => new Date(ts).toISOString().slice(0, 10);

export async function applySnapshot(db, userId, ev) {
  let data;
  try {
    data = JSON.parse(ev.data);
  } catch {
    return;
  }
  const odometer = Number(data?.truckOdometer);
  const ts = Number(ev.client_ts);
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

  if (plausible) {
    const d = day(ts);
    const updated = await db.run('UPDATE driving_days SET distance_km = distance_km + ? WHERE user_id = ? AND day = ?', [
      delta,
      userId,
      d,
    ]);
    if (!updated.changes) await db.insertIgnore('driving_days', ['user_id', 'day', 'distance_km'], [[userId, d, delta]]);
  }
  // Dans tous les cas (y compris saut ou arrêt), la référence devient la dernière valeur lue.
  if (delta !== 0 || ts > Number(state.last_ts)) {
    await db.run('UPDATE driving_state SET last_odometer = ?, last_ts = ? WHERE user_id = ?', [odometer, ts, userId]);
  }
}
