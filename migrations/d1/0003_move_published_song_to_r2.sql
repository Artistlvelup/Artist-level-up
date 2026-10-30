-- V101: point the existing published song record at its verified R2 object.
-- This migration is safe to run after 0001_initial_schema.sql has created songs.
-- The source Supabase object must remain available until playback is verified.
UPDATE songs
SET audio_url = 'https://pub-7e08b998aa8f48778971fec0f38c0993.r2.dev/audio_song_1792505499636_ilmfs-Otunba-Cash-Money-Angelina.mp3',
    updated_at = CURRENT_TIMESTAMP
WHERE id = '44875219-61a6-46a6-aa3e-3cb6fb579092'
  AND title = 'Otunba Cash Money Angelina';
