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


## Supabase identity bridge prototype

The Worker now includes `POST /auth/bridge/supabase` on this branch. It accepts the current V101 Supabase access token, validates it against the configured Supabase Auth `/auth/v1/user` endpoint, and uses the returned UUID as the D1 `app_users.user_id`. It never trusts a browser-supplied user ID or an unverified JWT decode.

Worker variables required for bridge tests/deployment:
- `SUPABASE_URL`: existing Supabase project URL (HTTPS).
- `SUPABASE_ANON_KEY`: existing Supabase anon/publishable key.
- `SESSION_PEPPER`: existing Worker secret; keep it private.
- `ALLOWED_ORIGINS`: exact production web origin(s).
- `DB`: D1 binding.

This is a migration-branch prototype only. It returns an opaque 30-day bearer session; it is **not yet the final rotating-refresh/HttpOnly-cookie implementation**, and the V101 browser has not been wired to call it. Do not deploy it or disable Supabase yet. The bridge endpoint has automated unit tests for valid identity preservation, invalid tokens, and disabled D1 users; CI validation is pending.
