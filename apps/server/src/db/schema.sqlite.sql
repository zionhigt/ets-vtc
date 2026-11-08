-- Schéma SQLite (dev, tests). Garder aligné avec schema.mysql.sql.
-- Toutes les dates sont des timestamps en millisecondes (epoch).

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'driver')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS raw_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  seq INTEGER,
  type TEXT NOT NULL,
  client_ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  data TEXT,
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_events_user_ts ON raw_events (user_id, client_ts);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);

-- Phase 1 : livraisons reconstituées depuis le journal brut, identité de l'entreprise.

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'delivered', 'cancelled', 'interrupted')),
  source_event_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  cargo TEXT,
  cargo_id TEXT,
  cargo_mass REAL,
  city_src TEXT,
  city_src_id TEXT,
  city_dst TEXT,
  city_dst_id TEXT,
  company_src TEXT,
  company_dst TEXT,
  job_market TEXT,
  special_job INTEGER NOT NULL DEFAULT 0,
  planned_distance_km REAL,
  income REAL,
  revenue REAL,
  distance_km REAL,
  delivery_time_min REAL,
  earned_xp REAL,
  cargo_damage REAL,
  autopark INTEGER,
  autoload INTEGER,
  cancel_penalty REAL,
  fines_count INTEGER NOT NULL DEFAULT 0,
  fines_total REAL NOT NULL DEFAULT 0,
  tolls_total REAL NOT NULL DEFAULT 0,
  UNIQUE (user_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_status_end ON deliveries (status, ended_at);

CREATE TABLE IF NOT EXISTS job_cursors (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_raw_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS company_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT
);

-- Liens d'accès au site (mode restreint) : seul le hash du token est stocké.
CREATE TABLE IF NOT EXISTS site_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);

-- Kilométrage réel (compteur du camion), y compris hors mission, par jour (UTC).
CREATE TABLE IF NOT EXISTS driving_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  distance_km REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS driving_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_odometer REAL NOT NULL,
  last_ts INTEGER NOT NULL
);
