CREATE TABLE IF NOT EXISTS google_login_oauth_states (
 state_hash TEXT PRIMARY KEY NOT NULL, nonce_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_google_login_oauth_states_expires ON google_login_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS google_login_identities (
 google_sub TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
 email_normalized TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_google_login_identities_user ON google_login_identities(user_id);
