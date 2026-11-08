// Lectures publiques : uniquement des données affichables (pas d'identifiant de
// connexion, pas de token, pas de données techniques).
const DAY_MS = 24 * 60 * 60 * 1000;
/** Un chauffeur est « en ligne » si son dernier snapshot date de moins de 2 minutes. */
export const ONLINE_MS = 2 * 60 * 1000;

const n = (v) => (v === null || v === undefined ? 0 : Number(v));
const nullable = (v) => (v === null || v === undefined ? null : Number(v));
const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);
const monthStartOf = (ts) => `${dayOf(ts).slice(0, 7)}-01`;
/** Même période le mois précédent : du 1er au même quantième. */
function previousMonthRange(ts) {
  const d = new Date(ts);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate()));
  return [dayOf(start), dayOf(end)];
}
const msOfDay = (day) => Date.parse(`${day}T00:00:00Z`);

export function publicDelivery(r) {
  return {
    id: Number(r.id),
    driver: { id: Number(r.user_id), name: r.display_name },
    status: r.status,
    startedAt: Number(r.started_at),
    endedAt: nullable(r.ended_at),
    cargo: r.cargo,
    cargoMass: nullable(r.cargo_mass),
    from: { city: r.city_src, company: r.company_src },
    to: { city: r.city_dst, company: r.company_dst },
    market: r.job_market,
    plannedDistanceKm: nullable(r.planned_distance_km),
    distanceKm: nullable(r.distance_km),
    revenue: nullable(r.revenue),
    income: nullable(r.income),
    deliveryTimeMin: nullable(r.delivery_time_min),
    cargoDamage: nullable(r.cargo_damage),
    fines: { count: n(r.fines_count), total: n(r.fines_total) },
    tolls: n(r.tolls_total),
  };
}

/** État en direct d'un chauffeur, lisible (unités affichables), depuis son dernier snapshot. */
export function liveView(row, now = Date.now()) {
  if (!row) return { online: false, ts: null };
  let d;
  try {
    d = JSON.parse(row.data);
  } catch {
    return { online: false, ts: Number(row.ts) };
  }
  const ts = Number(row.ts);
  const kmh = (ms) => (Number.isFinite(ms) ? Math.round(ms * 3.6) : null);
  const limit = kmh(d.speedLimit);
  return {
    online: now - ts < ONLINE_MS,
    ts,
    paused: Boolean(d.paused),
    onJob: Boolean(d.onJob),
    speedKmh: kmh(d.speed) === null ? null : Math.abs(kmh(d.speed)),
    speedLimitKmh: limit && limit > 0 ? limit : null,
    cruiseKmh: kmh(d.cruiseControlSpeed) || null,
    gear: Number.isFinite(d.gear) ? d.gear : null,
    rpm: Number.isFinite(d.engineRpm) ? Math.round(d.engineRpm) : null,
    fuelL: Number.isFinite(d.fuel) ? Math.round(d.fuel) : null,
    fuelPct: d.fuelCapacity > 0 ? Math.round((d.fuel / d.fuelCapacity) * 100) : null,
    cargoDamagePct: Number.isFinite(d.cargoDamage) ? Math.round(d.cargoDamage * 1000) / 10 : null,
    // Navigation : distance en mètres, temps en secondes de temps de jeu.
    routeKm: d.routeDistance > 0 ? Math.round(d.routeDistance / 100) / 10 : null,
    routeGameMin: d.routeTime > 0 ? Math.round(d.routeTime / 60) : null,
    odometerKm: Number.isFinite(d.truckOdometer) ? Math.round(d.truckOdometer) : null,
    truck: [d.truckBrand, d.truckName].filter(Boolean).join(' ') || null,
  };
}

export async function companyStats(db, now = Date.now()) {
  const totals = await db.get(
    `SELECT COUNT(*) AS deliveries, SUM(distance_km) AS km, SUM(revenue) AS revenue,
            SUM(fines_total) AS fines, SUM(tolls_total) AS tolls
     FROM deliveries WHERE status = 'delivered'`,
  );
  const monthStart = monthStartOf(now);
  const today = dayOf(now);
  const month = await db.get(
    `SELECT COUNT(*) AS deliveries, SUM(revenue) AS revenue,
            SUM(CASE WHEN ended_at >= ? THEN 1 ELSE 0 END) AS today
     FROM deliveries WHERE status = 'delivered' AND ended_at >= ?`,
    [msOfDay(today), msOfDay(monthStart)],
  );
  const [prevStart, prevEnd] = previousMonthRange(now);
  const act = await db.get(
    `SELECT SUM(distance_km) AS total,
            SUM(CASE WHEN day = ? THEN distance_km ELSE 0 END) AS today,
            SUM(CASE WHEN day >= ? THEN distance_km ELSE 0 END) AS month,
            SUM(CASE WHEN day >= ? AND day <= ? THEN distance_km ELSE 0 END) AS prev
     FROM daily_activity`,
    [today, monthStart, prevStart, prevEnd],
  );
  // Tout compte actif est un employé qui roule, admins compris (le patron conduit aussi).
  const drivers = await db.get('SELECT COUNT(*) AS c FROM users WHERE active = 1');
  const active = await db.get(
    "SELECT COUNT(DISTINCT user_id) AS c FROM deliveries WHERE status = 'delivered' AND ended_at > ?",
    [now - 30 * DAY_MS],
  );
  const onRoad = await db.get("SELECT COUNT(DISTINCT user_id) AS c FROM deliveries WHERE status = 'in_progress'");
  const online = await db.get('SELECT COUNT(*) AS c FROM live_state l JOIN users u ON u.id = l.user_id WHERE u.active = 1 AND l.ts > ?', [
    now - ONLINE_MS,
  ]);
  const monthKm = n(act.month);
  const prevKm = n(act.prev);
  return {
    deliveries: n(totals.deliveries),
    distanceKm: n(act.total),
    distanceTodayKm: n(act.today),
    deliveredKm: n(totals.km),
    revenue: n(totals.revenue),
    fines: n(totals.fines),
    tolls: n(totals.tolls),
    drivers: n(drivers.c),
    driversOnline: n(online.c),
    activeDrivers30d: n(active.c),
    driversOnJob: n(onRoad.c),
    month: {
      start: monthStart,
      distanceKm: monthKm,
      // Évolution vs la même période du mois précédent (null sans référence).
      distanceChangePct: prevKm > 0 ? Math.round(((monthKm - prevKm) / prevKm) * 1000) / 10 : null,
      deliveries: n(month.deliveries),
      deliveriesToday: n(month.today),
      revenue: n(month.revenue),
    },
  };
}

export async function recentDeliveries(db, { limit = 20, before = null, driverId = null, status = 'delivered' } = {}) {
  const where = ['d.status = ?'];
  const params = [status];
  if (before) {
    where.push('d.id < ?');
    params.push(before);
  }
  if (driverId) {
    where.push('d.user_id = ?');
    params.push(driverId);
  }
  const rows = await db.all(
    `SELECT d.*, u.display_name FROM deliveries d JOIN users u ON u.id = d.user_id
     WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT ${Math.min(Math.max(1, limit), 100)}`,
    params,
  );
  return rows.map(publicDelivery);
}

/** Missions en cours, avec l'état en direct de chaque chauffeur. */
export async function onRoad(db, now = Date.now()) {
  const rows = await db.all(
    `SELECT d.*, u.display_name, l.ts AS live_ts, l.data AS live_data
     FROM deliveries d JOIN users u ON u.id = d.user_id LEFT JOIN live_state l ON l.user_id = d.user_id
     WHERE d.status = 'in_progress' ORDER BY d.id DESC LIMIT 50`,
  );
  return rows.map((r) => ({
    ...publicDelivery(r),
    live: liveView(r.live_ts === null ? null : { ts: r.live_ts, data: r.live_data }, now),
  }));
}

export async function driverStats(db, now = Date.now()) {
  const monthStart = monthStartOf(now);
  const rows = await db.all(
    `SELECT u.id, u.display_name, u.created_at,
            COUNT(d.id) AS deliveries, SUM(d.distance_km) AS delivered_km, SUM(d.revenue) AS revenue,
            MAX(d.ended_at) AS last_delivery,
            (SELECT SUM(a.distance_km) FROM daily_activity a WHERE a.user_id = u.id) AS driven_km,
            (SELECT SUM(a.distance_km) FROM daily_activity a WHERE a.user_id = u.id AND a.day >= ?) AS month_km,
            (SELECT l.ts FROM live_state l WHERE l.user_id = u.id) AS live_ts
     FROM users u LEFT JOIN deliveries d ON d.user_id = u.id AND d.status = 'delivered'
     WHERE u.active = 1
     GROUP BY u.id, u.display_name, u.created_at`,
    [monthStart],
  );
  return rows
    .map((r) => ({
      id: Number(r.id),
      name: r.display_name,
      since: Number(r.created_at),
      online: r.live_ts !== null && now - Number(r.live_ts) < ONLINE_MS,
      deliveries: n(r.deliveries),
      distanceKm: n(r.driven_km),
      monthKm: n(r.month_km),
      deliveredKm: n(r.delivered_km),
      revenue: n(r.revenue),
      lastDeliveryAt: nullable(r.last_delivery),
    }))
    .sort((a, b) => b.distanceKm - a.distanceKm || a.name.localeCompare(b.name, 'fr'));
}

/** Tableau de bord d'un chauffeur (vue « cabine »). null si inconnu ou inactif. */
export async function driverDashboard(db, userId, now = Date.now()) {
  const user = await db.get('SELECT id, display_name, created_at FROM users WHERE id = ? AND active = 1', [userId]);
  if (!user) return null;
  const today = dayOf(now);
  const monthStart = monthStartOf(now);
  // Semaine glissante de 7 jours (règle UE : 56 h de conduite par semaine).
  const weekStart = dayOf(now - 6 * DAY_MS);
  const act = await db.get(
    `SELECT SUM(CASE WHEN day = ? THEN distance_km ELSE 0 END) AS today_km,
            SUM(CASE WHEN day = ? THEN driving_s ELSE 0 END) AS today_s,
            SUM(CASE WHEN day >= ? THEN driving_s ELSE 0 END) AS week_s,
            SUM(CASE WHEN day >= ? THEN distance_km ELSE 0 END) AS month_km,
            SUM(CASE WHEN day >= ? THEN driving_s ELSE 0 END) AS month_s,
            SUM(distance_km) AS total_km
     FROM daily_activity WHERE user_id = ?`,
    [today, today, weekStart, monthStart, monthStart, userId],
  );
  const month = await db.get(
    `SELECT COUNT(*) AS deliveries, SUM(revenue) AS revenue, SUM(fines_count) AS fines_count,
            SUM(fines_total) AS fines_total, SUM(tolls_total) AS tolls
     FROM deliveries WHERE user_id = ? AND status = 'delivered' AND ended_at >= ?`,
    [userId, msOfDay(monthStart)],
  );
  const total = await db.get("SELECT COUNT(*) AS deliveries, SUM(revenue) AS revenue FROM deliveries WHERE user_id = ? AND status = 'delivered'", [
    userId,
  ]);
  // Classement du mois au kilométrage.
  const ranking = await db.all(
    `SELECT u.id, u.display_name, COALESCE(SUM(a.distance_km), 0) AS km
     FROM users u LEFT JOIN daily_activity a ON a.user_id = u.id AND a.day >= ?
     WHERE u.active = 1 GROUP BY u.id, u.display_name ORDER BY km DESC, u.display_name`,
    [monthStart],
  );
  const rank = ranking.findIndex((r) => Number(r.id) === Number(userId)) + 1;
  const live = await db.get('SELECT ts, data FROM live_state WHERE user_id = ?', [userId]);
  const [current] = await recentDeliveries(db, { limit: 1, driverId: userId, status: 'in_progress' });

  return {
    id: Number(user.id),
    name: user.display_name,
    since: Number(user.created_at),
    live: liveView(live, now),
    current: current ?? null,
    today: { distanceKm: n(act.today_km), drivingS: n(act.today_s) },
    week: { drivingS: n(act.week_s) },
    month: {
      start: monthStart,
      distanceKm: n(act.month_km),
      drivingS: n(act.month_s),
      deliveries: n(month.deliveries),
      revenue: n(month.revenue),
      fines: { count: n(month.fines_count), total: n(month.fines_total) },
      tolls: n(month.tolls),
      rank,
      ranked: ranking.length,
    },
    total: { distanceKm: n(act.total_km), deliveries: n(total.deliveries), revenue: n(total.revenue) },
    ranking: ranking.slice(0, 10).map((r, i) => ({ rank: i + 1, id: Number(r.id), name: r.display_name, km: n(r.km) })),
    recent: await recentDeliveries(db, { limit: 15, driverId: userId }),
  };
}
