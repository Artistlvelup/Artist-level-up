-- V101 persistent login session families.
-- Each login/device session has one family. Refresh rotates tokens within it.
-- Reuse of a revoked token revokes the entire family to contain token replay.

CREATE TABLE IF NOT EXISTS app_session_families (
  family_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);

ALTER TABLE app_sessions ADD COLUMN family_id TEXT;

-- Preserve any pre-existing prototype sessions as one-token families.
INSERT OR IGNORE INTO app_session_families (family_id, user_id, created_at, revoked_at)
SELECT token_hash, user_id, created_at, revoked_at
FROM app_sessions;

UPDATE app_sessions
SET family_id = token_hash
WHERE family_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_sessions_family_id
  ON app_sessions(family_id);

CREATE INDEX IF NOT EXISTS idx_app_session_families_user_id
  ON app_session_families(user_id);
