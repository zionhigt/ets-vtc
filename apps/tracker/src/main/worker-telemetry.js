// Adaptateur : expose le processus de télémétrie comme un EventEmitter avec
// `.data` et `.stop()`, attendu par le Tracker. Relance le processus tant que le
// jeu est indisponible.
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { utilityProcess } from 'electron';
import { slimSnapshot } from '@ets-vtc/shared';

const WORKER = fileURLToPath(new URL('./telemetry-worker.cjs', import.meta.url));
const RETRY_MS = 5000;
const STATE_MS = 1000;

export class WorkerTelemetry extends EventEmitter {
  constructor({ log = () => {} } = {}) {
    super();
    this.log = log;
    this.data = null;
    this.stopped = false;
    this.connected = false;
    this.#spawn();
  }

  #spawn() {
    if (this.stopped) return;
    const child = utilityProcess.fork(WORKER, [], { serviceName: 'ets-vtc-telemetry', stdio: 'ignore' });
    this.child = child;
    child.on('message', (msg) => this.#onMessage(msg));
    child.on('exit', (code) => {
      clearInterval(this.stateTimer);
      if (this.child === child) this.child = null;
      if (this.connected) {
        this.connected = false;
        this.emit('disconnected');
      }
      if (!this.stopped) {
        this.log(`télémétrie indisponible (code ${code}), nouvel essai dans ${RETRY_MS / 1000} s`);
        this.retryTimer = setTimeout(() => this.#spawn(), RETRY_MS);
      }
    });
    this.stateTimer = setInterval(() => child.postMessage({ kind: 'state' }), STATE_MS);
  }

  #onMessage(msg) {
    if (msg.kind === 'event') {
      if (msg.event === 'connected') this.connected = true;
      if (msg.event === 'disconnected') this.connected = false;
      this.emit(msg.event, msg.data);
    } else if (msg.kind === 'state') {
      const slim = slimSnapshot(msg.state.current);
      this.data = { ...slim, ...msg.state.job };
      // Le jeu tournait déjà avant le tracker : l'événement « connected » a pu être manqué.
      if (msg.state.current.sdkActive && !this.connected) {
        this.connected = true;
        this.emit('connected');
      }
    } else if (msg.kind === 'unavailable') {
      this.log(`télémétrie : ${msg.message}`);
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.stateTimer);
    this.child?.kill();
    this.child = null;
  }
}
