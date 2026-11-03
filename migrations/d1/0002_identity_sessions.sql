-- V101 replacement anonymous identity/session tables.
-- This migration is intentionally separate from the initial business schema.
-- Apply only after the auth Worker and data mapping have been reviewed.

CREATE TABLE IF NOT EXISTS app_users (
  user_id TEXT PRIMARY KEY NOT NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 1 CHECK (is_anonymous IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id
  ON app_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at
  ON app_sessions(expires_at);
