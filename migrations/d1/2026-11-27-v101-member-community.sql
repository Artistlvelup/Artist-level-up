CREATE TABLE IF NOT EXISTS community_posts (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
 media_type TEXT NOT NULL CHECK (media_type IN ('picture','video')),
 media_url TEXT NOT NULL,
 content_type TEXT NOT NULL,
 caption TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','removed')),
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_posts_feed ON community_posts(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_user ON community_posts(user_id,created_at DESC);
