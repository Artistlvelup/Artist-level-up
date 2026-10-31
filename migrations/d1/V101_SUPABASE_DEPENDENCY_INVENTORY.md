# V101 Supabase Dependency Inventory

Status: source-code audit of `Artist-Level-Up-LAUNCH-MASTER.html` on the isolated migration branch. This is a dependency inventory, not a completed replacement or authorization to cut over.

## Live account cleanup and migration scope (2026-10-31)

The live Supabase Auth inventory was checked and cleaned before migration planning:

- 294 anonymous Auth accounts were deleted.
- Their 150 linked profile rows and 11 linked artist rows were deleted.
- Two confirmed (non-anonymous) Auth accounts remain.
- One remaining account is the active platform admin and the main V101 owner account. It has 1 profile, 1 artist record, 8 artist videos, 3 picture posts, 1 song, 1 artist-pro subscription, 1 streaming-distribution request, and 3 upload-fee payment records.
- The other confirmed account has an artist profile and artist record but no videos, picture posts, songs, subscriptions, distribution requests, upload-fee payments, or withdrawals. It is excluded from the Cloudflare migration scope; it has not been deleted from Supabase.
- Two orphaned platform-admin rows left by deleted anonymous accounts were removed. The one active admin row remains.
- Post-cleanup verification: 2 Auth users, 2 profiles, 2 artist records, 0 anonymous users, 1 active admin row.
- No user records have been imported into D1. D1 remains unmodified by this cleanup.
- The 8 videos, 3 pictures and 1 song are the main account's real content. Previously verified R2 media objects must be reused, not uploaded again.

Migration rule: import only the active admin/main account and its required linked records. Do not import anonymous identities, the empty secondary confirmed account, or orphaned references. Preserve original stable user ID for the main account where the new auth design supports it. Do not export or recreate passwords from Supabase Auth; design a secure first-login credential/session migration.

## Confirmed application dependencies

1. **Supabase Auth**
   - The app creates a Supabase browser client using `ALU_SUPABASE_URL` and `ALU_SUPABASE_PUBLISHABLE_KEY`.
   - It calls `auth.getSession()`, validates cached tokens with `auth.getUser(access_token)`, calls `auth.signInAnonymously()` when no valid session exists, and calls `auth.signOut()`.
   - The app reads the authenticated Supabase user ID and uses it as the identity for artist records.
   - The D1 Worker prototype currently supports only anonymous identity/session creation, session validation and logout. It is not yet a drop-in replacement: it does not yet implement the full Supabase client API or preserve/import existing Supabase user IDs.

2. **Supabase Postgres / PostgREST**
   - The app uses Supabase client table operations, including artist/profile and marketplace data.
   - Video publishing also sends direct REST requests to `/rest/v1/artist_videos` for insert, patch, list, update and delete operations.
   - These operations must be moved behind authenticated Worker endpoints or a compatible data-access layer. The browser must not receive a privileged database credential.

3. **Supabase Storage**
   - The configured bucket is `music`.
   - Audio upload uses `storage.from(bucket).upload(...)` and `getPublicUrl(...)`.
   - Audio listing and deletion also use the Supabase Storage client.
   - Video upload uses the Supabase resumable/TUS storage endpoint with a Supabase access token; video objects are also deleted through Supabase Storage.
   - The existing R2 bucket `artist-level-up-videos` does not by itself migrate the existing `music` bucket, its objects, access rules, or public URLs. Audio and video object migration and URL replacement are separate work items.

4. **Supabase Edge Functions / Paystack**
   - The marketplace checkout calls the Edge Function named `marketplace-paystack-checkout`.
   - Its request includes `beat_id`, `license`, `email`, and `callback_url`; the app expects an `authorization_url` and redirects the customer to Paystack.
   - A replacement must verify Paystack callbacks/webhooks, enforce server-side price and ownership rules, and provide idempotency before payment cutover. Do not move payment secrets into browser code.

## Cutover blockers

- No app cutover: the V101 HTML still initializes Supabase and directly calls its Auth, Postgres REST, Storage and Edge Function services.
- The main account's stable user-ID mapping and secure first-login/session transition are not yet implemented or tested in the Worker.
- The current D1 schema migration is still a first-pass SQLite-compatible schema. Public-table foreign keys, PostgreSQL checks, triggers, indexes and RLS policy equivalents still require a reviewed migration plan.
- No confirmed export/import of the existing `music` bucket objects or their metadata.
- The Paystack Edge Function and any other privileged functions must be inventoried and replaced or deliberately retained behind a secure service boundary.
- Supabase must remain active for rollback until data, auth, storage, payments and production traffic have all been verified.

## Safe next implementation order

1. Finish a complete source audit of all Supabase table names, Storage paths, and Edge Function names.
2. Define a secure Worker API and browser adapter so V101 no longer needs direct PostgREST or privileged operations.
3. Implement and test identity continuity for the one main active-admin account; create new Cloudflare identities only for future signups.
4. Prepare a selective data export/import for only the main account and its required linked records. Reuse the already verified R2 media objects.
5. Rebuild and test payment/privileged functions with webhook verification and idempotency.
6. Only after those checks, plan a staged cutover with rollback. Do not apply remote D1 migrations or change the live V101 website until the schema and API tests are reviewed.

## Cloudflare-native rebuild decision and first implementation (2026-10-31)

The owner confirmed that the platform has only one intended existing account and authorized a fresh Cloudflare-native rebuild rather than migrating the old Supabase login.

- A byte-for-byte V101 source snapshot was saved on this isolated branch as `V101-BACKUP-BEFORE-CLOUDFLARE-REBUILD-2026-10-31.html`, sourced from the current `main` V101 HTML. The live `main` branch remains unchanged.
- Migration `0005_cloudflare_native_auth.sql` adds email/password-hash fields to `app_users`, a one-time first-admin claim row, and login throttling storage.
- The Worker now has a one-time first-admin registration endpoint (`POST /auth/register-admin`) gated by a server-side `BOOTSTRAP_SECRET`, and email/password login (`POST /auth/login`). Passwords use PBKDF2-SHA-256 with per-account random salt; plaintext passwords are never stored. Login sessions use the existing opaque-token/session-family design.
- The Supabase auth bridge was removed from the Worker. The native-auth tests cover first-admin creation, one-time setup protection, successful login, and invalid-password rejection.
- GitHub Actions run `41196708992` completed successfully on 2026-10-31, validating all five D1 migrations and the Worker test suite.
- This is backend preparation only: the Worker is not deployed, the remote D1 migrations are not applied, and V101 HTML has not yet been switched to the new auth. The current V101 app still contains Supabase data, storage, and edge-function calls that must be replaced before a full cutover.
- Supabase remains active and untouched for rollback. The R2 media objects already verified by the owner are to be reused, not re-uploaded.

Next: finish the Cloudflare Worker deployment configuration and the V101-to-Worker data/storage adapter, then test the full V101 flows before any live cutover.


## Owner content verification and bootstrap seed (2026-10-31)

A fresh read-only query of the confirmed main owner account was used to prepare the first-admin seed. The account's stable user UUID and artist UUID are preserved, while the owner will choose a new email/password during Cloudflare setup.

- Profile: `Solo_vibez` (owner identity preserved; no old password or Supabase auth session is copied).
- Artist record: preserved under its existing artist UUID.
- Song: 1 record, `Otunba Cash Money Angelina`; its audio URL points to the already verified R2 MP3.
- Videos: 8 records. Two already point to the verified R2 video objects. **Six video files are still on Supabase Storage** and their existing public URLs are retained temporarily so their records are not lost. These six objects must be copied to R2 and their URLs updated before Supabase Storage can be shut down.
- Picture posts: 3 records; all three point to the already verified R2 picture objects.
- The first-admin Worker batch now seeds the owner profile, artist, song, all 8 video records and all 3 picture records alongside the new password account and first session. It preserves the stable owner UUID so existing content relationships remain valid.
- No remote D1 migration or Worker deployment has been performed. The source HTML still uses Supabase for app data, uploads, moderation, marketplace checkout and payment flows.

This means the R2 content transfer is **not complete for videos**. Do not disconnect or pause Supabase until the six remaining video objects have been copied, tested, and their D1 URLs switched to R2.
