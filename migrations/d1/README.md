# D1 migration preparation — V101

This branch is isolated from `main`; no live website or Supabase project was changed.

## Snapshot
- Supabase project: `wmtddmaxwulypvhjjntz`
- Public tables discovered: 27
- Rows reported by Supabase: 1 total (one row in `profiles`; zero in the other tables).
- Target D1 database: `artist_level_up_v101` (`80a7182b-e203-4103-a749-bb4b230aba86`).

## Important migration boundaries
- This initial SQLite-compatible schema is a structural starting point only. It does not migrate any row data, Supabase Auth users/passwords/sessions, Storage objects, Edge Functions, or payment-provider secrets.
- PostgreSQL-specific checks, triggers, policies and indexes need a deliberate SQLite/Worker implementation before cutover.
- Supabase `auth.users` references are intentionally not recreated as fake D1 auth tables. A new authentication design and account migration/re-registration path are required.
- D1 has no Row Level Security. Every read/write must be authorized in server-side Worker code. Treat wallet, payout, bank, withdrawal, admin and `v101_bridge_config` data as sensitive.
- Do not apply this migration to the remote D1 database or change the V101 app until the SQL is reviewed and the Worker/API layer is implemented and tested.

## Next implementation steps
1. Validate this SQL against SQLite/D1 and add omitted checks, indexes and triggers.
2. Implement authenticated Worker endpoints and role/ownership checks.
3. Migrate profile/account identity, table data and R2 objects using verified exports.
4. Reimplement payment and callback flows without exposing secrets.
5. Run end-to-end tests, then plan a controlled V101 cutover with rollback.

Foreign-key constraints are intentionally omitted from the first SQLite schema pass. The initial metadata export contained constraint names where column names were expected, so those generated clauses were removed rather than risking an incorrect schema. Relationships must be reintroduced from verified column-level metadata in a later reviewed migration before application cutover.


## Supabase identity bridge status — IMPLEMENTED ON MIGRATION BRANCH

The Worker now includes `POST /auth/bridge/supabase`. It accepts only a Supabase access token, verifies it server-to-server against the configured Supabase Auth `/auth/v1/user` endpoint, and allows only the exact pre-approved owner UUID. Browser-supplied user IDs, email, role, and admin claims are ignored. Anonymous and unknown identities are rejected.

Before creating a D1 session, the route requires the matching active `platform_admins` row and existing `profiles` row in D1. It creates only the `app_users` identity row when missing, preserves an existing active non-anonymous row, and does not seed or rewrite profile, artist, song, video, or picture content. The returned session uses the existing hashed-token/session-family mechanism.

Session validation now derives admin authorization from the active D1 `platform_admins` mapping rather than trusting the profile's `role` value. This matters because the verified existing Supabase profile role is `artist` while its platform-admin mapping is active.

Required Worker settings for the bridge:
- `SUPABASE_URL`: existing Supabase project URL (HTTPS).
- `SUPABASE_ANON_KEY`: existing Supabase anon/publishable key.
- `SESSION_PEPPER`: private Worker secret, at least 32 characters.
- `ALLOWED_ORIGINS`: exact allowed browser origins.
- `DB`: D1 binding containing the selected owner profile and active platform-admin mapping.

The V101 browser has not yet been wired to call the bridge. This is bearer-token prototype behavior; secure browser persistence (preferably same-site HttpOnly cookies), CSRF protections, deployment settings, and end-to-end testing on the final hostname remain open. Keep Supabase live. Do not deploy, apply remote D1 migrations, edit the live V101 HTML, or switch over until those remaining steps are reviewed and explicitly approved.

## Current owner-session bridge status

The Worker source on this branch **does include** `POST /auth/bridge/supabase`. It accepts only a current Supabase access token, verifies it server-to-server against the configured Supabase Auth `/auth/v1/user` endpoint, allows only the exact previously verified owner UUID, and requires the matching active `platform_admins` mapping plus the imported owner profile in D1. It then issues a hashed-token Cloudflare session. Browser-supplied user IDs, email addresses, roles, and admin flags are not trusted.

The V101 migration HTML now requests this verification before opening the owner admin view. The returned Cloudflare bearer token is kept in memory only and revoked when the owner logs out. The old browser PIN and public `openOwnerAdmin()` shortcut no longer grant admin access. This is a migration-branch change, not a live-site cutover.

Required Worker configuration for this bridge:
- `SUPABASE_URL`: existing Supabase project URL (Variable).
- `SUPABASE_ANON_KEY`: existing Supabase publishable/anon key (Secret).
- `SESSION_PEPPER`: private Worker secret, at least 32 characters.
- `ALLOWED_ORIGINS`: exact browser origins that use the migration HTML.
- `DB`: D1 binding with the verified owner profile and active admin mapping.

The verified identity SQL is local migration `0006_verified_owner_identity.sql`. It has **not** been applied to remote D1. The bridge will correctly fail closed until the required environment values are configured and that migration is separately reviewed and applied with explicit approval.

The Worker deploy workflow runs automatically for pushes to this migration branch and deploys the Worker only; it does not apply D1 migrations or publish the V101 website. The D1 workflow validates migrations and tests locally only. Keep the live V101 website and existing Supabase account unchanged until end-to-end tests pass and the owner explicitly approves cutover.
