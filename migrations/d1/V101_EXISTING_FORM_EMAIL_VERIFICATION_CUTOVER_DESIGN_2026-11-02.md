# V101 registration cutover design decision record — 2026-11-02

## Scope and safety
This document is design-only. It does not change the V101 launch HTML, deploy a Worker, apply D1 migrations, change Cloudflare resources, or alter Supabase data or media. The protected V101 backup remains the rollback point.

## Verified current contract
- The existing V101 registration screen collects artist name, email, country, and a 4–6 digit Account PIN.
- The current browser handler stores those values in local app state first and treats cloud sync as best-effort. It can display account-created success without durable server confirmation.
- The current profile screen explicitly labels the PIN as prototype/local-device storage.
- The current Cloudflare Worker registration endpoint instead requires a 12–128 character password and sends an email verification link. It cannot accept the existing form payload.
- The Worker already has one-time email verification and passwordless login-link routes, but the registration route creates password credentials. The login-link route only works after an account has been verified.
- The current Worker profile endpoint can upsert a profile, and artist endpoint can create an artist record, but no registration verification route currently creates the artist row from the existing V101 registration fields.
- The live Cloudflare D1 database was previously inspected as having zero tables. No migrations have been applied remotely and no Worker has been deployed.

## Recommended compatible flow (not yet implemented)
1. Keep the existing registration and login screens and field layout. Do not ask artists to invent a 12-character password as part of this cutover.
2. Add a dedicated pending-registration flow that accepts only name, normalized email, and country. Treat the existing PIN as a local-only prototype preference for now; never send it as a password, hash it as a low-entropy authentication secret, or use it to issue sessions.
3. Before creating a D1 identity, check for an existing verified identity and a controlled legacy-identity mapping. Do not silently create a second account for an email already present in the legacy system.
4. Store a pending registration with an unpredictable, one-time verification token hash, strict expiry, rate limits by IP and normalized email, and a resend cooldown. Send a verification link through the configured email provider. Do not create an authenticated session until the token is consumed.
5. On successful verification, atomically consume the token, create/activate the D1 user and profile, create the artist record using the submitted artist name and country, and issue a native session. Use a unique normalized-email constraint and transaction/batch safeguards to prevent duplicate creation and token replay.
6. Existing Supabase users require an explicit identity-continuity plan before cutover. The system must map their verified existing identity to a D1 user ID without duplicate accounts or losing access. The D1 database is currently empty, so do not assume existing accounts have been migrated.
7. The frontend must wait for the Worker response before showing account-created success. If verification is pending, show a clear pending-verification message within the existing visual design. Do not report a durable account as created when only localStorage was written.
8. Preserve existing media URLs and do not move, copy, or delete any Supabase media. Media storage cutover is a separate workstream and requires the user's existing Cloudflare assets and explicit mapping; no media operation is part of this auth flow.

## Security requirements before implementation
- One-time random tokens with only token hashes stored in D1; short expiry; atomic consumption; replay rejection.
- Email/IP rate limiting, resend cooldown, anti-enumeration responses where appropriate, and bounded request bodies.
- Never use the 4–6 digit PIN as an authentication password. If the product later requires a server-verified PIN for sensitive actions, it needs a separate threat model, strong rate limiting/lockout, recovery design, and explicit product approval.
- Do not weaken the existing Worker password policy to accept the PIN.
- Do not issue sessions to unverified registrations.
- Do not expose credentials or tokens in logs.

## Required tests
- Successful pending registration and email send.
- Duplicate email and concurrent duplicate registration.
- Expired, malformed, replayed, and already-consumed verification tokens.
- Email provider failure leaves no active account and does not invalidate an earlier still-valid verification link.
- Rate limiting and resend cooldown.
- Verification creates exactly one profile and one artist row, and returns one valid session.
- Existing legacy identity mapping prevents duplicate D1 identities.
- Browser integration test proves the existing registration form is unchanged and only shows success after the Worker confirms the correct state.

## Cutover gate
No frontend auth switch, D1 remote migration, Worker deployment, Supabase removal, or production traffic change until:
- identity continuity has a tested mapping plan;
- the compatible pending-registration and verification routes pass runtime tests against a D1-compatible test database;
- the frontend adapter is integrated and tested without changing the existing forms;
- profile/artist/session bootstrap and recovery paths are verified;
- the user explicitly approves the production cutover.

## Current status
Design recommendation only. No production resources or user data have been changed.
