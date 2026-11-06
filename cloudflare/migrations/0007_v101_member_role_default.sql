-- V101: make ordinary member profiles default to user, not artist.
-- Rebuild only the profiles table; preserve every existing profile row.
CREATE TABLE profiles_v101_new (
  id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('artist','admin','user')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO profiles_v101_new (id, display_name, avatar_url, role, created_at, updated_at)
SELECT id, display_name, avatar_url,
       CASE WHEN role = 'artist' AND NOT EXISTS (SELECT 1 FROM artists WHERE artists.user_id = profiles.id) THEN 'user' ELSE role END,
       created_at, updated_at
FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_v101_new RENAME TO profiles;
