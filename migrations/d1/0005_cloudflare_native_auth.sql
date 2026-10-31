-- Cloudflare-native email/password owner authentication.
-- The first non-anonymous account can be created only with a one-time Worker secret.
ALTER TABLE app_users ADD COLUMN email TEXT;
ALTER TABLE app_users ADD COLUMN password_hash TEXT;
ALTER TABLE app_users ADD COLUMN password_salt TEXT;
ALTER TABLE app_users ADD COLUMN password_iterations INTEGER;
ALTER TABLE app_users ADD COLUMN role TEXT NOT NULL DEFAULT 'artist';

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email
  ON app_users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_bootstrap_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  claimed_at INTEGER
);
INSERT OR IGNORE INTO auth_bootstrap_state (id, claimed_at) VALUES (1, NULL);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  attempt_key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER
);
