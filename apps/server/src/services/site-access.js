// Accès restreint au site : seules les personnes ayant reçu un lien d'accès
// (généré en ligne de commande) voient les pages et l'API publique. Le lien pose
// un cookie signé qui référence le lien ; révoquer le lien coupe l'accès.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hashToken } from '../auth/tokens.js';

export const COOKIE = 'vtc_site';
const COOKIE_MAX_AGE_S = 400 * 24 * 3600; // plafond des navigateurs
const CACHE_MS = 30_000;

export async function createLink(db, label) {
  const token = `vsl_${randomBytes(24).toString('base64url')}`;
  const { lastId } = await db.run('INSERT INTO site_links (label, token_hash, created_at, uses) VALUES (?, ?, ?, 0)', [
    label,
    hashToken(token),
    Date.now(),
  ]);
  return { id: lastId, token };
}

export async function listLinks(db) {
  return db.all('SELECT id, label, created_at, last_used_at, uses, revoked_at FROM site_links ORDER BY id');
}

export async function revokeLink(db, id) {
  const { changes } = await db.run('UPDATE site_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [Date.now(), id]);
  return changes === 1;
}

export function linkUrl(publicUrl, token) {
  return `${(publicUrl || 'https://<adresse-du-site>').replace(/\/$/, '')}/acces/${token}`;
}

const sign = (secret, id) => createHmac('sha256', secret).update(`site-link:${id}`).digest('base64url');

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Middleware et route d'accès. `isPublic(req)` : chemins jamais restreints.
 */
export function siteAccess(db, config) {
  const cache = new Map(); // id → { ok, at }
  const cacheMs = config.siteAccessCacheMs ?? CACHE_MS;

  async function linkActive(id) {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < cacheMs) return hit.ok;
    const row = await db.get('SELECT revoked_at FROM site_links WHERE id = ?', [id]);
    const ok = Boolean(row) && row.revoked_at === null;
    cache.set(id, { ok, at: Date.now() });
    return ok;
  }

  async function hasAccess(req) {
    const value = readCookie(req, COOKIE);
    if (!value) return false;
    const [idText, mac] = value.split('.');
    const id = Number(idText);
    if (!Number.isInteger(id) || !mac) return false;
    const expected = Buffer.from(sign(config.jwtSecret, id));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    return linkActive(id);
  }

  /** GET /acces/:token : vérifie le lien, pose le cookie, redirige vers l'accueil. */
  async function enter(req, res, denied) {
    const row = await db.get('SELECT id FROM site_links WHERE token_hash = ? AND revoked_at IS NULL', [hashToken(req.params.token)]);
    if (!row) return denied(res, 403);
    const id = Number(row.id);
    await db.run('UPDATE site_links SET uses = uses + 1, last_used_at = ? WHERE id = ?', [Date.now(), id]);
    cache.delete(id);
    res.cookie(COOKIE, `${id}.${sign(config.jwtSecret, id)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.env === 'production' || req.secure,
      maxAge: COOKIE_MAX_AGE_S * 1000,
      path: '/',
    });
    res.redirect(303, '/');
  }

  return { hasAccess, enter, invalidate: (id) => cache.delete(id) };
}
