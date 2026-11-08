import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { authRoutes } from './routes/auth.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { adminRoutes } from './routes/admin.js';
import { errorHandler } from './http.js';

export const API_VERSION = '0.1.0';

/** Construit l'application Express (sans écouter de port : testable). */
export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(express.json({ limit: '2mb' }));

  const limiter = (limit) =>
    config.rateLimit
      ? rateLimit({ windowMs: 60_000, limit, standardHeaders: 'draft-7', legacyHeaders: false })
      : (_req, _res, next) => next();

  const api = express.Router();

  api.get('/health', async (_req, res) => {
    await db.get('SELECT 1 AS ok');
    res.json({ status: 'ok' });
  });

  api.get('/version', (_req, res) => {
    res.json({ api: API_VERSION, minTrackerVersion: config.minTrackerVersion });
  });

  api.use('/auth', limiter(20), authRoutes(db, config));
  api.use('/admin', limiter(120), adminRoutes(db, config));
  api.use(limiter(300), telemetryRoutes(db, config));

  app.use('/api/v1', api);
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use(errorHandler);
  return app;
}
