import { Router } from 'express';
import { z } from 'zod';
import { MAX_BATCH_SIZE, MAX_EVENT_DATA_BYTES, EVENT_ID_PATTERN, safeStringify } from '../shared.js';
import { parse, requireAuth } from '../http.js';
import { ingestEvents, eventStats } from '../services/events.js';
import { publicUser } from '../services/users.js';

const event = z.object({
  id: z.string().regex(EVENT_ID_PATTERN, 'id : 8 à 64 caractères [A-Za-z0-9_-]'),
  seq: z.number().int().nonnegative().optional(),
  ts: z.number().int().positive(),
  type: z.string().min(1).max(64),
  data: z
    .unknown()
    .optional()
    .refine((d) => d === undefined || safeStringify(d).length <= MAX_EVENT_DATA_BYTES, {
      message: `data dépasse ${MAX_EVENT_DATA_BYTES} octets : envoyer un snapshot réduit`,
    }),
});

const batch = z.object({ events: z.array(event).min(1).max(MAX_BATCH_SIZE) });

export function telemetryRoutes(db, config) {
  const r = Router();
  const driver = requireAuth(db, config);

  r.post('/telemetry/events', driver, async (req, res) => {
    const { events } = parse(batch, req.body);
    res.json(await ingestEvents(db, req.user.id, events));
  });

  r.get('/me', driver, (req, res) => res.json(publicUser(req.user)));

  r.get('/me/events/stats', driver, async (req, res) => res.json(await eventStats(db, req.user.id)));

  return r;
}
