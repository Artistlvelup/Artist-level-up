# V101 Supabase schema relationship inventory

Generated from Supabase's verbose table metadata. This is an audit record, not an executable migration.

- Public tables: 27
- Foreign-key constraints: 48
- Relationships within public schema: 32
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
| songs_artist_id_fkey | songs | artist_id | artists | id |
| library_song_id_fkey | library | song_id | songs | id |
| picture_posts_sound_song_id_fkey | picture_posts | sound_song_id | songs | id |
| artist_videos_song_id_fkey | artist_videos | song_id | songs | id |
| library_song_id_fkey | library | song_id | songs | id |
| library_user_id_fkey | library | user_id | auth.users | id |
| promotions_artist_id_fkey | promotions | artist_id | artists | id |
| promotions_video_id_fkey | promotions | video_id | artist_videos | id |
| withdrawals_user_id_fkey | withdrawals | user_id | auth.users | id |
| promotions_video_id_fkey | promotions | video_id | artist_videos | id |
| artist_videos_artist_id_fkey | artist_videos | artist_id | artists | id |
| artist_videos_song_id_fkey | artist_videos | song_id | songs | id |
| marketplace_beats_producer_user_id_fkey | marketplace_beats | producer_user_id | auth.users | id |
| marketplace_orders_beat_id_fkey | marketplace_orders | beat_id | marketplace_beats | id |
| marketplace_orders_buyer_user_id_fkey | marketplace_orders | buyer_user_id | auth.users | id |
| marketplace_orders_beat_id_fkey | marketplace_orders | beat_id | marketplace_beats | id |
| picture_posts_user_id_fkey | picture_posts | user_id | auth.users | id |
| picture_posts_sound_song_id_fkey | picture_posts | sound_song_id | songs | id |
| artist_wallets_artist_user_id_fkey | artist_wallets | artist_user_id | auth.users | id |
| artist_payouts_payout_account_id_fkey | artist_payouts | payout_account_id | artist_payout_accounts | id |
| artist_payout_accounts_artist_user_id_fkey | artist_payout_accounts | artist_user_id | auth.users | id |
| artist_payouts_artist_user_id_fkey | artist_payouts | artist_user_id | auth.users | id |
| artist_payouts_payout_account_id_fkey | artist_payouts | payout_account_id | artist_payout_accounts | id |
| upload_fee_payments_consumed_song_id_fkey | upload_fee_payments | consumed_song_id | songs | id |
| upload_fee_payments_user_id_fkey | upload_fee_payments | user_id | auth.users | id |
| artist_pro_subscriptions_user_id_fkey | artist_pro_subscriptions | user_id | auth.users | id |
| streaming_distribution_requests_user_id_fkey | streaming_distribution_requests | user_id | auth.users | id |
| isrc_recordings_rights_owner_agreement_id_fkey | isrc_recordings | rights_owner_agreement_id | isrc_rights_owner_agreements | id |
| isrc_registry_submissions_recording_id_fkey | isrc_registry_submissions | recording_id | isrc_recordings | id |
| isrc_audit_log_recording_id_fkey | isrc_audit_log | recording_id | isrc_recordings | id |
| isrc_recordings_rights_owner_agreement_id_fkey | isrc_recordings | rights_owner_agreement_id | isrc_rights_owner_agreements | id |
| isrc_audit_log_recording_id_fkey | isrc_audit_log | recording_id | isrc_recordings | id |
| isrc_audit_log_actor_user_id_fkey | isrc_audit_log | actor_user_id | auth.users | id |
| isrc_registry_submissions_recording_id_fkey | isrc_registry_submissions | recording_id | isrc_recordings | id |
| royalty_ledger_entries_import_id_fkey | royalty_ledger_entries | import_id | royalty_statement_imports | id |
| royalty_statement_imports_imported_by_fkey | royalty_statement_imports | imported_by | auth.users | id |
| platform_royalty_commissions_import_id_fkey | platform_royalty_commissions | import_id | royalty_statement_imports | id |
| platform_royalty_commissions_ledger_entry_id_fkey | platform_royalty_commissions | ledger_entry_id | royalty_ledger_entries | id |
| royalty_ledger_entries_artist_user_id_fkey | royalty_ledger_entries | artist_user_id | auth.users | id |
| royalty_ledger_entries_import_id_fkey | royalty_ledger_entries | import_id | royalty_statement_imports | id |
| platform_royalty_commissions_ledger_entry_id_fkey | platform_royalty_commissions | ledger_entry_id | royalty_ledger_entries | id |
| platform_royalty_commissions_import_id_fkey | platform_royalty_commissions | import_id | royalty_statement_imports | id |

## Check constraints surfaced in column metadata

| Table | Column | Original PostgreSQL expression |
|---|---|---|
| profiles | role | `role = ANY (ARRAY['artist'::text, 'admin'::text, 'user'::text])` |
| artists | status | `status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])` |
| songs | status | `status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'published'::text, 'archived'::text, 'rejected'::text])` |
| promotions | budget | `budget >= 0::numeric` |
| promotions | status | `status = ANY (ARRAY['pending'::text, 'active'::text, 'completed'::text, 'cancelled'::text])` |
| promotions | target_type | `target_type = ANY (ARRAY['music'::text, 'video'::text])` |
| withdrawals | amount | `amount > 0::numeric` |
| withdrawals | status | `status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'paid'::text])` |
| artist_videos | status | `status = ANY (ARRAY['pending'::text, 'approved'::text, 'published'::text, 'rejected'::text])` |
| marketplace_beats | price_ngn | `price_ngn > 0::numeric` |
| marketplace_beats | default_license | `default_license = ANY (ARRAY['Basic'::text, 'Premium'::text, 'Exclusive'::text])` |
| marketplace_beats | status | `status = ANY (ARRAY['pending'::text, 'published'::text, 'hidden'::text, 'rejected'::text])` |
| marketplace_orders | license | `license = ANY (ARRAY['Basic'::text, 'Premium'::text, 'Exclusive'::text])` |
| marketplace_orders | amount_ngn | `amount_ngn > 0::numeric` |
| marketplace_orders | status | `status = ANY (ARRAY['pending_payment'::text, 'paid'::text, 'failed'::text, 'cancelled'::text, 'refunded'::text])` |
| marketplace_orders | platform_fee_percent | `platform_fee_percent >= 0::numeric AND platform_fee_percent <= 100::numeric` |
| marketplace_orders | platform_fee_ngn | `platform_fee_ngn IS NULL OR platform_fee_ngn >= 0::numeric` |
| marketplace_orders | producer_payout_ngn | `producer_payout_ngn IS NULL OR producer_payout_ngn >= 0::numeric` |
| picture_posts | status | `status = ANY (ARRAY['published'::text, 'hidden'::text])` |
| artist_wallets | wallet_currency | `wallet_currency = ANY (ARRAY['NGN'::text, 'USD'::text, 'EUR'::text, 'GBP'::text, 'CAD'::text, 'AUD'::text, 'ZAR'::text, 'GHS'::text, 'KES'::text])` |
| artist_payout_accounts | country_code | `country_code ~ '^[A-Z]{2}$'::text` |
| artist_payout_accounts | currency | `currency = ANY (ARRAY['NGN'::text, 'USD'::text, 'EUR'::text, 'GBP'::text, 'CAD'::text, 'AUD'::text, 'ZAR'::text, 'GHS'::text, 'KES'::text, 'UGX'::text, 'TZS'::text, 'RWF'::text, 'ZMW'::text, 'MWK'::text, 'XAF'::text, 'XOF'::text, 'SLL'::text, 'ETB'::text, 'EGP'::text, 'CZK'::text, 'DKK'::text, 'PLN'::text, 'SEK'::text])` |
| artist_payout_accounts | status | `status = ANY (ARRAY['pending'::text, 'enabled'::text, 'disabled'::text, 'restricted'::text])` |
| artist_payouts | currency | `currency = ANY (ARRAY['NGN'::text, 'USD'::text, 'EUR'::text, 'GBP'::text, 'CAD'::text, 'AUD'::text, 'ZAR'::text, 'GHS'::text, 'KES'::text])` |
| artist_payouts | amount_minor | `amount_minor > 0` |
| artist_payouts | status | `status = ANY (ARRAY['pending'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'cancelled'::text])` |
| upload_fee_payments | upload_type | `upload_type = ANY (ARRAY['music'::text, 'beat'::text])` |
| upload_fee_payments | amount_ngn | `amount_ngn = 5000` |
| upload_fee_payments | currency | `currency = ANY (ARRAY['NGN'::text, 'GHS'::text, 'ZAR'::text, 'KES'::text, 'GBP'::text, 'USD'::text, 'EUR'::text, 'CAD'::text])` |
| upload_fee_payments | provider | `provider = ANY (ARRAY['paystack'::text, 'flutterwave'::text])` |
| upload_fee_payments | status | `status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text])` |
| upload_fee_payments | amount_major | `amount_major IS NULL OR amount_major > 0::numeric` |
| artist_pro_subscriptions | plan | `plan = ANY (ARRAY['Monthly'::text, 'Yearly'::text])` |
| artist_pro_subscriptions | currency | `currency = 'NGN'::text` |
| artist_pro_subscriptions | status | `status = ANY (ARRAY['pending'::text, 'active'::text, 'expired'::text, 'failed'::text])` |
| streaming_distribution_requests | release_type | `release_type = ANY (ARRAY['Single'::text, 'EP'::text, 'Album'::text])` |
| streaming_distribution_requests | explicit_content | `explicit_content = ANY (ARRAY['No'::text, 'Yes'::text, 'Unknown'::text])` |
| streaming_distribution_requests | status | `status = ANY (ARRAY['draft'::text, 'submitted'::text, 'quoted'::text, 'payment_pending'::text, 'paid'::text, 'in_review'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])` |
| streaming_distribution_requests | quote_amount_minor | `quote_amount_minor IS NULL OR quote_amount_minor > 0` |
| streaming_distribution_requests | quote_currency | `quote_currency = ANY (ARRAY['NGN'::text, 'USD'::text, 'GBP'::text, 'EUR'::text, 'GHS'::text, 'ZAR'::text, 'KES'::text, 'CAD'::text])` |
| v101_bridge_config | id | `id = 1` |
| isrc_manager_settings | id | `id = 1` |
| isrc_manager_settings | appointment_status | `appointment_status = ANY (ARRAY['not_appointed'::text, 'pending'::text, 'approved'::text, 'suspended'::text])` |
| isrc_rights_owner_agreements | agreement_status | `agreement_status = ANY (ARRAY['pending'::text, 'active'::text, 'expired'::text, 'revoked'::text])` |
| isrc_recordings | first_publication_year | `first_publication_year >= 1900 AND first_publication_year <= 2200` |
| isrc_recordings | duration_seconds | `duration_seconds IS NULL OR duration_seconds > 0` |
| isrc_recordings | assignment_status | `assignment_status = ANY (ARRAY['draft'::text, 'needs_review'::text, 'assigned'::text, 'blocked'::text])` |
| isrc_recordings | registry_status | `registry_status = ANY (ARRAY['not_submitted'::text, 'pending'::text, 'submitted'::text, 'accepted'::text, 'rejected'::text])` |
| isrc_registry_submissions | submission_status | `submission_status = ANY (ARRAY['pending'::text, 'submitted'::text, 'accepted'::text, 'rejected'::text, 'failed'::text])` |
| royalty_statement_imports | currency | `currency ~ '^[A-Z]{3}$'::text` |
| royalty_statement_imports | status | `status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text])` |
| royalty_statement_imports | total_rows | `total_rows >= 0` |
| royalty_statement_imports | accepted_rows | `accepted_rows >= 0` |
| royalty_statement_imports | duplicate_rows | `duplicate_rows >= 0` |
| royalty_statement_imports | rejected_rows | `rejected_rows >= 0` |
| royalty_ledger_entries | currency | `currency ~ '^[A-Z]{3}$'::text` |
| royalty_ledger_entries | gross_amount_minor | `gross_amount_minor >= 0` |
| royalty_ledger_entries | net_amount_minor | `net_amount_minor >= 0` |
| royalty_ledger_entries | streams | `streams >= 0` |
| royalty_ledger_entries | status | `status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text])` |
| platform_royalty_commissions | reported_net_minor | `reported_net_minor >= 0` |
| platform_royalty_commissions | artist_share_minor | `artist_share_minor >= 0` |
| platform_royalty_commissions | commission_minor | `commission_minor >= 0` |

## Unique columns surfaced in column metadata

| Table | Column |
|---|---|
| artists | user_id |
| marketplace_orders | paystack_reference |
| upload_fee_payments | payment_reference |
| artist_pro_subscriptions | reference |
| streaming_distribution_requests | payment_reference |
| isrc_recordings | isrc_code |
| royalty_statement_imports | statement_key |
| platform_royalty_commissions | ledger_entry_id |

## Migration handling

- Public-to-public relationships are verified from metadata, but are not yet installed in D1. SQLite cannot add a foreign key to an existing table with a simple ALTER TABLE; they require carefully rebuilding affected tables or including constraints in the original table definitions.
- References to `auth.users` require a deliberate replacement identity table and authentication implementation. Do not point them at an invented table or migrate Supabase password hashes without a supported password migration design.
- PostgreSQL CHECK expressions must be translated and tested for SQLite compatibility before applying them.
- This inventory contains schema names and constraint expressions only; it contains no user row data or secrets.
- Do not apply remote migrations or cut over V101 until identity mapping, data export/import, authorization, storage, payment functions, and rollback are tested.