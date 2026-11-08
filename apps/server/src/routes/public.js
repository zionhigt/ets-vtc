import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../http.js';
import { getCompany } from '../services/company.js';
import { companyStats, recentDeliveries, driverStats } from '../services/stats.js';

const deliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
  driver: z.coerce.number().int().positive().optional(),
});

/** Données publiques du site : aucune authentification. */
export function publicRoutes(db) {
  const r = Router();

  r.get('/company', async (_req, res) => res.json(await getCompany(db)));

  r.get('/stats', async (_req, res) => res.json(await companyStats(db)));

  r.get('/deliveries', async (req, res) => {
    const q = parse(deliveriesQuery, req.query);
    res.json(await recentDeliveries(db, { limit: q.limit, before: q.before, driverId: q.driver }));
  });

  r.get('/drivers', async (_req, res) => res.json(await driverStats(db)));

  // Missions en cours (pour la section « En route » de l'accueil).
  r.get('/on-road', async (_req, res) => res.json(await recentDeliveries(db, { limit: 50, status: 'in_progress' })));

  return r;
}
