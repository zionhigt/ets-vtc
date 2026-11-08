import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

/** Token personnel transmis par l'admin au chauffeur. Seul son hash est stocké. */
export function generatePersonalToken() {
  return `vtc_${randomBytes(32).toString('base64url')}`;
}

export function generateRefreshToken() {
  return `vtr_${randomBytes(32).toString('base64url')}`;
}

/** Hash SHA-256 : suffisant pour des secrets aléatoires de 256 bits (pas de dictionnaire possible). */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(user, config) {
  return jwt.sign({ role: user.role, name: user.display_name }, config.jwtSecret, {
    subject: String(user.id),
    expiresIn: config.accessTokenTtl,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token, config) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}
