-- V101: one-time, short-lived tokens for the existing email-link login flow.
-- Additive only. Does not migrate, modify, or delete user accounts or media.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS app_login_link_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_app_login_link_user ON app_login_link_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_app_login_link_expiry ON app_login_link_tokens(expires_at);
