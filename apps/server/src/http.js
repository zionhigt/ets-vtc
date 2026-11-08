import { ZodError } from 'zod';
import { verifyAccessToken } from './auth/tokens.js';
import { HttpError, getUser } from './services/users.js';

/** Valide `data` avec un schéma zod ; lève une erreur 400 lisible sinon. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw r.error;
  return r.data;
}

/**
 * Exige un jeton d'accès valide. Vérifie aussi en base que le compte est
 * toujours actif (une désactivation prend effet immédiatement).
 * @param {...('admin'|'driver')} roles rôles autorisés (tous si vide)
 */
export function requireAuth(db, config, ...roles) {
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'unauthorized', 'Jeton d\'accès manquant');
    let claims;
    try {
      claims = verifyAccessToken(token, config);
    } catch {
      throw new HttpError(401, 'invalid_token', 'Jeton d\'accès invalide ou expiré');
    }
    const user = await getUser(db, Number(claims.sub));
    if (!user || !user.active) throw new HttpError(401, 'account_disabled', 'Compte inexistant ou désactivé');
    if (roles.length && !roles.includes(user.role)) throw new HttpError(403, 'forbidden', 'Droits insuffisants');
    req.user = user;
    next();
  };
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'invalid_payload',
      message: 'Requête invalide',
      issues: err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  console.error(err);
  return res.status(500).json({ error: 'internal_error' });
}
