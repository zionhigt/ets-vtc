-- Schéma MySQL / MariaDB (production o2switch). Garder aligné avec schema.sqlite.sql.
-- Toutes les dates sont des timestamps en millisecondes (epoch).

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(128) NOT NULL,
  role ENUM('admin', 'driver') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS personal_tokens (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT NULL,
  revoked_at BIGINT NULL,
  CONSTRAINT fk_pt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT NULL,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raw_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  seq BIGINT NULL,
  type VARCHAR(64) NOT NULL,
  client_ts BIGINT NOT NULL,
  received_at BIGINT NOT NULL,
  data LONGTEXT NULL,
  UNIQUE KEY uq_raw_events_user_event (user_id, event_id),
  KEY idx_raw_events_user_ts (user_id, client_ts),
  CONSTRAINT fk_re_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id INT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  target VARCHAR(128) NULL,
  details TEXT NULL,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phase 1 : livraisons reconstituées depuis le journal brut, identité de l'entreprise.

CREATE TABLE IF NOT EXISTS deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  status ENUM('in_progress', 'delivered', 'cancelled', 'interrupted') NOT NULL,
  source_event_id VARCHAR(64) NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT NULL,
  cargo VARCHAR(128) NULL,
  cargo_id VARCHAR(64) NULL,
  cargo_mass DOUBLE NULL,
  city_src VARCHAR(128) NULL,
  city_src_id VARCHAR(64) NULL,
  city_dst VARCHAR(128) NULL,
  city_dst_id VARCHAR(64) NULL,
  company_src VARCHAR(128) NULL,
  company_dst VARCHAR(128) NULL,
  job_market VARCHAR(64) NULL,
  special_job TINYINT(1) NOT NULL DEFAULT 0,
  planned_distance_km DOUBLE NULL,
  income DOUBLE NULL,
  revenue DOUBLE NULL,
  distance_km DOUBLE NULL,
  delivery_time_min DOUBLE NULL,
  earned_xp DOUBLE NULL,
  cargo_damage DOUBLE NULL,
  autopark TINYINT(1) NULL,
  autoload TINYINT(1) NULL,
  cancel_penalty DOUBLE NULL,
  fines_count INT NOT NULL DEFAULT 0,
  fines_total DOUBLE NOT NULL DEFAULT 0,
  tolls_total DOUBLE NOT NULL DEFAULT 0,
  UNIQUE KEY uq_deliveries_source (user_id, source_event_id),
  KEY idx_deliveries_status_end (status, ended_at),
  CONSTRAINT fk_dl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_cursors (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  last_raw_id BIGINT UNSIGNED NOT NULL,
  CONSTRAINT fk_jc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_settings (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  setting_value TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Liens d'accès au site (mode restreint) : seul le hash du token est stocké.
CREATE TABLE IF NOT EXISTS site_links (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(128) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT NULL,
  uses INT NOT NULL DEFAULT 0,
  revoked_at BIGINT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS driving_state (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  last_odometer DOUBLE NOT NULL,
  last_ts BIGINT NOT NULL,
  CONSTRAINT fk_ds_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activité quotidienne (remplace driving_days) : km au compteur et temps de conduite, par jour UTC.
CREATE TABLE IF NOT EXISTS daily_activity (
  user_id INT UNSIGNED NOT NULL,
  day CHAR(10) NOT NULL,
  distance_km DOUBLE NOT NULL DEFAULT 0,
  driving_s INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day),
  CONSTRAINT fk_da_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dernier état connu de chaque chauffeur (snapshot réduit), pour l'affichage en direct.
CREATE TABLE IF NOT EXISTS live_state (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  ts BIGINT NOT NULL,
  data TEXT NOT NULL,
  CONSTRAINT fk_ls_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Métadonnées (version des règles des jobs : un changement déclenche un recalcul).
CREATE TABLE IF NOT EXISTS app_meta (
  meta_key VARCHAR(64) NOT NULL PRIMARY KEY,
  meta_value TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
