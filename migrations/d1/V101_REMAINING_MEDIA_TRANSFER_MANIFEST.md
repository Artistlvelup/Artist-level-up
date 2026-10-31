# V101 media scope decision

Updated 2026-10-31 after the owner's instruction.

## Media already moved by the owner

The Cloudflare-native V101 seed must use only these media objects already present in R2:

- Song: `audio_song_1792505499636_ilmfs-Otunba-Cash-Money-Angelina.mp3`
- Published videos: `video_1792306951137_pephg.mp4` and `video_1792488726169_pcp5c.mp4`
- Three picture-post images under `videos/1/Photo/`

These URLs are already referenced by the seed. Do not upload them again.

## Media intentionally excluded from the Cloudflare seed

The six other videos and the profile avatar that still reference Supabase Storage are intentionally excluded. The owner will handle any desired deletion in Supabase.

- Do not transfer these objects to R2.
- Do not add their Supabase URLs to D1 seed data.
- Do not delete Supabase objects or rows on the owner's behalf.
- Do not treat the exclusion as permission to delete content or metadata.
- The profile avatar is left unset in the first-admin seed until the owner supplies an already-moved image URL or chooses another image.

## Safety

No media transfer or deletion is performed by this manifest. Keep Supabase available until the owner completes their own cleanup and approves a migration/cutover plan.
