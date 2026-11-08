// Cœur du tracker : écoute la télémétrie, met les événements en file, les envoie
// au serveur par lots. Indépendant d'Electron (testable avec une fausse télémétrie).
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { slimSnapshot, normalizeEventType, MAX_BATCH_SIZE } from '@ets-vtc/shared';
import { AuthError, OfflineError } from './client.js';

/** Événements trop bavards ou inutiles au serveur. */
const IGNORED = new Set(['time']);

export const STATES = {
  stopped: 'Arrêté',
  waitingGame: 'En attente du jeu',
  inGame: 'Jeu détecté',
  onJob: 'Livraison en cours',
};

export class Tracker extends EventEmitter {
  /**
   * @param {object} opts
   * @param {() => import('node:events').EventEmitter & {data?:any}} opts.createTelemetry fabrique de télémétrie (trucksim-telemetry)
   * @param {import('./client.js').ApiClient} opts.client
   * @param {import('./queue.js').PersistentQueue} opts.queue
   * @param {number} [opts.snapshotIntervalMs]
   * @param {number} [opts.sendIntervalMs]
   */
  constructor({ createTelemetry, client, queue, snapshotIntervalMs = 5000, sendIntervalMs = 5000, now = Date.now }) {
    super();
    Object.assign(this, { createTelemetry, client, queue, snapshotIntervalMs, sendIntervalMs, now });
    this.running = false;
    this.connected = false;
    this.job = null;
    this.server = { ok: null, message: '', lastSentAt: null };
    this.seq = 0;
    this.sending = false;
  }

  get status() {
    let state = 'stopped';
    if (this.running) state = this.job ? 'onJob' : this.connected ? 'inGame' : 'waitingGame';
    return {
      state,
      label: STATES[state],
      running: this.running,
      job: this.job,
      queued: this.queue.size,
      server: { ...this.server },
    };
  }

  #changed() {
    this.emit('status', this.status);
  }

  #enqueue(type, data) {
    this.queue.push({ id: randomUUID(), seq: this.seq++, ts: this.now(), type, data: data ?? null });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.telemetry = this.createTelemetry();
    const t = this.telemetry;

    // Capture de tous les événements émis par la librairie.
    const originalEmit = t.emit.bind(t);
    t.emit = (event, ...args) => {
      this.#onTelemetryEvent(String(event), args.length <= 1 ? args[0] : args);
      return originalEmit(event, ...args);
    };

    this.snapshotTimer = setInterval(() => this.#snapshot(), this.snapshotIntervalMs);
    this.sendTimer = setInterval(() => this.flush(), this.sendIntervalMs);
    this.#changed();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.snapshotTimer);
    clearInterval(this.sendTimer);
    try {
      this.telemetry?.stop?.();
    } catch {
      /* la librairie peut déjà être arrêtée */
    }
    this.telemetry = null;
    this.connected = false;
    this.#changed();
    return this.flush();
  }

  #onTelemetryEvent(rawType, data) {
    const type = normalizeEventType(rawType);
    if (type === 'connected') this.connected = true;
    if (type === 'disconnected') this.connected = false;
    if (type === 'job-started') this.job = describeJob(data);
    if (['job-delivered', 'job-cancelled', 'job-finished'].includes(type)) this.job = null;
    if (!IGNORED.has(type)) this.#enqueue(type, data);
    if (['connected', 'disconnected', 'job-started', 'job-delivered', 'job-cancelled'].includes(type)) this.#changed();
  }

  #snapshot() {
    if (!this.connected || !this.telemetry) return;
    const state = this.telemetry.data;
    const slim = state && slimSnapshot(state);
    if (!slim || slim.paused) return;
    // Reprise d'une mission en cours au lancement du tracker.
    const current = state.current ?? state;
    if (!this.job && current?.onJob && current.cargo) {
      this.job = describeJob(current);
      this.#changed();
    }
    this.#enqueue('snapshot', slim);
  }

  /** Envoie la file au serveur, par lots, jusqu'à la vider ou échouer. */
  async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.size) {
        const batch = this.queue.peek(MAX_BATCH_SIZE);
        try {
          await this.client.sendEvents(batch);
        } catch (err) {
          if (err.rejected) {
            // Contenu refusé : on écarte le lot pour ne pas bloquer la file indéfiniment.
            this.queue.ack(batch.length);
            this.server = { ...this.server, ok: true, message: err.message };
            continue;
          }
          throw err;
        }
        this.queue.ack(batch.length);
        this.server = { ok: true, message: 'Connecté au serveur', lastSentAt: this.now() };
      }
      if (this.server.ok !== true) this.server = { ...this.server, ok: true, message: 'Connecté au serveur' };
    } catch (err) {
      const message =
        err instanceof AuthError ? `${err.message} : vérifie ton token` : err instanceof OfflineError ? `${err.message} : nouvel essai dans quelques secondes` : err.message;
      this.server = { ...this.server, ok: false, message, auth: err instanceof AuthError };
      if (err instanceof AuthError) this.emit('auth-error', err);
    } finally {
      this.sending = false;
      this.#changed();
    }
  }
}

function describeJob(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    cargo: d.cargo ?? null,
    from: d.citySrc ?? null,
    to: d.cityDst ?? null,
    plannedDistanceKm: typeof d.plannedDistanceKm === 'number' ? d.plannedDistanceKm : null,
  };
}
