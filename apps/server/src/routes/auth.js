import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../http.js';
import { signAccessToken } from '../auth/tokens.js';
import {
  HttpError,
  publicUser,
  userFromPersonalToken,
  createRefreshToken,
  consumeRefreshToken,
} from '../services/users.js';

const tokenBody = z.object({ token: z.string().min(10).max(200) });
const refreshBody = z.object({ refreshToken: z.string().min(10).max(200) });

export function authRoutes(db, config) {
  const r = Router();

  async function session(user) {
    return {
      accessToken: signAccessToken(user, config),
      expiresIn: config.accessTokenTtl,
      refreshToken: await createRefreshToken(db, user.id, config.refreshTokenTtlDays),
      user: publicUser(user),
    };
  }

  // Échange le token personnel (fourni par l'admin) contre une session.
  r.post('/token', async (req, res) => {
    const { token } = parse(tokenBody, req.body);
    const user = await userFromPersonalToken(db, token);
    if (!user) throw new HttpError(401, 'invalid_personal_token', 'Token personnel invalide ou révoqué');
    res.json(await session(user));
  });

  // Rotation : le jeton de rafraîchissement utilisé est révoqué et remplacé.
  r.post('/refresh', async (req, res) => {
    const { refreshToken } = parse(refreshBody, req.body);
    const user = await consumeRefreshToken(db, refreshToken);
    if (!user) throw new HttpError(401, 'invalid_refresh_token', 'Session expirée, reconnectez-vous');
    res.json(await session(user));
  });

  return r;
}
