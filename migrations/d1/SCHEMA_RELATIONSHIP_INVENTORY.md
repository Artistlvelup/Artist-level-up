# V101 Supabase schema relationship inventory

Generated from Supabase verbose public-schema metadata. This is an audit record, not an executable migration.

- Public tables: 27
- Distinct foreign-key constraints: 32
- Relationships within public schema: 16
- Relationships to auth.users: 16

## Foreign keys

| Constraint | Source | Source column(s) | Target | Target column(s) |
|---|---|---|---|---|
| profiles_id_fkey | profiles | id | auth.users | id |
| songs_artist_id_fkey | songs | artist_id | artists | id |
| artist_videos_artist_id_fkey | artist_videos | artist_id | artists | id |
| promotions_artist_id_fkey | promotions | artist_id | artists | id |
| artists_user_id_fkey | artists | user_id | auth.users | id |
| upload_fee_payments_consumed_song_id_fkey | upload_fee_payments | consumed_song_id | songs | id |
| library_song_id_fkey | library | song_id | songs | id |
| picture_posts_sound_song_id_fkey | picture_posts | sound_song_id | songs | id |
| artist_videos_song_id_fkey | artist_videos | song_id | songs | id |
| library_user_id_fkey | library | user_id | auth.users | id |
| promotions_video_id_fkey | promotions | video_id | artist_videos | id |
| withdrawals_user_id_fkey | withdrawals | user_id | auth.users | id |
| marketplace_beats_producer_user_id_fkey | marketplace_beats | producer_user_id | auth.users | id |
| marketplace_orders_beat_id_fkey | marketplace_orders | beat_id | marketplace_beats | id |
| marketplace_orders_buyer_user_id_fkey | marketplace_orders | buyer_user_id | auth.users | id |
| picture_posts_user_id_fkey | picture_posts | user_id | auth.users | id |
| artist_wallets_artist_user_id_fkey | artist_wallets | artist_user_id | auth.users | id |
| artist_payouts_payout_account_id_fkey | artist_payouts | payout_account_id | artist_payout_accounts | id |
| artist_payout_accounts_artist_user_id_fkey | artist_payout_accounts | artist_user_id | auth.users | id |
| artist_payouts_artist_user_id_fkey | artist_payouts | artist_user_id | auth.users | id |
| upload_fee_payments_user_id_fkey | upload_fee_payments | user_id | auth.users | id |
| artist_pro_subscriptions_user_id_fkey | artist_pro_subscriptions | user_id | auth.users | id |
| streaming_distribution_requests_user_id_fkey | streaming_distribution_requests | user_id | auth.users | id |
| isrc_recordings_rights_owner_agreement_id_fkey | isrc_recordings | rights_owner_agreement_id | isrc_rights_owner_agreements | id |
| isrc_registry_submissions_recording_id_fkey | isrc_registry_submissions | recording_id | isrc_recordings | id |
| isrc_audit_log_recording_id_fkey | isrc_audit_log | recording_id | isrc_recordings | id |
| isrc_audit_log_actor_user_id_fkey | isrc_audit_log | actor_user_id | auth.users | id |
| royalty_ledger_entries_import_id_fkey | royalty_ledger_entries | import_id | royalty_statement_imports | id |
| royalty_statement_imports_imported_by_fkey | royalty_statement_imports | imported_by | auth.users | id |
| platform_royalty_commissions_import_id_fkey | platform_royalty_commissions | import_id | royalty_statement_imports | id |
| platform_royalty_commissions_ledger_entry_id_fkey | platform_royalty_commissions | ledger_entry_id | royalty_ledger_entries | id |
| royalty_ledger_entries_artist_user_id_fkey | royalty_ledger_entries | artist_user_id | auth.users | id |

## Migration handling

- The relationships above are distinct constraints. Supabase metadata may repeat a constraint under both the source and referenced table; duplicates have been removed here.
- Public-to-public relationships are verified from metadata, but are not yet installed in D1. SQLite cannot add a foreign key to an existing table with a simple ALTER TABLE; they require carefully rebuilding affected tables or including constraints in the original table definitions.
- References to `auth.users` require a deliberate replacement identity table and authentication implementation. Do not point them at an invented table or migrate Supabase password hashes without a supported password migration design.
- PostgreSQL CHECK expressions, indexes, triggers, and row-level security policies must be translated or reimplemented and tested before cutover.
- This inventory contains schema names and constraint expressions only; it contains no user row data or secrets.
- Do not apply remote migrations or cut over V101 until identity mapping, data export/import, authorization, storage, payment functions, and rollback are tested.