import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../http.js';
import { HttpError } from '../services/users.js';
import { getCompany } from '../services/company.js';
import { companyStats, recentDeliveries, driverStats, onRoad, driverDashboard } from '../services/stats.js';

const deliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
  driver: z.coerce.number().int().positive().optional(),
});
const idParam = z.coerce.number().int().positive();

/** Données publiques du site : aucune authentification (hors accès restreint au site). */
export function publicRoutes(db) {
  const r = Router();

  r.get('/company', async (_req, res) => res.json(await getCompany(db)));

  r.get('/stats', async (_req, res) => res.json(await companyStats(db)));

  r.get('/deliveries', async (req, res) => {
    const q = parse(deliveriesQuery, req.query);
    res.json(await recentDeliveries(db, { limit: q.limit, before: q.before, driverId: q.driver }));
  });

  r.get('/drivers', async (_req, res) => res.json(await driverStats(db)));

  // Tableau de bord d'un chauffeur (vue « cabine »).
  r.get('/drivers/:id', async (req, res) => {
    const dashboard = await driverDashboard(db, parse(idParam, req.params.id));
    if (!dashboard) throw new HttpError(404, 'driver_not_found', 'Chauffeur introuvable');
    res.json(dashboard);
  });

  // Missions en cours, avec l'état en direct de chaque chauffeur.
  r.get('/on-road', async (_req, res) => res.json(await onRoad(db)));

  return r;
}
