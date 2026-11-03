-- V101 Cloudflare Worker runtime tables.
-- Additive only: no Supabase records or media are copied, moved, or deleted.
-- platform_admins intentionally has no seeded rows; admin access must be granted
-- only after the owner's identity is independently verified.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_session_families (
  family_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_app_session_families_user ON app_session_families(user_id);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  family_id TEXT NOT NULL REFERENCES app_session_families(family_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_family ON app_sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_expiry ON app_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  artist_id TEXT NOT NULL REFERENCES artists(id),
  title TEXT NOT NULL,
  description TEXT,
  budget REAL NOT NULL CHECK (budget >= 0),
  status TEXT NOT NULL DEFAULT 'pending',
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'music',
  video_id TEXT REFERENCES artist_videos(id)
);
CREATE INDEX IF NOT EXISTS idx_promotions_artist_created ON promotions(artist_id, created_at);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id),
  amount REAL NOT NULL CHECK (amount > 0),
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_created ON withdrawals(status, created_at);

CREATE TABLE IF NOT EXISTS marketplace_beats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  producer_name TEXT NOT NULL,
  genre TEXT,
  mood TEXT,
  bpm INTEGER,
  price_ngn INTEGER NOT NULL CHECK (price_ngn >= 0),
  default_license TEXT,
  audio_preview_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marketplace_beats_status_created ON marketplace_beats(status, created_at);

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id TEXT PRIMARY KEY,
  beat_id TEXT REFERENCES marketplace_beats(id),
  buyer_user_id TEXT REFERENCES app_users(user_id),
  beat_title TEXT NOT NULL,
  producer_name TEXT NOT NULL,
  license TEXT,
  amount_ngn INTEGER NOT NULL CHECK (amount_ngn >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending',
  platform_fee_percent REAL,
  platform_fee_ngn INTEGER,
  producer_payout_ngn INTEGER,
  paid_at TEXT,
  paystack_reference TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_buyer_created ON marketplace_orders(buyer_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status_paid ON marketplace_orders(status, paid_at);
