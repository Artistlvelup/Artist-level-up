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
- Public-schema triggers: 8 distinct trigger names (15 trigger event registrations).
- Public-schema routines: 17.
- Public-schema views: 0.

## Foreign-key and check-constraint impact
The 32 foreign keys include multiple dependencies on Supabase auth.users, including profiles, artists, wallets, payouts, payout accounts, subscriptions, library, picture_posts, withdrawals, upload_fee_payments, distribution requests, royalty tables, and marketplace orders. These cannot be recreated as references to auth.users in D1 without designing a replacement identity table and mapping existing UUIDs first.
Other important relationships include:
- songs -> artists; artist_videos -> artists and songs.
- picture_posts -> songs.
- promotions -> artists and artist_videos.
- ISRC audit/recordings/submissions/rights-owner agreements relationships.
- marketplace orders/beats, royalty ledger/imports/commissions.
- payout rows -> payout accounts.
The 65 checks enforce important business invariants, including allowed statuses, payout amounts/currencies, subscription plans and NGN prices, ISRC assignment/code/year/duration, marketplace license/price/status and fee percentages, promotion status/type/budget, royalty nonnegative amounts/statuses, distribution request states/types/currencies, and the fixed music upload fee amount (NGN 5,000). Translate each to SQLite-compatible CHECK constraints where appropriate and verify actual column types/precision before migration.

## RLS policy coverage
There are 60 policies, spread across 23 tables. The policy command/role inventory includes:
- Public/anonymous reads for songs, artist videos, picture posts, and marketplace beats.
- Authenticated insert/update/read policies for profiles, artists, songs, videos, pictures, promotions, library, wallets, payouts, subscriptions, withdrawals, marketplace, royalty, ISRC, and other account data.
- Admin-sensitive operations for platform admins and ISRC management.
The grouped catalog inventory is recorded by table/command/role in the audit work. Exact USING and WITH CHECK predicates still need a dedicated export and review; do not infer that a table-level allow-list is sufficient. Reimplement equivalent checks in Worker routes and test unauthorized cross-user access.

## Trigger behavior requiring explicit replacement
Observed triggers and their event coverage:
- artist_videos: v101_guard_artist_video_review_status (BEFORE INSERT/UPDATE).
- marketplace_beats: v101_guard_marketplace_beat_status (BEFORE INSERT/UPDATE).
- promotions: v101_guard_promotion_status (BEFORE INSERT/UPDATE).
- songs: v101_guard_song_review_status (BEFORE INSERT/UPDATE).
  These share private.guard_review_status_changes and protect moderation/review status transitions.
- songs: songs_require_verified_upload_fee (BEFORE INSERT), calls enforce_music_upload_fee.
- marketplace_orders: trg_marketplace_commission (BEFORE INSERT/UPDATE), calls calculate_marketplace_commission.
- isrc_recordings: isrc_assignment_guard (BEFORE INSERT/UPDATE), calls guard_isrc_assignment.
- isrc_recordings: isrc_recording_audit (AFTER INSERT/UPDATE), calls audit_isrc_recording_changes.
Implement equivalent validation and atomic writes in D1/Worker logic before allowing those operations.

## Routine inventory requiring review
The 17 public routines are:
- audit_isrc_recording_changes
- calculate_marketplace_commission
- enforce_music_upload_fee
- enforce_music_upload_fee_v101_backup_20261018
- guard_isrc_assignment
- is_platform_admin_v101
- owner_admin_pin_change
- owner_admin_pin_login
- owner_admin_pin_logout
- owner_admin_pin_session_valid
- owner_admin_pin_setup
- recover_solo_vibez_profile_v101
- reserve_artist_withdrawal
- review_royalty_statement_batch
- rls_auto_enable (event trigger)
- set_account_pin_v101
- verify_account_pin_v101
These include security/admin PIN/session logic, withdrawal reservation, royalty review, ISRC audit/assignment, upload-fee enforcement, and marketplace commission calculation. Their full definitions and dependencies must be inspected before porting. The backup-named function and event trigger should be assessed for active relevance rather than copied blindly.

## Important migration gaps
- migrations/d1/0001_initial_schema.sql creates the 27 base tables but does not yet reproduce the live FK and CHECK constraints comprehensively.
- It does not reproduce all 63 indexes.
- The initial D1 schema does not reproduce the 60 Supabase RLS policies. D1 has no Supabase RLS; equivalent ownership/admin authorization must be implemented and tested in Worker routes.
- The 8 live triggers and 17 routines are not recreated by the base D1 migration.
- migrations/d1/0002_identity_sessions.sql introduces a new identity/session model. It is not a migration of existing Supabase Auth users or sessions. A user/account mapping and secure sign-in transition plan is required.
- migrations/d1/0003_move_published_song_to_r2.sql updates one song row by ID/title, but does not import the song row or any other business data. It must run only after the matching song row is present in D1 and verified.

## Current Cloudflare D1 state
- User inspected the actual Cloudflare D1 dashboard for database artist_level_up_v101.
- Dashboard showed Number of Tables: 0, Total queries: 0, Rows read: 0, Rows written: 0.
- Therefore no D1 schema migration has been applied as of this audit.

## Safety / next steps
1. Do not apply migrations 0001-0003 yet.
2. Inspect exact RLS USING/WITH CHECK predicates, function definitions, and index definitions.
3. Design the replacement identity mapping before translating any FK that currently points to auth.users.
4. Build a reviewed D1 schema migration preserving relevant FK, unique, check and index behavior.
5. Map every RLS policy to explicit Worker authorization rules; test owner, admin, anonymous, and public access cases.
6. Port and test trigger/function behavior, especially payment, upload-fee, moderation/review, ISRC, royalty, payout, and account PIN flows.
7. Design and test data export/import and identity mapping. Preserve source Supabase until D1 data and V101 application behavior are verified.
8. Only then apply to D1 and verify table/constraint/index counts, imported row counts, and application smoke tests.

## Scope
All Supabase queries used for this audit were read-only catalog queries. No Supabase data or schema was changed. No Cloudflare D1 SQL was executed. The V101 website/main branch was not edited.
