// Lectures publiques : uniquement des données affichables (pas d'identifiant de
// connexion, pas de token, pas de données techniques).
const DAY_MS = 24 * 60 * 60 * 1000;

const n = (v) => (v === null || v === undefined ? 0 : Number(v));

export function publicDelivery(r) {
  return {
    id: Number(r.id),
    driver: { id: Number(r.user_id), name: r.display_name },
    status: r.status,
    startedAt: Number(r.started_at),
    endedAt: r.ended_at === null ? null : Number(r.ended_at),
    cargo: r.cargo,
    cargoMass: r.cargo_mass === null ? null : Number(r.cargo_mass),
    from: { city: r.city_src, company: r.company_src },
    to: { city: r.city_dst, company: r.company_dst },
    market: r.job_market,
    plannedDistanceKm: r.planned_distance_km === null ? null : Number(r.planned_distance_km),
    distanceKm: r.distance_km === null ? null : Number(r.distance_km),
    revenue: r.revenue === null ? null : Number(r.revenue),
    income: r.income === null ? null : Number(r.income),
    deliveryTimeMin: r.delivery_time_min === null ? null : Number(r.delivery_time_min),
    cargoDamage: r.cargo_damage === null ? null : Number(r.cargo_damage),
    fines: { count: n(r.fines_count), total: n(r.fines_total) },
    tolls: n(r.tolls_total),
  };
}

export async function companyStats(db) {
  const totals = await db.get(
    `SELECT COUNT(*) AS deliveries, SUM(distance_km) AS km, SUM(revenue) AS revenue,
            SUM(fines_total) AS fines, SUM(tolls_total) AS tolls
     FROM deliveries WHERE status = 'delivered'`,
  );
  const drivers = await db.get("SELECT COUNT(*) AS c FROM users WHERE active = 1 AND role = 'driver'");
  const active = await db.get(
    "SELECT COUNT(DISTINCT user_id) AS c FROM deliveries WHERE status = 'delivered' AND ended_at > ?",
    [Date.now() - 30 * DAY_MS],
  );
  const onRoad = await db.get("SELECT COUNT(DISTINCT user_id) AS c FROM deliveries WHERE status = 'in_progress'");
  return {
    deliveries: n(totals.deliveries),
    distanceKm: n(totals.km),
    revenue: n(totals.revenue),
    fines: n(totals.fines),
    tolls: n(totals.tolls),
    drivers: n(drivers.c),
    activeDrivers30d: n(active.c),
    driversOnJob: n(onRoad.c),
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

export async function driverStats(db) {
  const rows = await db.all(
    `SELECT u.id, u.display_name, u.created_at,
            COUNT(d.id) AS deliveries, SUM(d.distance_km) AS km, SUM(d.revenue) AS revenue,
            MAX(d.ended_at) AS last_delivery
     FROM users u LEFT JOIN deliveries d ON d.user_id = u.id AND d.status = 'delivered'
     WHERE u.active = 1 AND u.role = 'driver'
     GROUP BY u.id, u.display_name, u.created_at
     ORDER BY km DESC, u.display_name`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.display_name,
    since: Number(r.created_at),
    deliveries: n(r.deliveries),
    distanceKm: n(r.km),
    revenue: n(r.revenue),
    lastDeliveryAt: r.last_delivery === null ? null : Number(r.last_delivery),
  }));
}
