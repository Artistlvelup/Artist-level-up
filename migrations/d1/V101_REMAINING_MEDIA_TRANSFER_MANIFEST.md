# V101 remaining media transfer manifest

Checked against the live Supabase records on 2026-10-31. This is a transfer manifest only: it does not change Supabase, R2, D1, the Worker, or the live website.

## Already copied and referenced by the V101 seed

- Published video `video_1792306951137_pephg.mp4`
- Published video `video_1792488726169_pcp5c.mp4`
- Song `audio_song_1792505499636_ilmfs-Otunba-Cash-Money-Angelina.mp3`
- Three picture-post images under `videos/1/Photo/`

The published video URLs in `workers/auth/worker.js` already point to the verified R2 objects. Do not upload them again.

## Remaining video objects

All six source URLs below are public objects in the Supabase `music` bucket. Preserve their original moderation status and metadata during transfer.

| Video ID | Object filename | Status | Proposed R2 object key |
|---|---|---|---|
| `f1e7e2fb-efea-41cf-8d49-01c5df5694c0` | `video_1792487251174_mygum.mp4` | pending | `videos/1/migrated/video_1792487251174_mygum.mp4` |
| `375f98e4-e91a-497c-b8b0-8e7e2668deae` | `video_1793006594271_ymakg.mp4` | pending | `videos/1/migrated/video_1793006594271_ymakg.mp4` |
| `df376905-995d-4151-ace0-20bf3dcf20bb` | `video_1792309718487_szkjs.mp4` | rejected | `videos/1/migrated/video_1792309718487_szkjs.mp4` |
| `b4c0d44a-ab87-4d68-b937-5f429275b6af` | `video_1792455775612_sjyc3.mp4` | pending | `videos/1/migrated/video_1792455775612_sjyc3.mp4` |
| `645967d2-028a-4d84-a8ee-c70f58bc62db` | `video_1792489364319_0z4rr.mp4` | pending | `videos/1/migrated/video_1792489364319_0z4rr.mp4` |
| `0c830261-d479-46e0-83c6-24e36180501d` | `video_1792502188829_6dcpw.mp4` | pending | `videos/1/migrated/video_1792502188829_6dcpw.mp4` |

## Remaining profile image

The artist profiles for `d6eaf421-fcad-44ec-beb0-d6a7f676db8a`, `c7afccc3-58c3-44bf-805b-64084c73216f`, and `dac25a7b-74b6-40cd-aa5f-ede4547cc4e7` currently share this same Supabase avatar object:

- Source: `avatars/d6eaf421-fcad-44ec-beb0-d6a7f676db8a/profile.jpg`
- Proposed R2 key: `avatars/legacy-owner/profile.jpg`

Transfer once and update each profile reference to the same verified public R2 URL.

## Transfer acceptance checks

1. Download every source object and confirm HTTP success and non-zero bytes.
2. Upload to the proposed R2 key without overwriting unrelated existing keys.
3. Verify object size and content type after upload.
4. Verify public GET and byte-range playback for every video.
5. Only after all checks pass, update the corresponding D1 seed URLs and profile avatar URL.
6. Keep all six statuses, titles, descriptions, IDs, timestamps, views and likes unchanged.
7. Do not delete or disable Supabase objects. Keep Supabase available for rollback until the full V101 cutover is approved.

## Current blocker

The Supabase Edge Function `artist-level-up-r2-upload` is active and its source confirms it can create short-lived R2 upload URLs, but its R2 credentials are held in Supabase Function secrets and are not readable through the connector. The transfer itself therefore still requires an authorized server-side transfer runner with access to the R2 S3 credentials. Never put those credentials in browser code or this repository.
