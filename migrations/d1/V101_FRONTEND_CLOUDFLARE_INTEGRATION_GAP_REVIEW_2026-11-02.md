# V101 Frontend-to-Cloudflare Integration Gap Review
Date: 2026-11-02
Source: protected branch `migration/v101-cloudflare-cutover-from-main-2026-11-02`
Frontend: `Artist-Level-Up-LAUNCH-MASTER.html` (the current main launch master copied from the protected V101 backup)
Worker: `workers/auth/worker.js`

## Safety boundary
- This is an integration review only. No production deployment, remote D1 migration, Supabase write/delete, or media transfer was performed.
- Preserve the existing V101 login and registration interface and its current layout. Connect its existing controls to the new API; do not redesign or rebuild the forms.
- Do not transfer or delete any Supabase media. The owner handles any later Supabase media cleanup.

## Confirmed frontend dependencies still present
The launch master still loads the Supabase JS SDK and creates `window.ALU_SUPABASE_CLIENT`. It still uses:
- Auth: `getSession()`, `getUser()`, `signOut()`, and `signInAnonymously()`.
- Database tables: `artists`, `profiles`, `songs`, `promotions`, `withdrawals`, `artist_videos`, `marketplace_beats`, and `marketplace_orders`.
- Storage: music bucket uploads, public URL generation, listing, and a remove call in the admin music path.
- Edge Function: `marketplace-paystack-checkout`.

The existing Worker is a separate API contract. Its relevant routes include:
- Auth: `/auth/register`, `/auth/resend-verification`, `/auth/verify-email`, `/auth/request-login-link`, `/auth/verify-login-link`, `/auth/login`, `/auth/refresh`, `/auth/anonymous`, `/auth/session`, `/auth/logout`.
- Profile/artist: `/api/me/profile`, `/api/me/artist`.
- Music: `/api/me/songs`, `/api/me/songs/upload-intent`, `/api/public/songs`, plus admin song routes.
- Video/picture posts: `/api/me/videos`, `/api/me/videos/upload-intent`, `/api/public/videos`, `/api/me/picture-posts`, `/api/public/picture-posts`.
- Other app areas: promotions, withdrawals, streaming distribution, marketplace beats/orders and admin routes.

## Required frontend adapter work before cutover
1. Add one Cloudflare API client wrapper that handles the Worker base URL, JSON requests, bearer access token, refresh/session expiry, CORS errors, and consistent error messages.
2. Wire the existing login/registration controls to the Worker auth endpoints while preserving their current HTML, labels, styling, and user flow. Confirm the intended existing registration fields can be safely mapped to the Worker request schema before enabling it.
3. Replace Supabase session bootstrap with the Worker session endpoints. Do not silently create a new identity for an existing account. Existing Supabase account IDs and account continuity need an explicit, verified mapping plan before switching authentication.
4. Replace profile and artist reads/writes with `/api/me/profile` and `/api/me/artist`; verify field-name and response-shape compatibility.
5. Replace song reads/writes/status changes with the Worker song endpoints. Uploads need the Worker upload-intent flow and owned R2 URLs; do not assume existing Supabase storage URLs are accepted.
6. Replace video and picture-post reads/writes/moderation with the corresponding Worker routes. Confirm the existing frontend's expected response shapes, status names, and admin authorization.
7. Replace promotions, withdrawals, and marketplace reads with their Worker routes. Marketplace checkout is not proven migrated: the current frontend invokes the Supabase Edge Function `marketplace-paystack-checkout`, and the Worker route list does not establish an equivalent Paystack initiation/verification/webhook flow.
8. Remove the Supabase SDK/config only after all call sites are migrated and tests prove no Supabase dependency remains. Do not remove user-owned media or execute any Supabase deletion.

## Blocking infrastructure prerequisites
- The target branch still lacks `migrations/d1/0001_initial_schema.sql` and `wrangler.toml`.
- The previously reviewed identity/session migration files alone are not a complete D1 database.
- Do not run the remote D1 apply workflow or deploy the Worker until the complete schema, Worker configuration, secrets/bindings, and local tests are present and verified.

## Verification checklist
- Existing login and registration screens remain visually and behaviorally intact.
- Existing account continuity is proven with a deliberate identity mapping; no accidental duplicate accounts.
- Each frontend feature has a matching Worker request and response contract.
- R2 upload intent, ownership validation, and existing owner-managed Cloudflare assets are tested without copying or deleting media.
- Paystack checkout, payment verification, webhook handling, and order fulfillment are proven end-to-end before marketplace launch.
- Unit tests, schema validation, and a non-production integration test pass before any production cutover.
