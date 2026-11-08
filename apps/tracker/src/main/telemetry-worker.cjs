// Processus isolé qui lit la télémétrie du jeu (lancé par utilityProcess).
// La librairie trucksim-telemetry n'a pas de méthode d'arrêt et lève une exception
// quand le jeu n'est pas lancé : l'isoler permet de l'arrêter (kill) et de la
// relancer sans risque pour l'interface.
const { truckSimTelemetry } = require('trucksim-telemetry');

const send = (msg) => process.parentPort.postMessage(msg);
const JOB_FIELDS = ['onJob', 'cargo', 'citySrc', 'cityDst', 'plannedDistanceKm'];

let telemetry;
try {
  telemetry = truckSimTelemetry();
} catch (err) {
  send({ kind: 'unavailable', message: String(err?.message ?? err) });
  process.exit(2);
}

// Relaie tous les événements de la librairie.
const emit = telemetry.emit.bind(telemetry);
telemetry.emit = (event, ...args) => {
  send({ kind: 'event', event: String(event), data: args.length <= 1 ? args[0] : args });
  return emit(event, ...args);
};

// État courant à la demande (snapshot) : réduit côté tracker.
process.parentPort.on('message', ({ data }) => {
  if (data?.kind !== 'state') return;
  const current = telemetry.data?.current;
  if (!current) return;
  const job = Object.fromEntries(JOB_FIELDS.map((k) => [k, current[k]]));
  send({ kind: 'state', state: { current, job } });
});

process.on('uncaughtException', (err) => {
  send({ kind: 'unavailable', message: String(err?.message ?? err) });
  process.exit(3);
});

send({ kind: 'ready', sdkActive: Boolean(telemetry.data?.current?.sdkActive) });
