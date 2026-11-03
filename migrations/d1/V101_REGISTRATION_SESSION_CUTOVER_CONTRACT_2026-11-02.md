# V101 Registration and Session Cutover Contract — 2026-11-02

## Scope
Reviewed the authoritative `main` file `Artist-Level-Up-LAUNCH-MASTER.html` and the Cloudflare Worker on `migration/v101-cloudflare-cutover-from-main-2026-11-02`. This is a static source review only. No application code, live service, Supabase data, or media was changed.

## Confirmed current registration behavior
The existing registration UI must remain unchanged:
- Artist / Stage Name
- Email
- Country
- Account PIN (4–6 digits)
- Create Artist Account button

The current `registerArtistNow` handler validates those four values, then writes the profile, `artistRegistered`, and `userAccount` into local application state and calls `persistStateOnly()`. It then calls `window.ALU_CLOUD?.syncProfile?.()` on a best-effort basis; a failed cloud sync only logs a warning and the UI still announces that the account was created.

The PIN is placed in `state.profile.pin`. The profile form separately describes the PIN as locally stored/prototype-only. Therefore the current screen is not currently performing a server-side authenticated registration, and its success message does not prove that a durable server account exists.

## Confirmed current session behavior
The existing Supabase persistence bootstrap:
1. Reads a cached Supabase session.
2. Validates it with `getUser(access_token)`.
3. Signs out a stale session.
4. Creates an anonymous Supabase session when none exists.
5. Exposes the anonymous/authenticated Supabase user ID as `ALU_CLOUD.userId`.

This is separate from the local artist-registration state. The anonymous Supabase session must not be assumed to represent a verified artist identity or be automatically mapped to a new D1 identity.

## Cloudflare Worker mismatch
The current Cloudflare Worker exposes:
- `POST /auth/register`: requires email, display name, and a password of at least 12 characters; creates a pending-verification account and sends a verification email through Resend.
- `POST /auth/verify-email`: consumes a verification token and creates a Worker session.
- `POST /auth/login`: requires email and password and a verified account.
- `POST /auth/request-login-link` and `POST /auth/verify-login-link`: passwordless email-link flow for already verified accounts.

The existing V101 registration screen has no password field, and its 4–6 digit PIN is explicitly a sensitive-action PIN, not a password. The existing registration handler also does not call `/auth/register`. Therefore wiring the current form directly to that endpoint would fail validation or require an unsafe/unauthorized UI or security change.

## Required safe integration decisions
1. Preserve the current registration and login UI exactly as requested. Do not add a password field or replace the form as part of a silent migration.
2. Do not convert the 4–6 digit PIN into a password or weaken the Worker password policy.
3. Specify a secure server-side PIN credential design before using the PIN for authentication: strong salted password hashing is not enough by itself for a low-entropy PIN; require strict per-account and per-IP throttling, progressive lockout, secure recovery, session rotation/revocation, and a documented threat model. Do not store or log plaintext PINs.
4. Alternatively, obtain explicit product approval for a separate email-verification/passwordless onboarding flow that preserves the current screen and clearly explains the email-link step. The current Worker link-login endpoint is not a substitute for new-account verification.
5. Define a verified identity-continuity plan for existing Supabase users before issuing D1 identities. Do not create duplicate users or assume anonymous Supabase IDs are verified account IDs.
6. Change the registration success state only after the Worker confirms a durable account/session, while preserving the existing visual layout and labels.
7. Test new registration, existing-account handling, verification expiry/resend, login, session refresh/logout, rate limits, and account recovery against a non-production D1 database before any production cutover.

## Safety status
- No edits to `Artist-Level-Up-LAUNCH-MASTER.html`.
- No deployment, remote D1 migration, or production auth cutover.
- No Supabase writes/deletions and no media transfer.
- V101 backup remains the protected baseline.
