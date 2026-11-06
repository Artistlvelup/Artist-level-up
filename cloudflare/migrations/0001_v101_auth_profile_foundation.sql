-- Artist Level Up V101 Cloudflare D1 foundation
-- This migration creates the first Cloudflare-owned auth/profile/API tables.
-- It does not copy, move, or delete any Supabase records or media.

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

CREATE TABLE IF NOT EXISTS app_email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_app_email_verification_user ON app_email_verification_tokens(user_id, expires_at);

CREATE TABLE IF NOT EXISTS app_auth_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('artist','admin','user')),
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
CREATE INDEX IF NOT EXISTS idx_artists_status ON artists(status);

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
CREATE INDEX IF NOT EXISTS idx_songs_artist_created ON songs(artist_id, created_at);

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
CREATE INDEX IF NOT EXISTS idx_artist_videos_public ON artist_videos(status, created_at);
