# V101 legacy identity continuity plan — 2026-11-02

## Why this is a cutover blocker
The current V101 frontend still boots Supabase sessions and stores profile/artist state locally before best-effort cloud sync. The Cloudflare D1 database was inspected as having zero tables. Therefore there is currently no verified mapping from existing Supabase user IDs to native D1 user IDs.

A new email-verification registration route must not be enabled as a replacement for existing account access until this mapping is resolved. Email equality alone is not proof that two records belong to the same person if legacy emails are unverified, changed, shared, or duplicated.

## Required reconciliation sources
Before production cutover, obtain a controlled, read-only inventory of:
- Supabase Auth user IDs, normalized email, email verification status, created timestamp, and account status.
- Existing profile IDs and profile email/display name.
- Existing artist rows and their user IDs.
- Any known duplicate, deleted, banned, suspended, or admin identities.

Do not export passwords, password hashes, access tokens, refresh tokens, or PINs. Do not export or copy media objects. Keep media URLs unchanged.

## Mapping rules
1. Preserve the legacy Supabase user ID as an immutable legacy_user_id attribute in a restricted migration mapping, rather than assuming the new D1 ID can be identical.
2. Map only records whose ownership and email identity can be verified from trusted Auth metadata.
3. If a legacy email is verified and uniquely matches a single active legacy Auth user, prepare a one-to-one mapping candidate. Do not activate it until the user/session transition is designed and tested.
4. If email is unverified, duplicated, missing, changed, or ambiguous, mark it for explicit account recovery; never auto-merge.
5. Preserve role and moderation status from trusted records. Never infer admin status from client profile fields.
6. Preserve existing profile and artist IDs as legacy references where required, while assigning one canonical D1 user_id.
7. Enforce uniqueness for both (legacy_provider, legacy_user_id) and canonical D1 user mapping. Reject conflicting mappings.
8. Do not let public registration claim an email already present in the migration inventory. Return a neutral response and route the account through the migration/recovery process.

## Session continuity
Supabase sessions cannot simply be copied into D1 sessions. Do not accept a client-supplied legacy user ID as proof of identity. A safe transition needs either:
- a short, controlled overlap where a server-side verifier validates a live legacy session against the trusted Supabase Auth service, then issues a D1 session and records a one-time mapping; or
- an email re-verification/recovery process for legacy accounts, with explicit handling for accounts whose email is no longer accessible.

The first option requires a server-side Supabase verification credential and an approved, narrowly scoped bridge. The second requires a user-facing recovery journey and may not preserve seamless access. Neither has been approved or deployed.

## Pre-cutover checks
- Reconcile counts: Auth users, profiles, artists, duplicate emails, unverified emails, disabled users, and admin users.
- Every eligible legacy user maps to exactly one D1 user; no D1 user maps to multiple legacy identities.
- Existing artist/profile relationships remain intact.
- Existing user can sign in and see their existing profile and content after transition.
- Ambiguous identities are blocked from automatic migration and have a documented recovery path.
- No media bytes are copied, deleted, or rewritten.
- Rollback procedure is tested and does not invalidate the still-live Supabase session path prematurely.

## Current decision
Design only. No legacy user inventory was exported, no identity mapping table was created or populated, no user data was changed, and no production service was switched. The production cutover remains blocked until the identity source can be safely reconciled and the transition is explicitly approved.
