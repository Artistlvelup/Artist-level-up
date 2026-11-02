# V101 read-only Supabase legacy account inventory runbook
Date: 2026-11-02
Branch: `migration/v101-cloudflare-cutover-from-main-2026-11-02`

## Purpose
Prepare a privacy-minimizing inventory for mapping existing Supabase Auth identities to V101 profiles and artist rows before any Cloudflare D1 cutover. This runbook is read-only. It does not create users, change credentials, update records, delete data, or access/copy Storage objects.

## Current access limitation
No Supabase administrative connection or approved read-only inventory credential is currently available through the connected tools. The Cloudflare D1 database `artist_level_up_v101` was previously observed with zero tables. Therefore no account inventory or identity mapping has been generated.

Do not paste a Supabase `service_role` key, access token, refresh token, password, or PIN into chat, GitHub, source files, or logs. Do not add credentials to this repository. A Supabase project URL and anon key alone are not sufficient for a trusted Auth Admin inventory.

## Required operator access
An authorized project owner/operator must run the inventory in a trusted local environment with:
- The exact Supabase project URL.
- A short-lived or tightly controlled Supabase service-role credential stored only in a local environment variable or approved secret manager.
- Read-only access for all database queries. The service-role key itself is highly privileged; the queries below must remain SELECT-only and the credential must be revoked/rotated after the inventory if it was temporary.

## Read-only collection
1. Use Supabase Auth Admin list-users pagination to collect only: Auth user UUID, normalized email, email-confirmed timestamp/status, created timestamp, last sign-in timestamp, and disabled/deleted/banned status where available.
2. Query only the public `profiles` and `artists` tables with SELECT statements. First inspect column metadata in the Supabase dashboard or read-only information schema. Then select only identity/relationship fields needed for reconciliation: profile primary key, linked user ID, email if present, display name; artist primary key, linked user ID, status, and suspension flag.
3. Do not query or export password hashes, credentials, OTPs, Auth tokens, PINs, payment/bank details, private messages, or Storage object listings.
4. Do not download or copy media. Keep all existing media URLs and objects untouched.
5. Paginate all Auth results and record page/count totals so the inventory can be reconciled.

## Reconciliation rules
- Preserve the original Supabase Auth UUID as `legacy_user_id`; never assume a D1 UUID can replace it.
- Candidate mapping requires exactly one active Auth identity with a verified email and an unambiguous relationship to its profile/artist rows.
- Email equality alone is not sufficient to merge identities, especially for unverified, duplicate, changed, missing, or shared addresses.
- Mark duplicate, unverified, missing-email, disabled, suspended, admin, and inconsistent ownership cases for manual review. Never auto-merge or infer admin status from a client-side profile.
- Produce aggregate counts and a restricted mapping file for the authorized migration operator. Do not commit identifiable user inventories or email addresses to GitHub.
- Do not create D1 users or populate migration mappings until the identity bridge/recovery design is approved and tested.

## Required report (no personal data)
Return only aggregate counts to the project issue/runbook:
- Auth users total; active; disabled/deleted/banned; verified; unverified; missing email.
- Profiles total; artists total; profiles without Auth owner; artists without Auth owner.
- Duplicate normalized emails; duplicate profile-to-Auth links; duplicate artist-to-Auth links.
- Admin identities count; suspended artist count; ambiguous mapping count; eligible one-to-one candidate count.
- Inventory timestamp and pagination completeness.

## Stop conditions
Stop without changing data if Auth pagination is incomplete, the project URL is uncertain, the credential scope is unclear, any query attempts a write, or ownership relationships cannot be established. Do not use the legacy PIN as a password or export it. Do not remove Supabase frontend code or switch production authentication until all account continuity tests pass.

## Current status
Runbook only. No Supabase credentials were accessed, no Auth users or public rows were read, no user inventory was exported, no D1 identity was created, and no production service was changed.
