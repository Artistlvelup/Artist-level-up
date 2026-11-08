-- Artist Level Up V101 Cloudflare D1 baseline.
-- Reconciled against the existing V101 D1 database on 2026-11-04.
-- IF NOT EXISTS keeps this baseline safe to apply to the already-provisioned
-- empty V101 D1 database; it does not drop, truncate, or move user data.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_users (
  user_id TEXT PRIMARY KEY,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','suspended')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_credentials (
  user_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  email_verified_at INTEGER,
  password_changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_auth_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER
);

CREATE TABLE IF NOT EXISTS app_email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS app_login_link_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_session_families (
  family_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  family_id TEXT NOT NULL REFERENCES app_session_families(family_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'artist' CHECK (role IN ('artist','admin','user')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES app_users(user_id),
  artist_name TEXT NOT NULL,
  bio TEXT,
  genre TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0,1))
);

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  artist_id TEXT NOT NULL REFERENCES artists(id),
  title TEXT NOT NULL,
  genre TEXT,
  audio_url TEXT,
  cover_url TEXT,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artist_videos (
  id TEXT PRIMARY KEY,
  artist_id TEXT REFERENCES artists(id),
  title TEXT NOT NULL,
  description TEXT,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  tiktok_url TEXT,
  instagram_url TEXT,
  facebook_url TEXT,
  youtube_url TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  song_id TEXT REFERENCES songs(id)
);

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

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  created_by TEXT
);

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

CREATE INDEX IF NOT EXISTS idx_app_email_verification_user
  ON app_email_verification_tokens(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_app_login_link_expiry
  ON app_login_link_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_app_login_link_user
  ON app_login_link_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_app_session_families_user
  ON app_session_families(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_family
  ON app_sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_expiry
  ON app_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_artist_videos_public
  ON artist_videos(status, created_at);
CREATE INDEX IF NOT EXISTS idx_artists_status
  ON artists(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_beats_status_created
  ON marketplace_beats(status, created_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_buyer_created
  ON marketplace_orders(buyer_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status_paid
  ON marketplace_orders(status, paid_at);
CREATE INDEX IF NOT EXISTS idx_promotions_artist_created
  ON promotions(artist_id, created_at);
CREATE INDEX IF NOT EXISTS idx_songs_artist_created
  ON songs(artist_id, created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_created
  ON withdrawals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_created
  ON withdrawals(user_id, created_at);
