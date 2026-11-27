-- V101: persist the role selected during the single registration flow.
CREATE TABLE IF NOT EXISTS user_account_types (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  account_type TEXT NOT NULL CHECK (account_type IN ('member','artist')),
  artist_name TEXT,
  artist_country TEXT NOT NULL DEFAULT 'Nigeria',
  created_at TEXT NOT NULL
);
