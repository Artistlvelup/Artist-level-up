# V101 Video and R2 Migration Audit

Status: source audit only. No production upload path has been changed, no R2 object has been uploaded, and no Worker has been deployed.

## What the current V101 page does

The current `Artist-Level-Up-LAUNCH-MASTER.html` uses a local IndexedDB queue for video uploads. It stores the selected video Blob on the device, retries when the browser reconnects, and caps cloud uploads at 5 GB in the queue implementation. The page calls a Supabase Edge Function named `artist-level-up-r2-upload` to request an upload URL, then PUTs the file directly to that URL. The function response is expected to contain `uploadUrl`, `publicUrl`, and optionally `objectKey`.

After upload, V101 writes an `artist_videos` row through Supabase REST with title, description, video URL, thumbnail URL, pending status and social links. The app later reads the video table for artist feeds and admin review. Admin actions update status and delete both the database row and Storage object.

The existing browser upload path is therefore already designed around direct-to-R2 uploads; it is not using Supabase Storage's TUS uploader for the video queue. The HTML also contains separate Supabase Storage usage for other media and must be audited independently.

## Verified database fields

The current D1 schema has these `artist_videos` fields:

- `id`, `artist_id`, `title`, `description`, `video_url`, `thumbnail_url`, `status`
- `tiktok_url`, `instagram_url`, `facebook_url`, `youtube_url`
- `views`, `likes`, `created_at`, `song_id`

The existing Worker prototype does not yet implement video endpoints.

## Required D1 Worker contract

The intended migration contract is:

- `POST /api/me/videos/upload-intent`: authenticated active artist only; validate filename, MIME type and bounded size; generate an opaque object key under a server-controlled artist prefix; return a short-lived upload authorization.
- `POST /api/me/videos`: create the video metadata row only after the upload is confirmed; derive artist ID from the session; force status to `pending`.
- `GET /api/me/videos`: return only the signed-in artist's videos.
- `PATCH /api/me/videos/:id`: allow only safe metadata edits; never allow client status, views, likes, artist ID or video URL changes.
- `DELETE /api/me/videos/:id`: verify ownership before deleting the D1 row and associated R2 object.
- Admin review/publish/reject/delete must be separate admin-only routes backed by a verified `platform_admins` record and an audit log. Do not trust an admin flag or role supplied by the browser.

## R2 design decision still required

The existing browser flow expects a public URL and a direct PUT upload URL. The Worker can use an R2 bucket binding for server-side object operations, but a binding alone does not provide a presigned browser PUT URL. Before implementing the upload-intent endpoint, choose and configure one of:

1. A short-lived S3-compatible presigned PUT URL generated server-side using R2 credentials held only as Worker secrets; or
2. A Worker-mediated streaming upload endpoint, with explicit request-size, timeout, and resumability constraints.

For video files as large as the current 5 GB client limit, a single Worker-mediated request is not a safe substitute for the current direct-upload architecture. Prefer short-lived presigned multipart uploads or a carefully designed multipart strategy. Confirm R2 CORS, public delivery/custom domain, accepted MIME types, maximum object size, and object lifecycle before cutover.

The current source references the Supabase function `artist-level-up-r2-upload`, but its implementation was not found at the expected repository path during this audit. Its actual deployment configuration, signing implementation, R2 bucket binding, and CORS policy remain unverified.

## Cutover blockers

- Retrieve and review the existing Edge Function source/configuration and confirm whether it is already signing URLs for the `artist-level-up-videos` bucket.
- Confirm the exact R2 public delivery domain and whether video playback needs HTTP Range support.
- Confirm the actual upload-size policy; the current HTML contains both a 5 GB queue constant and a 50 MB user-facing message, so the UI and server limits are inconsistent.
- Implement admin authorization from verified database records, not browser state.
- Add tests for forged artist IDs, cross-artist reads/updates/deletes, unauthorized moderation, expired upload authorization, MIME/size rejection, object-key traversal, and deletion failures.
- Preserve existing R2 objects and Supabase data until playback and rollback are verified.

## Safety

This audit does not authorize changing the live V101 HTML, deleting Supabase data, applying D1 migrations remotely, or deploying the prototype Worker. Keep the current Supabase upload path available until the R2 replacement passes end-to-end tests.
