# V101 Persistent Login and Session Continuity Requirement

Status: design requirement only; no production code or live service changes.
Target branch: migration/d1-v101-prep.
Authoritative app: V101. Do not edit the V101 website HTML without explicit user approval.

## User requirement

Artist Level Up must behave like Audiomack/Spotify for normal member and artist login:

- Closing the app/browser must not log the user out.
- Minimising or backgrounding the app must not log the user out.
- Restarting the phone must not log the user out.
- Returning after days or normal periods of inactivity should restore the same account without asking for credentials.
- Only an explicit Log out, account/security revocation, or a genuine security event should end the session.
- Users and artists have the same persistence behavior.
- Admin PIN and member account PIN are separate from the ordinary login session.

This is a persistent remembered-device session, not an instruction to make sessions immortal or ignore account security.

## Existing V101 behavior confirmed by source inspection

In `Artist-Level-Up-LAUNCH-MASTER.html` on this branch:

- Around line 547, Supabase client is created with:
  - `persistSession: true`
  - `autoRefreshToken: true`
  - `detectSessionInUrl: true`
- Around lines 1104-1125, bootstrap calls `auth.getSession()`, validates a cached access token using `auth.getUser(access_token)`, signs out the cached session if validation fails, and creates an anonymous Supabase session if no session remains.
- The app stores the returned stable user UUID in `window.ALU_CLOUD.userId`.
- Upload flows retrieve the current session/access token before requesting upload authorization.

Therefore V101 already intends to persist Supabase sessions. The migration must preserve this experience rather than replacing it with login-on-every-open behavior.

## Migration requirements for Cloudflare D1 + Worker

1. **Stable identity:** Preserve each existing Supabase Auth UUID as the same `user_id` in the replacement identity table. Do not generate new IDs for existing members/artists.
2. **Remembered device:** Issue a durable, revocable refresh session after authentication. Store only a hash of the opaque refresh token server-side; never store raw refresh tokens in D1.
3. **Automatic restoration:** On app startup, restore the remembered session silently and rotate refresh tokens securely. Do not show the login screen just because the browser/app was closed, backgrounded, or the phone restarted.
4. **No arbitrary short inactivity logout:** Do not use the current prototype's short-lived access/session expiry as the entire remembered login. Use short-lived access credentials plus a renewable remembered-device refresh session with a clearly defined long maximum lifetime and revocation controls. The exact lifetime must be selected before production.
5. **Explicit logout:** Revoke the current device's refresh session and clear its client credential only when the user chooses Log out. Provide a separate account-wide revoke-all-devices action if supported.
6. **Security revocation:** Revoke sessions when an account is disabled, a user requests security logout, credentials are compromised, or an administrator performs a justified revocation.
7. **Same behavior for roles:** Artist status must not cause more frequent logouts than an ordinary member. Role/permission checks are server-side and refreshed independently from session persistence.
8. **Secure storage:** Prefer a Secure, HttpOnly, SameSite cookie if the app and Worker can be hosted on a compatible same-site domain. If the current Render/Cloudflare domain split prevents that, resolve the domain/cookie architecture before implementation; do not silently fall back to long-lived tokens in localStorage. Protect against XSS and CSRF.
9. **Session rotation and replay protection:** Rotate refresh tokens on use, invalidate the previous token, detect reuse, and revoke the affected session family if a rotated token is replayed.
10. **Sensitive actions:** Persistent login does not bypass PIN, payment, payout, account recovery, or admin authorization checks.
11. **Cutover continuity:** Supabase access tokens cannot simply be reused as Worker sessions. Design and test a one-time, authenticated session exchange/bridge before Supabase is retired. If a truly seamless exchange cannot be proven, communicate any one-time migration prompt honestly rather than promising zero interruption.
12. **Recovery and rollback:** Keep Supabase Auth and existing sessions available until D1 identity mapping, session exchange, refresh, logout, revocation, and rollback have all passed tests.

## Current migration prototype gap

The branch prototype `workers/auth/worker.js` currently creates a basic Worker session with a finite expiry. It is not yet equivalent to V101's persisted Supabase session behavior and must not be treated as production-ready. Extend it only after the session design, cookie/domain approach, token rotation, and migration bridge are reviewed.

## PIN security audit findings relevant to this migration

- The five public owner-admin PIN wrapper functions are executable by `postgres` and `service_role`; they were not granted to `authenticated` in the inspected routine grants.
- The private owner-admin PIN tables are not RLS-enabled, but their table grants returned only `postgres`. They are in the non-exposed `private` schema and accessed through restricted SECURITY DEFINER routines.
- `private.account_pin_credentials` has RLS enabled, and table grants returned only `postgres`; its private SECURITY DEFINER functions enforce `auth.uid()`.
- The owner-admin PIN login rate limit uses a caller-supplied `client_key`; the Worker must derive a trustworthy device/client key and add server-side abuse controls rather than trusting an arbitrary client-supplied identifier.
- `owner_admin_pin_change` itself checks PIN format and updates the hash but does not verify the current PIN or admin session inside its body. The restricted EXECUTE grant is a protection, but the Worker must enforce a valid admin session before exposing this action.
- `set_account_pin_v101` permits an authenticated user to replace their account PIN without checking the previous PIN. Preserve this only if it matches the intended product recovery/change flow; consider requiring current PIN or a verified recovery step for changes.
- Account PIN is 4–6 digits; owner-admin PIN is 6–12 digits. Keep these separate.

## Verification gates before cutover

- Close/reopen browser and restart device: same account restored without login.
- Background/resume app: session remains valid.
- Wait across access-token expiry: refresh succeeds silently.
- Refresh token rotation: old token cannot be reused.
- Explicit logout: current device is logged out; other devices remain logged in unless account-wide logout selected.
- Disabled/revoked account: next API request refuses access and clears the session.
- Multiple devices: independent sessions can be listed/revoked.
- Artist and ordinary member accounts: same persistence behavior.
- Existing UUIDs and account ownership: unchanged.
- Migration bridge: existing active Supabase users can transition without account duplication.
- PIN/admin actions: still require their separate authorization controls.

## Safety boundary

This document is a design specification only. It does not modify the V101 HTML, production Supabase, Cloudflare D1, Worker deployment, or live user sessions.
