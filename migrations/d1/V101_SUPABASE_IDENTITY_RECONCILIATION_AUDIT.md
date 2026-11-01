# V101 Cloudflare Migration — Account Selection Rules

Status: authoritative user instruction for the V101 migration.
Branch: `migration/d1-v101-prep`.

## What may be migrated

- Keep only the existing active admin/owner account already recognized by the live V101 website.
- Preserve that account's existing UUID and the V101 data belonging to it.
- The previously confirmed active account has 8 video records, 3 picture posts, and 1 song.

## Explicit exclusions

- Do not migrate anonymous accounts or anonymous profile records.
- Do not migrate profiles/accounts that are not recognized by the live V101 website.
- Do not migrate test, abandoned, duplicate, unused, or otherwise unnecessary records.
- The previously confirmed extra account with no media is excluded.
- Do not create replacement accounts or import extra profiles "just in case".

## Handling excluded records

Excluded records are not to be copied into Cloudflare D1 or R2. Do not delete or alter anything in Supabase as part of this migration unless the owner separately instructs it.

## No-change boundary

This document records the owner's prior selection rules. It does not authorize a live deployment, remote D1 migration, Supabase deletion, or media transfer. Keep the current V101 live site unchanged until the owner explicitly approves cutover.

## Read-only identity verification and D1 import

Verified against the existing Supabase project on 2026-11-01:
- Auth user `d6eaf421-fcad-44ec-beb0-d6a7f676db8a` exists, is non-anonymous, is not deleted, and is not banned.
- Matching profile exists with display name `Solo_vibez`; its profile role remains `artist`.
- Matching artist `2b2a5bf6-9673-42a1-a33a-d40dab98ad44` exists, is `pending`, and is not suspended.
- Matching `platform_admins` record exists and is active.

The additive, idempotent migration `0005_verified_owner_identity.sql` imports only that profile, artist mapping, and active platform-admin mapping. It intentionally leaves `avatar_url` NULL and does not import Auth credentials, sessions, songs, videos, picture posts, or any other account. The Supabase session bridge creates the D1 `app_users` row only after verifying the live Supabase access token and the imported D1 owner/admin mapping.

The migration is branch-only and must pass the repository validation workflow before it is considered ready. It has not been applied to remote D1.
