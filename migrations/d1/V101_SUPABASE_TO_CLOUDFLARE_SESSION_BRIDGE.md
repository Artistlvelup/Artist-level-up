# V101 Supabase-to-Cloudflare Session Bridge Design

Status: design reference with an implemented migration-branch prototype. The Worker bridge and V101 owner-admin unlock are implemented on `migration/d1-v101-prep`; the Worker preview is deployed to workers.dev. Production V101 and remote D1 remain unchanged.
Branch: `migration/d1-v101-prep`.

## Decision

Do not ask existing V101 users to log in again merely because the backend changes. Use a one-time, server-verified session exchange while the existing Supabase session is still valid. The Cloudflare Worker then issues its own persistent, revocable session tied to the exact existing Supabase UUID.

This preserves account identity and avoids treating every app open as a fresh anonymous registration.

## Existing V101 facts

- The V101 client uses Supabase JS v2 with `persistSession: true` and `autoRefreshToken: true`.
- Startup reads the cached session, validates the access token using `auth.getUser(access_token)`, and creates an anonymous Supabase identity only if no valid session exists.
- The UUID is retained in `window.ALU_CLOUD.userId`.
- There is no inspected email/password sign-up or password-login call in this HTML snapshot.
- The Worker now has `POST /auth/bridge/supabase`. It verifies the current access token against the configured Supabase Auth `/auth/v1/user` endpoint, allows only the exact verified owner UUID and active D1 admin mapping, and issues a 30-day opaque bearer session. The migration HTML keeps that Worker token in memory only and revokes it on owner logout. It does not persist the Cloudflare token in localStorage or IndexedDB.

## Implemented one-time bridge (migration branch)

### 1. Client keeps current Supabase session alive

During the transition release, the existing V101 Supabase client remains configured and is allowed to restore/refresh the current session. It must not call `signOut()` just because the Worker session is not yet present.

### 2. Client asks Worker to exchange the current session

Proposed request:

```http
POST /auth/bridge/supabase
Authorization: Bearer <current Supabase access token>
Content-Type: application/json
```

No user ID, email, role, artist ID, or anonymous flag is accepted from the request body. The Worker must derive identity exclusively from successful server-side validation of the Supabase token.

### 3. Worker verifies token with the existing Supabase Auth service

For the first bridge, the Worker calls the project's Auth user endpoint over HTTPS using:
- the project URL configured as a Worker environment variable;
- the Supabase publishable/anon key configured as a Worker secret or protected environment binding;
- the presented access token as the Bearer token.

The response must be successful and contain a valid user UUID. The Worker must not trust a JWT payload decoded without signature verification, and must not accept a client-supplied UUID.

The Worker must also check that the project issuer/host is the one configured for this migration. Handle anonymous and non-anonymous accounts according to the actual returned Auth user record; do not invent an email/password migration path.

If Supabase Auth cannot validate the token, do not issue a Cloudflare session. Return a recoverable bridge error and keep the existing Supabase session available for retry.

### 4. Preserve the exact existing UUID

Use the validated Supabase user UUID as `app_users.user_id`. Insert/upsert the identity only when allowed by the migration mapping rules. Never create a different UUID for an already-known user.

Before bridge is enabled, import/reconcile all auth user IDs against existing business-table foreign keys. If a UUID is not in the verified migration allow-list or its account is disabled/deleted, deny bridge rather than creating an orphan identity.

### 5. Issue a new remembered-device session

Generate:
- a random session ID;
- a high-entropy random refresh token;
- a hash of the refresh token using a server-held pepper;
- a separate short-lived access credential if the final API architecture needs one.

Store only the refresh-token hash in D1. Store device/session metadata, created time, last-used time, expiry, rotation/revocation fields, and the preserved user UUID. Never store the raw refresh token in D1 or logs.

The raw refresh token is delivered once to the client through the approved secure storage mechanism. Every refresh rotates it; the previous token becomes unusable. Reuse of an old rotated token revokes the affected session family and triggers security handling.

### 6. Persistent storage and cookie/domain decision

Preferred production design:
- Serve the Worker API on a same-site custom API hostname under the app's own registrable domain.
- Use a `Secure; HttpOnly; SameSite=Lax` refresh cookie with a narrow Path and appropriate Domain scope (prefer host-only if same host is possible).
- Use CSRF protection for state-changing cookie-authenticated requests (Origin/Referer validation plus a CSRF token or equivalent).
- Keep access credentials short-lived and in memory where practical.

Do not assume a Worker on `workers.dev` can set a first-party cookie for an unrelated Render hostname. Cross-site cookies may be blocked by browser privacy controls. Before implementation, confirm the actual V101 production hostname and choose a same-site route/custom domain.

Fallback only if a same-site HttpOnly cookie cannot be provided:
- Use IndexedDB for the opaque refresh token rather than localStorage.
- Apply strict CSP, output escaping, dependency pinning, no third-party script injection, refresh rotation, and server-side revocation.
- Document that IndexedDB is still readable by same-origin JavaScript and is therefore less protective against XSS than an HttpOnly cookie.
- Do not describe this fallback as equivalent to HttpOnly cookie security.

## Startup behavior after bridge

1. App starts and silently attempts to restore the Cloudflare remembered-device session.
2. If valid, open the existing account without showing the login screen.
3. If the Cloudflare session is missing but a valid Supabase session remains during the transition, perform the bridge silently.
4. If both are unavailable, show a clear recovery/sign-in route; never silently create a new account and discard the old UUID.
5. If Worker or D1 is temporarily unavailable during transition, do not erase the Supabase session or local user identity. Retry safely.

## Refresh and logout policy

- Access credential: short-lived; renewed silently.
- Remembered-device refresh session: renewable with rotation and revocation. Select a long maximum lifetime only after product/security review; do not make it immortal.
- Closing/minimising/restarting the app does not revoke the session.
- Normal inactivity does not cause a short arbitrary logout.
- Explicit logout revokes only the current device session by default.
- Account-wide logout/revoke-all is a separate security action.
- Disabled accounts, confirmed compromise, or deliberate administrative revocation invalidate sessions.
- Artist/member role and permissions are checked server-side and do not change the persistence behavior.
- Member PIN and owner-admin PIN remain separate from normal login sessions.

## Cutover sequence

1. Keep Supabase Auth live; prepare D1 identity allow-list and data imports.
2. Deploy bridge-capable Worker to a non-production test hostname only after review.
3. Test exchange with test identities; prove UUID preservation and reject tampered/expired/wrong-project tokens.
4. Test cookie behavior on the actual mobile browser and app hostname, including app close, browser restart, and several-day return.
5. Test rotation, replay detection, current-device logout, revoke-all, disabled-account revocation, and Worker/D1 outage behavior.
6. Release a transition V101 build only with explicit user approval. It restores Supabase session first, then exchanges it; it must not sign users out first.
7. Monitor successful bridge counts and failures while keeping Supabase Auth available.
8. Retire Supabase Auth only after all eligible users are bridged or a user-approved recovery path is in place, and after rollback is tested.

## Critical limitations and unresolved decisions

- A Supabase access token is not itself a Cloudflare session and cannot simply be copied into D1.
- A one-time exchange can be seamless only while the existing Supabase session is still valid and the Worker can verify it. Users whose browser storage was cleared, whose session expired/revoked, or who use a new device need an account recovery path.
- Current V101 uses anonymous Supabase sessions in the inspected code. Do not claim email/password credentials exist or promise password migration.
- The production app's final hostname and ability to use a same-site HttpOnly cookie must be confirmed before selecting cookie settings.
- Supabase project auth configuration/signing algorithm and endpoint behavior must be verified in a test exchange. Never hardcode an assumed JWT signing algorithm.
- Session lifetime, multi-device session management UI, and account recovery policy require product approval.

## Current boundary

The branch Worker has been deployed to its workers.dev preview by the branch workflow. The V101 HTML change remains on `migration/d1-v101-prep`; it has not been published to the live Render website. No remote D1 migration was applied, no Supabase account or session was deleted/revoked by this work, and no media was transferred. The bridge will fail closed until `SUPABASE_URL`, `SUPABASE_ANON_KEY`, the exact allowed origin, and migration `0005_verified_owner_identity.sql` are present in the Worker/D1 environment. Full app data, media, payment and admin-action cutover remains incomplete.
