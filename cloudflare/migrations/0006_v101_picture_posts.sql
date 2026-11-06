-- V101 Cloudflare-only picture posts for artist uploads and the global discovery feed.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS picture_posts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  artist_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','published','rejected','hidden')),
  created_at TEXT NOT NULL,
  sound_title TEXT,
  sound_audio_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_picture_posts_status_created ON picture_posts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_picture_posts_artist_created ON picture_posts(artist_id, created_at);
