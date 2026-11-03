# V101 Cloudflare cutover — current-main integration review (2026-11-02)

## Scope
Compared the protected current V101 launch master on `main` with the older isolated Cloudflare Worker foundation on `migration/v101-cloudflare-only-2026-11-02`. This is a code review only. No production resources or user data were changed.

## Current V101 findings
- The current launch master still loads the Supabase JavaScript SDK, creates `ALU_SUPABASE_CLIENT`, and configures a Supabase project.
- Its persistence bootstrap calls `auth.getSession()`, validates with `auth.getUser()`, and creates anonymous sessions with `auth.signInAnonymously()`.
- Profile and artist sync, song sync/bootstrap, promotions, withdrawals, music storage, video REST operations, marketplace earnings and Edge Function invocations still depend on Supabase.
- The existing page markup and interaction flow are part of the current V101 launch master. A Cloudflare cutover must preserve that UI and adapt its existing actions rather than replace the login/registration screens.
- Current local app state is stored in browser localStorage under `alu_full_v1`; this is not equivalent to a durable, account-linked server migration. A cutover must explicitly preserve the existing client-side experience and define safe account/session continuity.

## Older Worker foundation findings
- Worker has native email/password registration, email verification, password login, passwordless email links, anonymous sessions, session refresh/logout, profile and artist endpoints, plus portions of songs, videos, picture posts, promotions, withdrawals and admin APIs.
- Password registration requires configured Resend email delivery, `SESSION_PEPPER`, D1 bindings and verification. Without these bindings it intentionally fails closed.
- D1 schema contains business tables plus separate identity/session migrations. The initial business schema explicitly omits Supabase Auth foreign keys; account identity mapping is a separate unresolved task.
- The Worker is not a drop-in replacement for the current frontend. Existing V101 frontend calls and response shapes need explicit adapters or matching endpoints.
- The foundation's own gap audit says Google/OAuth and OTP are not ported; eight Edge Functions lack complete Worker replacements; profile/avatar upload, marketplace payment/download fulfillment, payout-account management, owner dashboard/bank settings and payment initiation/verification/webhooks remain outstanding.
- Its Worker code expects R2 configuration for selected uploads. The owner has already placed chosen media in Cloudflare; no media copy, move, delete or re-upload is part of this work.

## Safe implementation sequence
1. Port the reviewed Worker and D1 migration files onto the protected V101 working branch only, after resolving schema and route compatibility. Do not apply migrations remotely at this stage.
2. Build a route/field/response contract for every existing Supabase table, direct REST call and Edge Function used by the current HTML.
3. Implement missing Worker endpoints and payment-provider verification server-side. Keep admin authorization fail-closed until a reviewed owner mapping exists.
4. Add a frontend compatibility adapter behind the existing V101 actions and forms. Preserve the current UI; do not remove the Supabase fallback until parity tests pass.
5. Add integration tests for existing sign-in/registration journeys, existing users/session continuity, profile, artist, songs, videos, picture posts, promotions, withdrawals, marketplace, payments and admin controls.
6. Run local tests and review the full diff. Only after explicit approval should there be any production D1 migration, Worker deployment, Render change, browser cutover or Supabase retirement.

## Explicit exclusions
- No Supabase user/table/bucket/file deletion or mutation.
- No copying, moving, deleting or re-uploading any existing media.
- No production D1 migration or Cloudflare Worker deployment.
- No Render deployment or production frontend cutover.
- No redesign or replacement of the existing login and registration interface.
- No merge of the old migration branch as a whole; it is an older snapshot and must be ported selectively.
