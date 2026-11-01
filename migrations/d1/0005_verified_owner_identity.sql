-- V101: import only the previously verified active owner identity mapping (display name: Solo Vibes).
-- Source: read-only Supabase verification on 2026-11-01.
-- Deliberately excludes auth.users, passwords, sessions, anonymous accounts,
-- all other profiles, and all media/content rows. The selected owner avatar is
-- not copied to Cloudflare; avatar_url remains NULL.
-- This migration is additive and idempotent. It does not delete or overwrite.

INSERT OR IGNORE INTO profiles (
  id, display_name, avatar_url, role, created_at, updated_at
) VALUES (
  'd6eaf421-fcad-44ec-beb0-d6a7f676db8a',
  'Solo Vibes',
  NULL,
  'artist',
  '2026-10-11 06:27:51.077386+00:00',
  '2026-10-13 02:19:08.512378+00:00'
);

INSERT OR IGNORE INTO artists (
  id, user_id, artist_name, bio, genre, country, status,
  created_at, updated_at, suspended
) VALUES (
  '2b2a5bf6-9673-42a1-a33a-d40dab98ad44',
  'd6eaf421-fcad-44ec-beb0-d6a7f676db8a',
  'Solo Vibes',
  '',
  '',
  'Nigeria',
  'pending',
  '2026-10-18 07:00:09.637509+00:00',
  '2026-10-18 07:00:09.637509+00:00',
  0
);

INSERT OR IGNORE INTO platform_admins (
  user_id, active, created_at
) VALUES (
  'd6eaf421-fcad-44ec-beb0-d6a7f676db8a',
  1,
  '2026-10-13 02:19:08.512378+00:00'
);
