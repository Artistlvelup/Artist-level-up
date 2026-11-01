# V101 Supabase Identity Reconciliation Audit

Status: read-only inventory; no data changed.
Branch: `migration/d1-v101-prep`.
Audited: 2026-11-01.
Project selected: active Supabase project `Artist level up` (`wmtddmaxwulypvhjjntz`).
The separate `Artist Level Up Distribution Portal` project was reported inactive and was not used for this inventory.

## Auth and profile coverage

Read-only counts from the active project:

| Check | Count |
|---|---:|
| Auth users | 14 |
| Anonymous Auth users | 12 |
| Non-anonymous Auth users | 2 |
| Profiles | 10 |
| Profiles belonging to anonymous users | 8 |
| Profiles belonging to non-anonymous users | 2 |
| Auth users with no profile row | 4 |
| Profile rows without a matching Auth user | 0 |
| Artist rows | 3 |
| Artist rows without a matching Auth user | 0 |
| Artist rows without a matching profile | 0 |

## Existing application data counts

| Table | Rows |
|---|---:|
| artists | 3 |
| songs | 1 |
| artist_videos | 8 |
| withdrawals | 0 |
| picture_posts | 3 |
| marketplace_beats | 0 |

These are counts only. No account emails, tokens, phone numbers, or user UUIDs are copied into this audit.

## Migration implications

1. Do not assume every Auth user has a `profiles` row. Four of the fourteen Auth users currently do not.
2. All ten existing profiles map to an Auth user, and all three artist rows map to both an Auth user and a profile.
3. Eight profiled accounts are anonymous Auth users. Do not impose an email/password migration requirement on these accounts.
4. The bridge must preserve the verified Supabase UUID exactly. It must not create replacement UUIDs or silently create incomplete profile/artist rows.
5. The four Auth users without profiles require an explicit policy: determine whether they are legitimate active users, abandoned anonymous identities, or otherwise ineligible. Do not silently discard or auto-provision them.
6. D1 identity import and business-data import must be reconciled before any bridge allow-list is enabled. The present inventory does not prove that any of these records have been imported into D1.
7. Keep Supabase Auth and all existing tables/storage intact during preparation and testing.

## Next safe steps

- Compare the exact Auth UUID set with the D1 `app_users` and business-table identity sets using a controlled, non-public reconciliation process.
- Define eligibility for the four Auth users without profiles.
- Prepare an idempotent import plan preserving primary keys and foreign-key relationships.
- Test the import and bridge on an isolated D1 database before any production cutover.

## No-change boundary

This audit used read-only metadata and aggregate SQL queries. It did not insert, update, or delete Supabase data; apply migrations; access or export user credentials; deploy a Worker; change Render; or move media files.
