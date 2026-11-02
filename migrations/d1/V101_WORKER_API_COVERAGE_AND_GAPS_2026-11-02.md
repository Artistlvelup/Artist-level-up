# V101 Worker coverage and remaining cutover gaps — 2026-11-02

## Worker endpoints present in the isolated branch
- Native auth: `POST /auth/register`, `POST /auth/resend-verification`, `POST /auth/verify-email`, `POST /auth/login`, `POST /auth/anonymous`, `GET /auth/session`, `POST /auth/refresh`, `POST /auth/logout`.
- Profile and artist: `GET/PUT /api/me/profile`, `GET/POST /api/me/artist`.
- Songs: `GET/POST /api/me/songs`, public song listing, and admin song routes.
- Videos: `GET/POST/PATCH/DELETE /api/me/videos`, signed R2 video upload intent, public video listing, and admin video routes.
- Promotions: `/api/me/promotions`.
- Withdrawals: `/api/me/withdrawals` and admin withdrawals.
- Marketplace read-only: public published beats, current user's orders; admin commission listing.

## Existing frontend capabilities that still need replacement or exact request/response mapping
- OAuth and OTP authentication methods are present in V101; native Worker currently implements email/password registration, verification and login only. Google/OAuth and phone/email OTP flows are not ported.
- Supabase data access includes 14 table/bucket names: `artist_payout_accounts`, `artist_videos`, `artists`, `avatars`, `marketplace-deliveries`, `marketplace_beats`, `marketplace_orders`, `music`, `picture_posts`, `profiles`, `promotions`, `songs`, `streaming-releases`, `withdrawals`.
- V101 calls eight Supabase Edge Functions: `artist-pro-checkout`, `artist-pro-verify`, `marketplace-beat-download`, `owner-bank-settings`, `owner-dashboard`, `producer-flutterwave-connect`, `streaming-distribution`, `upload-fee-checkout`. None has a complete Cloudflare Worker replacement in this foundation.
- Picture-post feed CRUD is now implemented in the Worker: public feed GET; authenticated own-post GET/POST/PATCH/DELETE; ownership checks; image URLs must reference the configured existing R2 public base. This records metadata only and does not upload or move media. Profile/avatar upload, music/release upload, marketplace order/payment/download fulfillment, payout-account management, streaming distribution workflows, owner dashboard/bank settings, and payment initiation/verification/webhook processing remain outstanding.
- Existing V101 also calls Supabase PostgREST directly for `artist_videos`; those browser calls must be replaced by Worker routes.
- Existing V101's browser code has not yet been changed on this branch. Supabase references remain in the copied live V101 HTML until all features have safe, tested replacements.

## Security and media constraints
- Never accept a browser-supplied user ID, role, or admin flag as proof of identity. Derive identity from the Worker session.
- Admin access remains fail-closed until the owner identity is verified and a protected admin mapping is provisioned through a reviewed, one-time process.
- Payment provider secrets and callback verification must remain server-side; client redirects are not proof of payment.
- For media already placed by the owner in R2, store/reuse its exact public object URL or object key after owner confirmation. Do not copy, move, delete, or re-upload any media.
- No production D1 migration, Worker deployment, Render change, browser cutover, or Supabase deletion is authorized by this preparation work.

## Validation status
- GitHub Actions run `41460401090` passed: local SQLite migration/schema validation, Worker JavaScript syntax, password-auth route tests, and explicit test that the legacy auth bridge endpoint is absent.
- This proves the foundation checks pass; it does not prove feature parity or readiness to switch V101.
