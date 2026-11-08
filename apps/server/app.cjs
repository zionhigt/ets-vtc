// Point d'entrée pour Passenger (o2switch « Setup Node.js App » : Application startup file).
// Passenger charge ce fichier avec require() ; le serveur est un module ESM, chargé dynamiquement.
import('./src/server.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
