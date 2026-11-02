-- V101 native Cloudflare password authentication.
-- Prepared on the migration branch only. Applying this file to remote D1 is NOT authorized.
-- Email verification is required before a password account can receive a session.

CREATE TABLE IF NOT EXISTS app_credentials (
  user_id TEXT PRIMARY KEY NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  email_verified_at INTEGER,
  password_changed_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_email_verification_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_email_verification_user
  ON app_email_verification_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_app_email_verification_expiry
  ON app_email_verification_tokens(expires_at);

CREATE TABLE IF NOT EXISTS app_auth_rate_limits (
  bucket_key TEXT PRIMARY KEY NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER
);

CREATE INDEX IF NOT EXISTS idx_app_auth_rate_limits_blocked
  ON app_auth_rate_limits(blocked_until);
