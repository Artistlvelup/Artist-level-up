-- V101 Cloudflare replacement for the retired Supabase music-distribution service.
-- Master audio and artwork are stored in a dedicated private R2 bucket.
CREATE TABLE IF NOT EXISTS music_distribution_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  artist_name TEXT NOT NULL,
  release_title TEXT NOT NULL,
  release_type TEXT NOT NULL CHECK (release_type IN ('Single','EP','Album')),
  genre TEXT NOT NULL,
  preferred_release_date TEXT,
  explicit_content TEXT NOT NULL DEFAULT 'No',
  notes TEXT,
  platforms_json TEXT NOT NULL DEFAULT '[]',
  audio_files_json TEXT NOT NULL DEFAULT '[]',
  artwork_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','quoted','paid','in_review','approved','rejected')),
  quote_amount_minor INTEGER,
  quote_currency TEXT NOT NULL DEFAULT 'NGN' CHECK (quote_currency = 'NGN'),
  admin_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_music_distribution_user
  ON music_distribution_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_distribution_status
  ON music_distribution_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS music_distribution_payments (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES music_distribution_requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  amount_ngn REAL NOT NULL CHECK (amount_ngn > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_music_distribution_payments_request
  ON music_distribution_payments(request_id, status);
