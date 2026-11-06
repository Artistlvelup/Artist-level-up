-- V101 Cloudflare-only payment and marketplace settlement foundation.
-- Payment rows are created only after the Worker validates server-side pricing.
-- No secret keys or bank credentials are stored in this migration.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('song_upload','beat_upload','artist_pro','marketplace_beat','course')),
  amount_ngn REAL NOT NULL CHECK (amount_ngn > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_purpose ON payment_transactions(user_id, purpose, status, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status_created ON payment_transactions(status, created_at);

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key TEXT PRIMARY KEY NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE marketplace_beats ADD COLUMN producer_user_id TEXT REFERENCES app_users(user_id);
ALTER TABLE marketplace_beats ADD COLUMN audio_file_url TEXT;
ALTER TABLE marketplace_beats ADD COLUMN cover_url TEXT;
ALTER TABLE marketplace_beats ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (moderation_status IN ('pending','approved','rejected'));

ALTER TABLE platform_admins ADD COLUMN pin_hash TEXT;
ALTER TABLE platform_admins ADD COLUMN pin_salt TEXT;
ALTER TABLE platform_admins ADD COLUMN pin_iterations INTEGER;
ALTER TABLE platform_admins ADD COLUMN pin_changed_at TEXT;
