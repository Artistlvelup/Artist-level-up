# V101 Cloudflare-only cutover audit — 2026-11-02

Status: audit and backup only. No live V101 files, Render service, Cloudflare production Worker, D1 data, Supabase data, or media objects were changed.

## Source of truth and protection
- Source: `index.html` from `V101-launch-hardening-2026-10-13` at commit `f45b6385534e25f88f8107915019cd1e9d0c120a`.
- Isolated work branch: `migration/v101-cloudflare-only-2026-11-02`.
- Exact source backup: `backups/V101-BACKUP-BEFORE-CLOUDFLARE-ONLY-REPLACEMENT-2026-11-02.html`.
- Backup commit: `689429e60db19baaa436068affe967a906ecf059`.
- The older `migration/d1-v101-prep` HTML is not the live V101 source and must not be used as the replacement target.

## Confirmed live-source dependency counts
- HTML size: 830,999 characters.
- Supabase JS CDN references: 2.
- Supabase config references: 85.
- Supabase Auth method references: 29.
- Supabase table/storage client `.from(...)` calls: 48.
- Supabase Storage calls: 17.
- Supabase Edge Function invocations: 16.
- Direct PostgREST `/rest/v1/` calls: 8.
- Resumable TUS uploader reference: 1.

These are source occurrence counts, not unique API operations.

## Discovered database tables / Storage buckets / Edge Functions
- Client table/bucket names discovered from `.from(...)`: `artist_payout_accounts`, `artist_videos`, `artists`, `avatars`, `marketplace-deliveries`, `marketplace_beats`, `marketplace_orders`, `music`, `picture_posts`, `profiles`, `promotions`, `songs`, `streaming-releases`, `withdrawals`.
- Edge Functions: `artist-pro-checkout`, `artist-pro-verify`, `marketplace-beat-download`, `owner-bank-settings`, `owner-dashboard`, `producer-flutterwave-connect`, `streaming-distribution`, `upload-fee-checkout`.
- Direct PostgREST table: `artist_videos`.
- Auth methods present include `getSession`, `getUser`, `onAuthStateChange`, `resend`, `signInAnonymously`, `signInWithOAuth`, `signInWithOtp`, and `signUp`.
- Storage bucket names include `avatars`, `marketplace-deliveries`, `music`, and `streaming-releases`.

## Required target and hard constraints
- Replace all browser Supabase SDK, Auth, PostgREST, Storage, TUS and Edge Function dependencies with Cloudflare-native Worker APIs, D1 and R2.
- **No Supabase-to-Cloudflare auth bridge. No dual-system or transitional Supabase client.**
- Do not delete, move, re-upload, or rewrite any existing media. Reuse only the song, three picture images and two selected video objects the owner already placed in R2. Leave all other Supabase media and records untouched.
- Keep Supabase available until the replacement is tested and the owner explicitly approves cutover. Removing Supabase code from the V101 browser must not be confused with deleting the Supabase account or data.
- Do not apply production D1 migrations, deploy a production Worker, publish the V101 HTML, or change Render/live traffic without explicit approval.

## Implementation order
1. Map every UI operation to a Worker endpoint and D1/R2 operation; identify missing endpoints before editing application calls.
2. Complete Cloudflare-native owner authentication and persistent sessions, with no Supabase verification or bridge.
3. Complete D1 schema/authorization parity for the features actually used by V101.
4. Complete R2 URL resolution and upload handling without transferring or deleting owner media.
5. Replace payment, marketplace, streaming and admin Edge Function calls with secure Worker endpoints; keep payment secrets server-side and validate provider callbacks/webhooks.
6. Add tests for every mapped operation and run static scans proving zero Supabase SDK/config/Auth/PostgREST/Storage/Edge Function/TUS references remain in the new V101 HTML.
7. Only after tests pass, request explicit approval for a controlled production cutover. Keep the live site and Supabase intact until then.
