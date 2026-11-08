import { generatePersonalToken, generateRefreshToken, hashToken } from '../auth/tokens.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    active: Boolean(u.active),
    createdAt: u.created_at,
  };
}

export async function audit(db, actorId, action, target, details) {
  await db.run('INSERT INTO audit_log (actor_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)', [
    actorId ?? null,
    action,
    target ?? null,
    details ? JSON.stringify(details) : null,
    Date.now(),
  ]);
}

export async function getUser(db, id) {
  return db.get('SELECT * FROM users WHERE id = ?', [id]);
}

export async function listUsers(db) {
  return db.all('SELECT * FROM users ORDER BY id');
}

/** Crée un compte nominatif et son token personnel. Le token en clair n'est renvoyé qu'ici. */
export async function createUser(db, { username, displayName, role = 'driver' }, actorId = null) {
  const exists = await db.get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) throw new HttpError(409, 'username_taken', 'Ce nom d\'utilisateur existe déjà');
  const now = Date.now();
  const { lastId } = await db.run(
    'INSERT INTO users (username, display_name, role, active, created_at) VALUES (?, ?, ?, 1, ?)',
    [username, displayName, role, now],
  );
  const token = await issuePersonalToken(db, lastId);
  await audit(db, actorId, 'user.create', `user:${lastId}`, { username, role });
  return { user: await getUser(db, lastId), token };
}

/** Révoque les tokens existants (personnels et de rafraîchissement) et en émet un nouveau. */
export async function regeneratePersonalToken(db, userId, actorId = null) {
  const user = await getUser(db, userId);
  if (!user) throw new HttpError(404, 'user_not_found');
  await revokeAllTokens(db, userId);
  const token = await issuePersonalToken(db, userId);
  await audit(db, actorId, 'user.token.regenerate', `user:${userId}`);
  return token;
}

export async function updateUser(db, userId, patch, actorId = null) {
  const user = await getUser(db, userId);
  if (!user) throw new HttpError(404, 'user_not_found');
  if (actorId === userId && (patch.active === false || (patch.role && patch.role !== user.role))) {
    throw new HttpError(400, 'cannot_demote_self', 'Un admin ne peut ni se désactiver ni changer son propre rôle');
  }
  const set = {};
  if (patch.displayName !== undefined) set.display_name = patch.displayName;
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.active !== undefined) set.active = patch.active ? 1 : 0;
  const columns = Object.keys(set);
  if (columns.length) {
    await db.run(`UPDATE users SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
      ...Object.values(set),
      userId,
    ]);
  }
  if (patch.active === false) await revokeRefreshTokens(db, userId);
  await audit(db, actorId, 'user.update', `user:${userId}`, patch);
  return getUser(db, userId);
}

/** Suppression RGPD : le compte, ses tokens et ses événements. */
export async function deleteUser(db, userId, actorId = null) {
  if (actorId === userId) throw new HttpError(400, 'cannot_delete_self');
  const user = await getUser(db, userId);
  if (!user) throw new HttpError(404, 'user_not_found');
  // Suppressions explicites : ne dépend pas de l'activation des clés étrangères.
  await db.run('DELETE FROM raw_events WHERE user_id = ?', [userId]);
  await db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
  await db.run('DELETE FROM personal_tokens WHERE user_id = ?', [userId]);
  await db.run('DELETE FROM users WHERE id = ?', [userId]);
  await audit(db, actorId, 'user.delete', `user:${userId}`, { username: user.username });
}

async function issuePersonalToken(db, userId) {
  const token = generatePersonalToken();
  await db.run('INSERT INTO personal_tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)', [
    userId,
    hashToken(token),
    Date.now(),
  ]);
  return token;
}

async function revokeRefreshTokens(db, userId) {
  await db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), userId]);
}

async function revokeAllTokens(db, userId) {
  await db.run('UPDATE personal_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), userId]);
  await revokeRefreshTokens(db, userId);
}

/** Échange un token personnel valide contre un utilisateur actif. */
export async function userFromPersonalToken(db, token) {
  const row = await db.get(
    `SELECT u.*, pt.id AS token_id FROM personal_tokens pt JOIN users u ON u.id = pt.user_id
     WHERE pt.token_hash = ? AND pt.revoked_at IS NULL AND u.active = 1`,
    [hashToken(token)],
  );
  if (!row) return null;
  await db.run('UPDATE personal_tokens SET last_used_at = ? WHERE id = ?', [Date.now(), row.token_id]);
  return row;
}

export async function createRefreshToken(db, userId, ttlDays) {
  const token = generateRefreshToken();
  const now = Date.now();
  await db.run('INSERT INTO refresh_tokens (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)', [
    userId,
    hashToken(token),
    now,
    now + ttlDays * DAY_MS,
  ]);
  return token;
}

/** Consomme un jeton de rafraîchissement (rotation : il ne sert qu'une fois). */
export async function consumeRefreshToken(db, token) {
  const row = await db.get(
    `SELECT u.*, rt.id AS rt_id FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = ? AND rt.revoked_at IS NULL AND rt.expires_at > ? AND u.active = 1`,
    [hashToken(token), Date.now()],
  );
  if (!row) return null;
  const { changes } = await db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [
    Date.now(),
    row.rt_id,
  ]);
  return changes === 1 ? row : null;
}
