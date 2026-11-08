import { Router } from 'express';
import { z } from 'zod';
import { parse, requireAuth } from '../http.js';
import {
  HttpError,
  publicUser,
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  regeneratePersonalToken,
} from '../services/users.js';
import { eventStats } from '../services/events.js';
import { getCompany, updateCompany } from '../services/company.js';
import { rebuildAll } from '../services/deliveries.js';
import { audit } from '../services/users.js';

const companyBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    slogan: z.string().trim().max(160),
    description: z.string().trim().max(4000),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'couleur au format #rrggbb'),
    logoUrl: z.union([z.literal(''), z.string().url().max(500).startsWith('https://', 'logo en https')]),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'aucun champ à modifier');

const role = z.enum(['admin', 'driver']);
const createBody = z.object({
  username: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9._-]+$/, 'minuscules, chiffres, . _ - uniquement'),
  displayName: z.string().min(1).max(128),
  role: role.default('driver'),
});
const patchBody = z
  .object({ displayName: z.string().min(1).max(128), role, active: z.boolean() })
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'aucun champ à modifier');
const idParam = z.coerce.number().int().positive();

export function adminRoutes(db, config) {
  const r = Router();
  r.use(requireAuth(db, config, 'admin'));

  async function loadUser(req) {
    const user = await getUser(db, parse(idParam, req.params.id));
    if (!user) throw new HttpError(404, 'user_not_found', 'Utilisateur introuvable');
    return user;
  }

  r.get('/users', async (_req, res) => {
    res.json((await listUsers(db)).map(publicUser));
  });

  // Crée un compte nominatif. Le token personnel n'est affiché qu'une fois.
  r.post('/users', async (req, res) => {
    const body = parse(createBody, req.body);
    const { user, token } = await createUser(db, body, req.user.id);
    res.status(201).json({ user: publicUser(user), personalToken: token });
  });

  r.get('/users/:id', async (req, res) => {
    const user = await loadUser(req);
    res.json({ ...publicUser(user), events: await eventStats(db, user.id) });
  });

  r.patch('/users/:id', async (req, res) => {
    const user = await loadUser(req);
    const updated = await updateUser(db, user.id, parse(patchBody, req.body), req.user.id);
    res.json(publicUser(updated));
  });

  r.delete('/users/:id', async (req, res) => {
    const user = await loadUser(req);
    await deleteUser(db, user.id, req.user.id);
    res.status(204).end();
  });

  r.get('/company', async (_req, res) => res.json(await getCompany(db)));

  r.put('/company', async (req, res) => {
    res.json(await updateCompany(db, parse(companyBody, req.body), req.user.id));
  });

  // Recalcule toutes les livraisons depuis le journal brut (après une évolution des règles).
  r.post('/jobs/rebuild', async (req, res) => {
    const processed = await rebuildAll(db);
    await audit(db, req.user.id, 'jobs.rebuild', 'deliveries', { processed });
    res.json({ processed });
  });

  // Révoque les tokens du compte et en émet un nouveau.
  r.post('/users/:id/token', async (req, res) => {
    const user = await loadUser(req);
    res.json({ personalToken: await regeneratePersonalToken(db, user.id, req.user.id) });
  });

  return r;
}
