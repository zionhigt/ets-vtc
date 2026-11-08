import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Charge la configuration depuis l'environnement (et apps/server/.env).
 * `overrides` sert aux tests.
 */
export function loadConfig(overrides = {}) {
  if (!overrides.skipDotenv) dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });
  const env = { ...process.env, ...overrides.env };

  const config = {
    env: env.NODE_ENV ?? 'development',
    port: Number(env.PORT ?? 3000),
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || env.TRUST_PROXY : false,
    db: {
      client: env.DB_CLIENT ?? 'sqlite',
      sqliteFile: path.resolve(serverRoot, env.SQLITE_FILE ?? './data/vtc.sqlite'),
      mysql: {
        host: env.MYSQL_HOST ?? 'localhost',
        port: Number(env.MYSQL_PORT ?? 3306),
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD,
        database: env.MYSQL_DATABASE,
      },
    },
    jwtSecret: env.JWT_SECRET,
    accessTokenTtl: Number(env.ACCESS_TOKEN_TTL ?? 900),
    refreshTokenTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    minTrackerVersion: env.MIN_TRACKER_VERSION ?? '0.0.0',
    // restricted (défaut) : site visible seulement avec un lien d'accès ; public : ouvert à tous.
    siteAccess: env.SITE_ACCESS === 'public' ? 'public' : 'restricted',
    // Adresse publique du site, pour imprimer les liens d'accès (ex. https://vtc.mondomaine.fr).
    publicUrl: env.PUBLIC_URL ?? '',
    rateLimit: env.RATE_LIMIT !== 'off',
    ...overrides.config,
  };

  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    if (config.env === 'production') throw new Error('JWT_SECRET doit faire au moins 32 caractères en production');
    config.jwtSecret = config.jwtSecret ?? 'dev-only-secret-dev-only-secret-dev-only';
  }
  return config;
}
