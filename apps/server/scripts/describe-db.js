// Indique quelle base une commande en ligne va modifier : sur l'hébergement, les
// variables saisies dans cPanel ne sont pas visibles du terminal, seul
// apps/server/.env l'est. Une commande qui tomberait sur la base SQLite locale
// en production est presque toujours une erreur de configuration.
export function describeDb(config) {
  if (config.db.client === 'mysql') {
    const m = config.db.mysql;
    return `MySQL ${m.user ?? '?'}@${m.host}/${m.database ?? '?'}`;
  }
  return `SQLite ${config.db.sqliteFile}`;
}

export function announceDb(config) {
  console.log(`Base utilisée : ${describeDb(config)}`);
  if (config.db.client !== 'mysql' && process.env.HOME?.startsWith('/home/')) {
    console.warn(
      'Attention : base SQLite locale. Sur o2switch, créer apps/server/.env avec DB_CLIENT=mysql et les MYSQL_* (voir docs/deploiement-o2switch.md, étape 8).',
    );
  }
}
