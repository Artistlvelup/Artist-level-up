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
