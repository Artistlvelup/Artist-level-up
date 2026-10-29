-- Artist Level Up V101: initial Cloudflare D1 schema
-- Generated from live Supabase public table metadata on 2026-10-29.
-- UUIDs/timestamps/JSON/arrays are stored as TEXT; booleans as INTEGER.
-- Supabase auth.users foreign keys are intentionally omitted: authentication must be migrated separately.
-- Access control must be enforced in authenticated Worker endpoints; D1 has no Supabase RLS.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "profiles" (
  "id" TEXT NOT NULL,
  "display_name" TEXT,
  "avatar_url" TEXT,
  "role" TEXT NOT NULL DEFAULT 'artist',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "artists" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL UNIQUE,
  "artist_name" TEXT NOT NULL,
  "bio" TEXT,
  "genre" TEXT,
  "country" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suspended" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("artist_id") REFERENCES "artists" ("id"),
  FOREIGN KEY ("artist_id") REFERENCES "artists" ("id"),
  FOREIGN KEY ("artist_id") REFERENCES "artists" ("id")
);

CREATE TABLE IF NOT EXISTS "songs" (
  "id" TEXT NOT NULL,
  "artist_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "genre" TEXT,
  "audio_url" TEXT,
  "cover_url" TEXT,
  "duration_seconds" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("consumed_song_id") REFERENCES "songs" ("id"),
  FOREIGN KEY ("artist_id") REFERENCES "artists" ("id"),
  FOREIGN KEY ("song_id") REFERENCES "songs" ("id"),
  FOREIGN KEY ("sound_song_id") REFERENCES "songs" ("id"),
  FOREIGN KEY ("song_id") REFERENCES "songs" ("id")
);

CREATE TABLE IF NOT EXISTS "library" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "song_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("song_id") REFERENCES "songs" ("id")
);

CREATE TABLE IF NOT EXISTS "promotions" (
  "id" TEXT NOT NULL,
  "artist_id" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "budget" REAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "starts_at" TEXT,
  "ends_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "target_type" TEXT NOT NULL DEFAULT 'music',
  "video_id" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("artist_id") REFERENCES "artists" ("id"),
  FOREIGN KEY ("video_id") REFERENCES "artist_videos" ("id")
);

CREATE TABLE IF NOT EXISTS "withdrawals" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "amount" REAL NOT NULL,
  "bank_name" TEXT,
  "account_name" TEXT,
  "account_number" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "artist_videos" (
  "id" TEXT NOT NULL,
  "artist_id" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "video_url" TEXT NOT NULL,
  "thumbnail_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "tiktok_url" TEXT,
  "instagram_url" TEXT,
  "facebook_url" TEXT,
  "youtube_url" TEXT,
  "views" INTEGER NOT NULL DEFAULT 0,
  "likes" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "song_id" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("video_id") REFERENCES "artist_videos" ("id"),
  FOREIGN KEY ("artist_id") REFERENCES "artists" ("id"),
  FOREIGN KEY ("song_id") REFERENCES "songs" ("id")
);

CREATE TABLE IF NOT EXISTS "marketplace_beats" (
  "id" TEXT NOT NULL,
  "producer_user_id" TEXT,
  "title" TEXT NOT NULL,
  "producer_name" TEXT NOT NULL,
  "genre" TEXT,
  "mood" TEXT,
  "bpm" INTEGER,
  "price_ngn" REAL NOT NULL,
  "default_license" TEXT NOT NULL DEFAULT 'Basic',
  "audio_preview_url" TEXT,
  "delivery_path" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("beat_id") REFERENCES "marketplace_beats" ("id")
);

CREATE TABLE IF NOT EXISTS "marketplace_orders" (
  "id" TEXT NOT NULL,
  "buyer_user_id" TEXT,
  "beat_id" TEXT,
  "beat_title" TEXT NOT NULL,
  "producer_name" TEXT NOT NULL,
  "license" TEXT NOT NULL,
  "amount_ngn" REAL NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "status" TEXT NOT NULL DEFAULT 'pending_payment',
  "paystack_reference" TEXT UNIQUE,
  "paystack_access_code" TEXT,
  "paid_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "customer_email" TEXT,
  "receipt_email_sent_at" TEXT,
  "receipt_email_id" TEXT,
  "platform_fee_percent" REAL NOT NULL DEFAULT 10.00,
  "platform_fee_ngn" REAL,
  "producer_payout_ngn" REAL,
  "payment_provider" TEXT,
  "payment_reference" TEXT,
  "buyer_country_code" TEXT,
  "amount_minor" INTEGER,
  "amount_currency" TEXT,
  "platform_fee_minor" INTEGER,
  "producer_payout_minor" INTEGER,
  "producer_payout_currency" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("beat_id") REFERENCES "marketplace_beats" ("id")
);

CREATE TABLE IF NOT EXISTS "picture_posts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "image_url" TEXT NOT NULL,
  "caption" TEXT,
  "status" TEXT NOT NULL DEFAULT 'published',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sound_song_id" TEXT,
  "sound_audio_url" TEXT,
  "sound_title" TEXT,
  "artist_name" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("sound_song_id") REFERENCES "songs" ("id")
);

CREATE TABLE IF NOT EXISTS "artist_wallets" (
  "artist_user_id" TEXT NOT NULL,
  "wallet_currency" TEXT NOT NULL DEFAULT 'USD',
  "available_minor" INTEGER NOT NULL DEFAULT 0,
  "pending_minor" INTEGER NOT NULL DEFAULT 0,
  "lifetime_earned_minor" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("artist_user_id")
);

CREATE TABLE IF NOT EXISTS "artist_payout_accounts" (
  "id" TEXT NOT NULL,
  "artist_user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'paystack',
  "country_code" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "provider_account_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "account_holder_name" TEXT,
  "bank_code" TEXT,
  "bank_name" TEXT,
  "account_number" TEXT,
  "provider_beneficiary_id" TEXT,
  "paystack_subaccount_code" TEXT,
  "payout_country_code" TEXT,
  "payout_currency" TEXT,
  "payout_method" TEXT,
  "routing_number" TEXT,
  "swift_code" TEXT,
  "iban" TEXT,
  "branch_code" TEXT,
  "flutterwave_subaccount_id" TEXT,
  "flutterwave_payout_account_id" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("payout_account_id") REFERENCES "artist_payout_accounts" ("id")
);

CREATE TABLE IF NOT EXISTS "artist_payouts" (
  "id" TEXT NOT NULL,
  "artist_user_id" TEXT NOT NULL,
  "payout_account_id" TEXT,
  "currency" TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "provider" TEXT NOT NULL DEFAULT 'stripe_connect',
  "provider_payout_id" TEXT,
  "failure_reason" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("payout_account_id") REFERENCES "artist_payout_accounts" ("id")
);

CREATE TABLE IF NOT EXISTS "platform_admins" (
  "user_id" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id")
);

CREATE TABLE IF NOT EXISTS "upload_fee_payments" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "upload_type" TEXT NOT NULL,
  "amount_ngn" INTEGER NOT NULL DEFAULT 5000,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "provider" TEXT NOT NULL DEFAULT 'paystack',
  "payment_reference" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "paid_at" TEXT,
  "consumed_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "amount_major" REAL,
  "country_code" TEXT,
  "consumed_song_id" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("consumed_song_id") REFERENCES "songs" ("id")
);

CREATE TABLE IF NOT EXISTS "platform_settings" (
  "setting_key" TEXT NOT NULL,
  "setting_value" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("setting_key")
);

CREATE TABLE IF NOT EXISTS "artist_pro_subscriptions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "plan" TEXT NOT NULL,
  "amount_ngn" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "reference" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "starts_at" TEXT,
  "expires_at" TEXT,
  "paid_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "streaming_distribution_requests" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "artist_name" TEXT NOT NULL,
  "release_title" TEXT NOT NULL,
  "release_type" TEXT NOT NULL,
  "genre" TEXT NOT NULL DEFAULT 'Afrobeats',
  "preferred_release_date" TEXT,
  "explicit_content" TEXT NOT NULL DEFAULT 'No',
  "notes" TEXT NOT NULL DEFAULT '',
  "platforms" TEXT NOT NULL,
  "audio_files" TEXT NOT NULL,
  "artwork_path" TEXT,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "quote_amount_minor" INTEGER,
  "quote_currency" TEXT NOT NULL DEFAULT 'NGN',
  "admin_note" TEXT NOT NULL DEFAULT '',
  "payment_reference" TEXT UNIQUE,
  "paid_at" TEXT,
  "submitted_at" TEXT,
  "reviewed_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contact_email" TEXT,
  "portal_transfer_status" TEXT NOT NULL DEFAULT 'pending',
  "portal_transfer_checked_at" TEXT,
  "upc" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "v101_bridge_config" (
  "id" INTEGER NOT NULL,
  "secret" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "isrc_manager_settings" (
  "id" INTEGER NOT NULL,
  "appointment_status" TEXT NOT NULL DEFAULT 'not_appointed',
  "manager_registrant_code" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "isrc_rights_owner_agreements" (
  "id" TEXT NOT NULL,
  "rights_owner_name" TEXT NOT NULL,
  "rights_owner_email" TEXT,
  "agreement_reference" TEXT NOT NULL,
  "agreement_date" TEXT NOT NULL,
  "valid_until" TEXT,
  "agreement_status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("rights_owner_agreement_id") REFERENCES "isrc_rights_owner_agreements" ("id")
);

CREATE TABLE IF NOT EXISTS "isrc_recordings" (
  "id" TEXT NOT NULL,
  "rights_owner_agreement_id" TEXT NOT NULL,
  "rights_owner_name" TEXT NOT NULL,
  "artist_name" TEXT NOT NULL,
  "recording_title" TEXT NOT NULL,
  "version_title" TEXT,
  "first_publication_year" INTEGER,
  "duration_seconds" INTEGER,
  "isrc_code" TEXT UNIQUE,
  "assignment_status" TEXT NOT NULL DEFAULT 'draft',
  "previous_isrc_checked" INTEGER NOT NULL DEFAULT 0,
  "owner_notified_at" TEXT,
  "registry_status" TEXT NOT NULL DEFAULT 'not_submitted',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("recording_id") REFERENCES "isrc_recordings" ("id"),
  FOREIGN KEY ("recording_id") REFERENCES "isrc_recordings" ("id"),
  FOREIGN KEY ("rights_owner_agreement_id") REFERENCES "isrc_rights_owner_agreements" ("id")
);

CREATE TABLE IF NOT EXISTS "isrc_audit_log" (
  "id" TEXT NOT NULL,
  "recording_id" TEXT,
  "action" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("recording_id") REFERENCES "isrc_recordings" ("id")
);

CREATE TABLE IF NOT EXISTS "isrc_registry_submissions" (
  "id" TEXT NOT NULL,
  "recording_id" TEXT NOT NULL,
  "registry_name" TEXT NOT NULL,
  "submission_status" TEXT NOT NULL DEFAULT 'pending',
  "submitted_at" TEXT,
  "response_reference" TEXT,
  "response_notes" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("recording_id") REFERENCES "isrc_recordings" ("id")
);

CREATE TABLE IF NOT EXISTS "royalty_statement_imports" (
  "id" TEXT NOT NULL,
  "statement_key" TEXT NOT NULL UNIQUE,
  "provider" TEXT NOT NULL,
  "statement_filename" TEXT,
  "period_start" TEXT NOT NULL,
  "period_end" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "imported_by" TEXT NOT NULL,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "accepted_rows" INTEGER NOT NULL DEFAULT 0,
  "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
  "rejected_rows" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("import_id") REFERENCES "royalty_statement_imports" ("id"),
  FOREIGN KEY ("import_id") REFERENCES "royalty_statement_imports" ("id")
);

CREATE TABLE IF NOT EXISTS "royalty_ledger_entries" (
  "id" TEXT NOT NULL,
  "import_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "source_line_id" TEXT NOT NULL,
  "artist_user_id" TEXT NOT NULL,
  "artist_email" TEXT,
  "release_title" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "territory" TEXT NOT NULL DEFAULT 'Worldwide',
  "period_start" TEXT NOT NULL,
  "period_end" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "gross_amount_minor" INTEGER NOT NULL DEFAULT 0,
  "net_amount_minor" INTEGER NOT NULL,
  "streams" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "artist_share_minor" INTEGER,
  "platform_commission_minor" INTEGER,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("ledger_entry_id") REFERENCES "royalty_ledger_entries" ("id"),
  FOREIGN KEY ("import_id") REFERENCES "royalty_statement_imports" ("id")
);

CREATE TABLE IF NOT EXISTS "platform_royalty_commissions" (
  "id" TEXT NOT NULL,
  "import_id" TEXT NOT NULL,
  "ledger_entry_id" TEXT NOT NULL UNIQUE,
  "artist_user_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "reported_net_minor" INTEGER NOT NULL,
  "artist_share_minor" INTEGER NOT NULL,
  "commission_minor" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("ledger_entry_id") REFERENCES "royalty_ledger_entries" ("id"),
  FOREIGN KEY ("import_id") REFERENCES "royalty_statement_imports" ("id")
);
