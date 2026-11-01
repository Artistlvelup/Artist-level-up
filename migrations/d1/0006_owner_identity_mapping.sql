-- V101: map only the verified existing owner identity into D1.
-- Source was read-only verified in Supabase on 2026-11-01.
-- Deliberately excludes avatar media, songs, videos, picture posts, and all other users.
-- Preserve the existing Supabase UUIDs; do not create replacement identities.

INSERT OR IGNORE INTO profiles (
  id, display_name, avatar_url, role, created_at, updated_at
) VALUES (
  'd6eaf421-fcad-44ec-beb0-d6a7f676db8a',
  'Solo_vibez',
  NULL,
  'artist',
  '2026-10-11T06:27:51.077386+00:00',
  '2026-10-13T02:19:08.512378+00:00'
);

INSERT OR IGNORE INTO artists (
  id, user_id, artist_name, bio, genre, country, status,
  created_at, updated_at, suspended
) VALUES (
  '2b2a5bf6-9673-42a1-a33a-d40dab98ad44',
  'd6eaf421-fcad-44ec-beb0-d6a7f676db8a',
  'Solo_vibez',
  '',
  '',
  'Nigeria',
  'pending',
  '2026-10-18T07:00:09.637509+00:00',
  '2026-10-18T07:00:09.637509+00:00',
  0
);

INSERT OR IGNORE INTO platform_admins (
  user_id, active, created_at
) VALUES (
  'd6eaf421-fcad-44ec-beb0-d6a7f676db8a',
  1,
  '2026-10-13T02:19:08.512378+00:00'
);
