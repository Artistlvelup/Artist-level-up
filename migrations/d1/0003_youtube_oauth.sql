CREATE TABLE IF NOT EXISTS youtube_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_youtube_oauth_states_expiry ON youtube_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS youtube_oauth_connections (
  connection_id TEXT PRIMARY KEY NOT NULL CHECK (connection_id = 'primary'),
  connected_by_user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
  google_email TEXT,
  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL DEFAULT '',
  refresh_token_ciphertext TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','revoked','error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
