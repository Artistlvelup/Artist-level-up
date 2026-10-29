# V101 identity and authentication migration design

Status: design only; no production code or database changes.

## What the authoritative V101 browser app currently does

Inspection of `Artist-Level-Up-LAUNCH-MASTER.html` on branch `migration/d1-v101-prep` found:

- It creates a Supabase JS v2 client with browser session persistence and token refresh enabled.
- Its shared cloud bootstrap calls `auth.getSession()`.
- If a cached session exists, it validates it with `auth.getUser(access_token)`.
- If no valid session exists, it calls `auth.signInAnonymously()`.
- It stores the returned user UUID in `window.ALU_CLOUD.userId`.
- The inspected V101 file contains no calls to `auth.signUp()` or `auth.signInWithPassword()`.
- Upload flows reuse the Supabase access token to authorize Storage uploads.

This means the current V101 identity bootstrap is anonymous/guest identity, not a conventional email-and-password login flow. Do not invent password login or claim existing passwords can be migrated.

## Required D1 identity model (proposal)

Keep the existing Supabase user UUIDs as stable IDs so references in the 27 public tables can continue to refer to the same identity values.

Proposed replacement table responsibilities:

1. `app_users`: stable UUID primary key, created timestamp, anonymous flag, disabled/deleted state, and optional migration provenance. Do not store plaintext passwords.
2. `app_sessions`: session ID, user UUID, hashed opaque token, created/expiry/revocation timestamps. Store only a cryptographic hash of the bearer token, never the raw token.
3. Optional `app_user_metadata`: only non-secret user metadata needed by the app. Existing public `profiles` remains a separate profile/business table.

The exact schema and API are not approved or installed yet. Confirm required metadata and expiry behavior before writing the executable migration.

## Worker authentication behavior (proposal)

- A Cloudflare Worker issues cryptographically random opaque session tokens after creating or restoring an anonymous identity.
- The Worker stores a SHA-256 hash of each token in D1 and returns the raw token once to the browser over HTTPS.
- Every protected API request validates the token hash, session expiry, revocation state, and user state server-side.
- The browser stores the token using a deliberate secure-session strategy; do not put service credentials or signing secrets in HTML.
- Add rate limits and abuse controls to anonymous identity creation.
- Admin privileges must be checked server-side from trusted records. Never trust a client-supplied role or user ID.
- Use Cloudflare Worker secrets for cryptographic secrets and payment-provider credentials.

## Existing-user continuity

- Preserve Supabase UUIDs when importing identity references and the existing profile row.
- The current Supabase auth user list and auth metadata must be inventoried through an authorized export before identity rows are generated.
- Do not create placeholder identities for every UUID found in business tables without first reconciling those UUIDs against the actual auth user inventory.
- Existing Supabase access tokens cannot be reused as Worker sessions. Users will need a safe session re-issue/re-authentication step after cutover.
- Because V101 currently bootstraps anonymous identities, there is no evidence in the inspected HTML of password credentials to migrate.

## Cutover gates

Do not apply D1 remotely or modify the live V101 HTML until all of these are complete:

- Auth-user inventory and mapping are exported and reconciled.
- D1 schema includes verified public foreign keys and an explicit identity parent table.
- Worker session issue/validate/revoke endpoints are implemented and tested.
- RLS-equivalent authorization is implemented in the Worker for every data operation; browser code must not access D1 directly.
- Upload authorization and object ownership checks are implemented for R2.
- Payment callbacks and all privileged operations are server-verified.
- A rollback plan and test environment are ready.

## Known boundaries

The schema metadata shows 16 distinct foreign keys to `auth.users` and 16 public-to-public relationships. The relationship inventory is in `SCHEMA_RELATIONSHIP_INVENTORY.md`.

This document does not contain credentials, user row data, or any live-system changes.
