// Fil des changements pour le long polling du site : la version avance à chaque
// lot d'événements reçu (et à chaque modification admin visible sur le site).
// Une page attend la version suivante, et se redessine donc une fois par lot,
// au rythme du tracker.
//
// En mémoire du processus : si l'hébergeur lance plusieurs processus, une page
// rattachée à un autre processus ne sera pas réveillée et se rafraîchira à
// l'expiration de l'attente (pas d'erreur, juste moins réactif).
import { EventEmitter } from 'node:events';

export class ChangeFeed {
  constructor() {
    // Départ sur l'horloge : après un redémarrage, toute version connue d'un
    // client est différente, ce qui provoque une mise à jour immédiate.
    this.version = Date.now();
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
  }

  notify() {
    this.version = Math.max(this.version + 1, Date.now());
    this.emitter.emit('change', this.version);
  }

  /**
   * Résout avec la version courante dès qu'elle diffère de `since`, ou à
   * l'expiration (`timeoutMs`), ou à l'annulation (`signal`).
   */
  wait(since, { timeoutMs = 25_000, signal } = {}) {
    if (since !== this.version) return Promise.resolve(this.version);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.emitter.off('change', done);
        signal?.removeEventListener('abort', done);
        resolve(this.version);
      };
      const timer = setTimeout(done, timeoutMs);
      this.emitter.on('change', done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
