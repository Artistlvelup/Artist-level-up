# V101 Frontend-to-Cloudflare Endpoint Compatibility Map — 2026-11-02

## Scope and safety
- Source: `Artist-Level-Up-LAUNCH-MASTER.html` on `migration/v101-cloudflare-cutover-from-main-2026-11-02`.
- Worker: `workers/auth/worker.js` on the same branch.
- This is a static integration map, not a completed migration or runtime test.
- No production deployment, remote D1 migration, Supabase write/deletion, or media transfer was performed.
- Preserve the current V101 UI, registration/login form appearance, existing accounts, and all user-owned media. Do not copy media out of Supabase; the owner handles any Supabase media cleanup.

## Confirmed frontend Supabase dependencies

| Frontend area | Current Supabase behavior | Required Cloudflare replacement |
|---|---|---|
| Client/bootstrap (HTML lines 541–547, 1098–1133) | Loads Supabase JS SDK, hard-coded project URL/key, creates client, restores/validates Supabase session, creates anonymous Supabase session | Worker base URL config; secure D1-backed session bootstrap/refresh/logout; no Supabase SDK or project credentials |
| Music upload (around 717–732) | Uploads audio to Supabase Storage bucket `music`, obtains public URL | Authenticated R2 upload flow using Worker upload-intent and a signed/direct upload mechanism; persist returned R2 URL through songs API |
| Profile/artist (around 1135–1189; registration/profile handlers around 2461/2493) | Reads/creates `profiles` and `artists`; upserts profile | `GET/PATCH /api/me/profile` and `GET/PATCH /api/me/artist` adapters with exact existing frontend fields and response shapes |
| Song sync and restore (around 1163–1241, 1393–1486, 2582–2621) | Reads/writes `songs`; lists Supabase Storage objects; reconstructs public Storage URLs | `/api/me/songs` CRUD/list endpoints plus R2 audio object operations; preserve existing song IDs/status mapping and avoid moving old media |
| Video upload/record (around 1920–2008) | Uses Supabase resumable Storage upload, then POST/PATCH/GET verifies `artist_videos` via REST | R2 upload-intent + R2 upload completion + `/api/me/videos` POST/PATCH/GET; frontend currently assumes Supabase storage upload token and REST response shape |
| Admin video review (around 2053–2179) | Supabase JS table reads, Storage delete, row delete, status update, direct REST fallback | Authenticated `/api/admin/videos` list/detail/status endpoints; any media deletion must be an explicit owner-approved action and must not be inferred during migration |
| Marketplace (around 2525–2547) | Reads `marketplace_beats`; calls Supabase Edge Function via `functions.invoke(FN)` | `GET /api/marketplace/beats` exists; purchase/payment initiation and fulfillment must be implemented and contract-matched (do not silently substitute a non-payment endpoint) |
| Public song feed (around 2433) | Reads approved/published songs directly from Supabase | Public Worker songs endpoint exists; verify fields, visibility rules, pagination and frontend mapping |

## Worker routes already present in the protected branch

- Auth: `POST /auth/register`, `POST /auth/resend-verification`, `POST /auth/verify-email`, `POST /auth/request-login-link`, `POST /auth/verify-login-link`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/anonymous`, `GET /auth/session`, `POST /auth/logout`.
- Artist data: `/api/me/profile`, `/api/me/artist`.
- Songs: `/api/me/songs` and public songs routes.
- Music/video upload intent: `/api/me/songs/upload-intent`, `/api/me/videos/upload-intent`.
- Videos: `/api/me/videos`, public videos routes, admin videos routes.
- Other app areas: picture posts, marketplace beat listing/orders, withdrawals, streaming distribution and promotions.

## Critical integration blockers

1. **Registration contract mismatch:** current V101 form collects name, email, country and a 4–6 digit Account PIN. The Worker registration endpoint requires a password of at least 12 characters and email verification. Do not convert the PIN into a password or weaken password security. Preserve the existing form UI and settle a secure onboarding/recovery design before wiring it.
2. **Existing-account continuity:** the current frontend bootstraps Supabase anonymous sessions and later associates profile/artist data. The Worker creates independent D1 identities. A deliberate verified identity-linking/migration plan is required to avoid duplicate accounts and loss of access.
3. **Response/payload adapters:** existing frontend uses Supabase query-builder return objects and direct REST shapes. Worker returns JSON envelopes such as `{songs: [...]} `, `{video: ...}`, and `{beats: ...}`. Every call site needs an explicit adapter and error handling.
4. **R2 upload contract:** Worker upload-intent routes exist, but current music and video frontends use Supabase-specific upload flows. Confirm actual R2 binding, bucket/object key policy, signed upload mechanism, public URL configuration and completion/ownership checks before changing upload code.
5. **Marketplace payments:** the frontend calls a Supabase Edge Function for checkout. A beats-list endpoint is not a replacement for payment creation, webhook verification, order fulfillment and download authorization.
6. **Admin authorization:** existing admin flows rely on Supabase authenticated role/table policies. Worker admin routes must be proven against D1 platform-admin records and frontend session handling before replacing those calls.

## Recommended implementation sequence

1. Complete and validate the missing D1 schema/config files and run local SQLite/Worker tests. Do not apply remote migrations yet.
2. Finalize account onboarding and existing-account continuity while retaining the exact current form layout.
3. Add one frontend Cloudflare API/session adapter and test it independently against Worker response contracts.
4. Migrate profile/artist and songs database calls; then music upload through the R2 path.
5. Migrate video upload, video records and admin moderation.
6. Migrate marketplace reads and separately complete secure payment/order fulfillment.
7. Run regression tests on the protected V101 branch; only then remove Supabase SDK, config, client bootstrap, Storage, REST and Edge Function references.
8. Deploy only after owner approval and successful tests. Keep Supabase data/media untouched unless the owner separately requests an operation.

## Verification checklist before declaring Supabase removed

- No Supabase SDK CDN include, project URL/key, client initialization or `ALU_SUPABASE_*` globals.
- No Supabase auth calls, `supabase.co` URLs, Storage URLs, `/rest/v1/` calls, JS query-builder calls or `functions.invoke`.
- Registration/login, existing-account access, profile, songs, audio playback/upload, video upload/list/moderation, marketplace and admin paths pass tests.
- No Supabase media copied or deleted by this cutover.
- Live V101 remains unchanged until the protected branch is reviewed, tested and explicitly approved for deployment.
