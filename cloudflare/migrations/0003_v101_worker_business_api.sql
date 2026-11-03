-- Artist Level Up V101: D1 tables required by the existing Cloudflare Worker APIs.
-- Additive only: creates empty tables; does not import, move, or delete user records or media.
-- Apply after 0001_v101_auth_profile_foundation.sql and 0002_v101_worker_sessions_admin.sql.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY NOT NULL,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  budget REAL NOT NULL DEFAULT 0 CHECK (budget >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','active','completed','rejected','paused')),
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'music' CHECK (target_type IN ('music','video')),
  video_id TEXT REFERENCES artist_videos(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_promotions_artist_created ON promotions(artist_id, created_at);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_created ON withdrawals(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_created ON withdrawals(status, created_at);

-- Catalog and order history are read-only through the current Worker routes.
-- Payment settlement must be implemented and verified before orders are written.
CREATE TABLE IF NOT EXISTS marketplace_beats (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  producer_name TEXT NOT NULL,
  genre TEXT,
  mood TEXT,
  bpm INTEGER,
  price_ngn REAL NOT NULL DEFAULT 0 CHECK (price_ngn >= 0),
  default_license TEXT,
  audio_preview_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marketplace_beats_status_created ON marketplace_beats(status, created_at);

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id TEXT PRIMARY KEY NOT NULL,
  buyer_user_id TEXT REFERENCES app_users(user_id) ON DELETE SET NULL,
  beat_id TEXT,
  beat_title TEXT NOT NULL,
  producer_name TEXT NOT NULL,
  license TEXT,
  amount_ngn REAL NOT NULL CHECK (amount_ngn >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  platform_fee_percent REAL NOT NULL DEFAULT 0,
  platform_fee_ngn REAL NOT NULL DEFAULT 0,
  producer_payout_ngn REAL NOT NULL DEFAULT 0,
  paystack_reference TEXT UNIQUE,
  paid_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_buyer_created ON marketplace_orders(buyer_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status_paid ON marketplace_orders(status, paid_at);
