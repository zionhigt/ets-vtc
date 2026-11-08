// Couche d'accès minimale à deux dialectes : SQLite (dev, tests) et MySQL/MariaDB (production).
// Les requêtes utilisent des paramètres positionnels `?`, compatibles avec les deux.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {object} Db
 * @property {'sqlite'|'mysql'} dialect
 * @property {(sql:string, params?:unknown[]) => Promise<{changes:number, lastId:number}>} run
 * @property {(sql:string, params?:unknown[]) => Promise<any>} get
 * @property {(sql:string, params?:unknown[]) => Promise<any[]>} all
 * @property {(table:string, columns:string[], rows:unknown[][]) => Promise<number>} insertIgnore
 * @property {() => Promise<void>} migrate
 * @property {() => Promise<void>} close
 */

/** @returns {Promise<Db>} */
export async function openDb(dbConfig) {
  if (dbConfig.client === 'mysql') return openMysql(dbConfig.mysql);
  if (dbConfig.client === 'sqlite') return openSqlite(dbConfig.sqliteFile);
  throw new Error(`DB_CLIENT inconnu : ${dbConfig.client}`);
}

function schemaStatements(dialect) {
  const sql = readFileSync(path.join(here, `schema.${dialect}.sql`), 'utf8');
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

function placeholders(columns, rows) {
  const row = `(${columns.map(() => '?').join(', ')})`;
  return rows.map(() => row).join(', ');
}

async function openSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  return {
    dialect: 'sqlite',
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    async get(sql, params = []) {
      const row = db.prepare(sql).get(...params);
      return row ? { ...row } : undefined;
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params).map((r) => ({ ...r }));
    },
    async insertIgnore(table, columns, rows) {
      if (!rows.length) return 0;
      const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES ${placeholders(columns, rows)}`;
      return Number(db.prepare(sql).run(...rows.flat()).changes);
    },
    async migrate() {
      for (const stmt of schemaStatements('sqlite')) db.exec(stmt);
    },
    async close() {
      db.close();
    },
  };
}

async function openMysql(conf) {
  const mysql = (await import('mysql2/promise')).default;
  const pool = mysql.createPool({ ...conf, waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4' });

  return {
    dialect: 'mysql',
    async run(sql, params = []) {
      const [r] = await pool.query(sql, params);
      return { changes: r.affectedRows, lastId: r.insertId };
    },
    async get(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return rows[0];
    },
    async all(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return rows;
    },
    async insertIgnore(table, columns, rows) {
      if (!rows.length) return 0;
      const sql = `INSERT IGNORE INTO ${table} (${columns.join(', ')}) VALUES ${placeholders(columns, rows)}`;
      const [r] = await pool.query(sql, rows.flat());
      return r.affectedRows;
    },
    async migrate() {
      for (const stmt of schemaStatements('mysql')) await pool.query(stmt);
    },
    async close() {
      await pool.end();
    },
  };
}
