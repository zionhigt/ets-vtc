import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { authRoutes } from './routes/auth.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';
import { errorHandler } from './http.js';

export const API_VERSION = '0.2.0';

/** Site public et admin : fichiers statiques sans étape de build. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public');

/** Construit l'application Express (sans écouter de port : testable). */
export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Le logo de l'entreprise est une URL https choisie par l'admin.
          'img-src': ["'self'", 'data:', 'https:'],
        },
      },
    }),
  );
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
  api.use('/public', limiter(300), publicRoutes(db));
  api.use(limiter(300), telemetryRoutes(db, config));
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  app.use('/api/v1', api);
  // /admin → admin.html, /livraisons → livraisons.html, etc.
  app.use(express.static(WEB_DIR, { extensions: ['html'], maxAge: '5m' }));
  app.use((_req, res) => res.status(404).sendFile(path.join(WEB_DIR, '404.html')));
  app.use(errorHandler);
  return app;
}
