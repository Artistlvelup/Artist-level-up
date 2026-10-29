# V101 Supabase Dependency Inventory

Status: source-code audit of `Artist-Level-Up-LAUNCH-MASTER.html` on the isolated migration branch. This is a dependency inventory, not a completed replacement or authorization to cut over.

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
- No confirmed export/import of the existing Supabase Auth user inventory or stable user-ID mapping.
- The current D1 schema migration is still a first-pass SQLite-compatible schema. Public-table foreign keys, PostgreSQL checks, triggers, indexes and RLS policy equivalents still require a reviewed migration plan.
- No confirmed export/import of the existing `music` bucket objects or their metadata.
- The Paystack Edge Function and any other privileged functions must be inventoried and replaced or deliberately retained behind a secure service boundary.
- Supabase must remain active for rollback until data, auth, storage, payments and production traffic have all been verified.

## Safe next implementation order

1. Finish a complete source audit of all Supabase table names, Storage paths, and Edge Function names.
2. Define a secure Worker API and browser adapter so V101 no longer needs direct PostgREST or privileged operations.
3. Decide and test identity continuity for the existing Supabase user IDs before importing profiles.
4. Inventory and migrate Storage objects, beginning with a dry-run manifest and checksums.
5. Rebuild and test payment/privileged functions with webhook verification and idempotency.
6. Only after those checks, plan a staged cutover with rollback. Do not apply D1 migrations or change the live V101 app as part of this inventory step.
