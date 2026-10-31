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
