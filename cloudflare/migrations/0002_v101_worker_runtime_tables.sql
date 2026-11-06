-- V101 Cloudflare Worker runtime tables.
-- Single canonical migration for persistent sessions and admin authorization.
-- Business tables are created only by 0003_v101_worker_business_api.sql.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_session_families (
  family_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_app_session_families_user_id ON app_session_families(user_id);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  family_id TEXT NOT NULL REFERENCES app_session_families(family_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_app_sessions_family_id ON app_sessions(family_id);

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  created_by TEXT
);
