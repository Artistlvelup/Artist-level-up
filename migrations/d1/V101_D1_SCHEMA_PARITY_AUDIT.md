# V101 D1 Schema Parity Audit

Date: 2026-10-30

## Scope

Read-only comparison between the live Supabase `public` schema and
`migrations/d1/0001_initial_schema.sql` on branch
`migration/d1-v101-prep`.

No live database was modified. No migration was applied to Cloudflare D1.

## Results

- Live Supabase public tables: **27**
- Tables declared in D1 migration 0001: **27**
- Table-name differences: **0**
- Column-name differences across those tables: **0**
- Column-count differences: **0**

The 27 table names and every table's column names match between the
live Supabase metadata and migration 0001.

## Important limitations

This is a name/count parity check, not a complete semantic schema validation.
It does **not** establish parity for:

- column types, nullability, defaults, or generated values;
- CHECK constraints, UNIQUE constraints, indexes, or foreign keys;
- triggers, functions, views, or RLS policies;
- Supabase Auth users and sessions;
- row/data completeness in D1.

Migration 0001 intentionally omits Supabase Auth foreign keys. D1 access
control must be implemented in the Worker; it does not inherit Supabase RLS.

## Safety status

- Main V101 branch and live website: untouched.
- Live Supabase project: untouched and must remain active.
- Cloudflare R2 objects: untouched.
- Cloudflare D1: not verified or changed by this audit.
- No production cutover is authorized by this audit.

## Next required checks before applying D1 migrations

1. Compare types, nullability, defaults, constraints, indexes, and foreign-key
   relationships against live Supabase metadata.
2. Confirm the existing D1 database is still empty or inspect its current
   migration state before applying anything.
3. Prepare and validate a deliberate data export/import, including user identity
   mapping. Do not assume Supabase Auth user IDs can be recreated as passwords.
4. Only then apply migrations to D1 and verify the resulting schema and data.
