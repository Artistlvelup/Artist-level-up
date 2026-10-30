# V101 D1 Semantic Parity Audit

Date: 2026-10-30
Branch: migration/d1-v101-prep

## Confirmed basic structure
- Live Supabase public tables: 27.
- D1 migration 0001 table declarations: 27.
- Table-name differences: 0.
- Column-name differences: 0.
- Column-count differences: 0.

This confirms names and counts only. It does not establish semantic or security parity.

## Live Supabase database objects found (read-only catalog queries)
- Primary-key constraints: 27.
- Foreign-key constraints: 32.
- Check constraints: 65.
- Unique constraints: 11.
- Indexes reported by pg_indexes: 63.
- Public-schema RLS policies: 60.
- Public-schema triggers: 8 distinct trigger names.
- Public-schema routines: 17.
- Public-schema views: 0.

## Important migration gaps
- migrations/d1/0001_initial_schema.sql creates the 27 base tables and primary keys, and includes some unique declarations, but does not recreate the live foreign keys or check constraints.
- The initial D1 schema does not reproduce the 60 Supabase RLS policies. D1 has no Supabase RLS; equivalent ownership/admin authorization must be implemented and tested in Worker routes before cutover.
- The 8 live triggers and 17 routines are not recreated by the base D1 migration. Their business rules must be mapped to D1 constraints/transactions/Worker logic and tested. Do not assume they can simply be omitted.
- migrations/d1/0002_identity_sessions.sql introduces a new identity/session model. It is not a migration of existing Supabase Auth users or sessions. A user/account mapping and secure sign-in transition plan is required.
- migrations/d1/0003_move_published_song_to_r2.sql updates one song row by ID/title, but it does not import the song row or any other business data. It must run only after the matching song row is present in D1 and verified.

## Current Cloudflare D1 state
- User inspected the actual Cloudflare D1 dashboard for database artist_level_up_v101.
- Dashboard showed Number of Tables: 0, Total queries: 0, Rows read: 0, Rows written: 0.
- Therefore no D1 schema migration has been applied as of this audit.

## Safety / next steps
1. Do not apply migrations 0001-0003 yet.
2. Build a reviewed D1 schema migration that preserves relevant FK, unique, check and index behavior, adapting references to Supabase auth.users only after the identity mapping is designed.
3. Map every RLS policy to explicit Worker authorization rules; verify owner, admin, anonymous, and public access cases.
4. Map all trigger/function behavior, including payment, upload-fee, moderation/review, ISRC, royalty, payout, and account PIN flows.
5. Design and test data export/import and identity mapping. Preserve source Supabase until D1 data and V101 application behavior are verified.
6. Only then apply to D1 and verify table/constraint/index counts, imported row counts, and application smoke tests.

## Scope
All Supabase queries used for this audit were read-only catalog queries. No Supabase data or schema was changed. No Cloudflare D1 SQL was executed. The V101 website/main branch was not edited.
