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


## Supabase identity bridge status — NOT IMPLEMENTED

The earlier description of a `POST /auth/bridge/supabase` prototype was inaccurate. A fresh inspection of `workers/auth/worker.js` on this branch confirms that **the route and server-side Supabase token verification function are absent**. Do not call or rely on that endpoint yet.

The Worker currently exposes a separate native-auth prototype:
- `POST /auth/register-admin` creates a password-based admin using the preserved owner UUID, claims the one-time bootstrap state, and seeds profile, artist, song, video, and picture rows.
- `POST /auth/login` authenticates that newly-created password account.
- `POST /auth/anonymous` creates a new anonymous UUID.

These routes are **not** a safe bridge for the existing Supabase account. In particular, do not run `/auth/register-admin` as a workaround: it creates new D1 identity/password state and attempts to seed content records. The owner-only Supabase bridge must first verify the existing access token with the configured Supabase Auth `/auth/v1/user` endpoint, allow only the exact pre-approved owner UUID, reject anonymous/unknown identities, and preserve existing IDs without reseeding or overwriting business records.

Read-only verification on 2026-11-01 confirmed that the selected Supabase Auth user exists, is non-anonymous, is not deleted or banned; the matching profile and artist rows exist; and the matching `platform_admins` row is active. The profile's `role` column is `artist`, so Worker authorization must rely on the verified active `platform_admins` record (or an equally trusted server-side mapping), not a client claim or the profile role.

Migration 0004 provides per-login session families and token rotation. That mechanism is separate from the missing Supabase exchange route. Secure browser persistence (preferably a same-site HttpOnly cookie), CSRF protection, bridge tests, and the final app hostname decision remain open. Keep Supabase live; do not deploy, apply remote D1 migrations, edit the live V101 HTML, or switch over yet.
