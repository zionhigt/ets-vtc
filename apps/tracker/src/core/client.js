// Client de l'API ets-vtc : connexion par token personnel, rafraîchissement
// automatique, envoi des lots d'événements.
import { safeStringify } from '@ets-vtc/shared';

export class AuthError extends Error {}
export class OfflineError extends Error {}

export class ApiClient {
  /** @param {{serverUrl:string, personalToken:string, fetch?:typeof fetch, timeoutMs?:number}} opts */
  constructor({ serverUrl, personalToken, fetch: fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
    this.base = `${serverUrl.replace(/\/$/, '')}/api/v1`;
    this.personalToken = personalToken;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.session = null;
  }

  /**
   * Une requête complète (envoi + lecture de la réponse) ne dépasse jamais
   * timeoutMs. Le délai est géré ici par un minuteur explicite, et la course
   * contre ce minuteur garantit que la promesse se termine même si fetch ignore
   * l'annulation (constaté sous Electron après une coupure brutale du serveur).
   */
  async #request(method, route, body, token) {
    // Sérialisation hors du bloc réseau : une erreur de données ne doit jamais
    // passer pour « Serveur injoignable ». Les BigInt deviennent du texte.
    const payload = body === undefined ? undefined : safeStringify(body);
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new OfflineError(`Serveur injoignable (pas de réponse en ${this.timeoutMs / 1000} s)`));
      }, this.timeoutMs);
    });
    const exchange = (async () => {
      let res;
      try {
        res = await this.fetch(`${this.base}${route}`, {
          method,
          headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
          body: payload,
          signal: controller.signal,
        });
      } catch (err) {
        throw new OfflineError(`Serveur injoignable (${describeNetworkError(err)})`, { cause: err });
      }
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    })();
    try {
      return await Promise.race([exchange, timeout]);
    } finally {
      clearTimeout(timer);
      exchange.catch(() => {}); // une requête abandonnée ne doit pas lever d'erreur non gérée
    }
  }

  /** Échange le token personnel contre une session. */
  async login() {
    const r = await this.#request('POST', '/auth/token', { token: this.personalToken });
    if (r.status === 401) throw new AuthError('Token personnel invalide ou révoqué');
    if (r.status !== 200) throw new OfflineError(`Connexion refusée (${r.status})`);
    this.session = r.json;
    return r.json.user;
  }

  async #refresh() {
    if (this.session?.refreshToken) {
      const r = await this.#request('POST', '/auth/refresh', { refreshToken: this.session.refreshToken });
      if (r.status === 200) {
        this.session = r.json;
        return;
      }
    }
    await this.login();
  }

  async #authed(method, route, body) {
    if (!this.session) await this.login();
    let r = await this.#request(method, route, body, this.session.accessToken);
    if (r.status === 401) {
      await this.#refresh();
      r = await this.#request(method, route, body, this.session.accessToken);
    }
    if (r.status === 401) throw new AuthError('Session refusée');
    return r;
  }

  async version() {
    const r = await this.#request('GET', '/version');
    if (r.status !== 200) throw new OfflineError(`Version indisponible (${r.status})`);
    return r.json;
  }

  async sendEvents(events) {
    const r = await this.#authed('POST', '/telemetry/events', { events });
    if (r.status !== 200) {
      const err = new Error(`Lot refusé (${r.status}) : ${r.json?.message ?? r.json?.error ?? ''}`);
      err.status = r.status;
      err.rejected = r.status === 400 || r.status === 413; // rejet définitif du contenu
      throw err;
    }
    return r.json;
  }

  async myDeliveries() {
    const r = await this.#authed('GET', '/me/deliveries');
    return r.json;
  }
}

/**
 * Résumé lisible d'une erreur réseau : `fetch failed` cache la vraie cause
 * (code système, erreur agrégée IPv4/IPv6 de « localhost », socket fermé…).
 */
export function describeNetworkError(err) {
  const cause = err?.cause;
  return (
    cause?.code ??
    cause?.errors?.find((e) => e?.code)?.code ??
    cause?.cause?.code ??
    (cause?.message ? `${cause.name ?? 'Error'}: ${cause.message}` : null) ??
    (err?.message ? `${err.name}: ${err.message}` : String(err))
  );
}

/** Compare deux versions semver simples : -1, 0, 1. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
