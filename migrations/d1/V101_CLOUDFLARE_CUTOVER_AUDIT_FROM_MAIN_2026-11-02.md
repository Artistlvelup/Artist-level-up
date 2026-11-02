# V101 Cloudflare Cutover Audit — 2026-11-02

## Scope and safety
- Authoritative source inspected: `Artist-Level-Up-LAUNCH-MASTER.html` on `main`.
- Source blob at audit time: `1642380cf5845bcb72cd4f958223e3ce65314248`.
- Exact source snapshot preserved at `backups/V101-BACKUP-BEFORE-CLOUDFLARE-CUTOVER-2026-11-02.html`.
- Work branch created from the backup commit: `migration/v101-cloudflare-cutover-from-main-2026-11-02`.
- No live deployment, Supabase write, media transfer, or Supabase deletion performed.
- Preserve the existing login/registration UI. Do not migrate or copy media objects; the owner handles media already placed in Cloudflare.

## Confirmed frontend dependencies in the authoritative source
The launch master is 365,552 characters / 2,627 lines and still includes Supabase SDK and configuration.

| Area | Evidence in source | Required Cloudflare replacement |
|---|---|---|
| Session/bootstrap | Lines 1098–1127: getSession, getUser, signOut, signInAnonymously | Worker-backed session bootstrap and account lifecycle; keep current UI |
| Profile/app state persistence | Lines 1163–1241: Supabase REST/storage-backed persistence and sync | Authenticated Worker API backed by D1; preserve current data model and offline retry behavior |
| Music uploads | Lines 717–732, 1393–1412, 1920–1940, 2582–2613: Supabase Storage, resumable upload and Supabase record lookup | Cloudflare R2 signed upload flow plus D1 metadata; do not copy existing media |
| Video records and moderation | Lines 1970–2008, 2063–2104, 2121–2179: artist_videos REST reads/writes, admin review and deletion | Authenticated Worker routes with role checks and D1 metadata; retain current video URLs and owner-managed media |
| Marketplace / beat checkout | Lines 2525–2547: Supabase client and Edge Function invocation | Worker endpoint and verified Paystack callback/webhook path; never trust browser payment status |
| Cloud song record | Lines 2582–2613: Supabase client and record lookup | D1-backed Worker endpoint |

## Audit counts
- Supabase SDK include: present.
- Supabase client creation: present.
- Supabase auth calls: present (anonymous session bootstrap, session/user lookup, sign-out).
- Supabase Storage calls: present (music upload/list/remove and video upload flow).
- Supabase REST calls: present (video records and related metadata).
- Supabase Edge Function invocation: present (marketplace checkout).
- Cloudflare references exist, but this does not establish a complete cutover.

## Implementation order (non-destructive)
1. Inventory and inspect the existing Cloudflare Worker, D1 schema/migrations, bindings and deployed route configuration against this exact main source.
2. Build a frontend-to-Worker route contract for each operation above; implement server-side authorization and validation first.
3. Add/verify tests for auth/session, profile persistence, music metadata/upload signing, video metadata/moderation and payment verification.
4. Switch frontend calls incrementally while preserving current screens and offline behavior.
5. Run static checks and workflow validation. Do not apply remote D1 migrations or deploy without explicit confirmation and verified backup.
6. Only after all old Supabase references are removed from active runtime paths and end-to-end tests pass, prepare a controlled production cutover.

## Explicit exclusions
- No media transfer from Supabase to Cloudflare.
- No deletion or mutation of Supabase tables, buckets, users or files.
- No redesign or rebuild of login/registration.
- No blind merge of the previously diverged migration branch.
