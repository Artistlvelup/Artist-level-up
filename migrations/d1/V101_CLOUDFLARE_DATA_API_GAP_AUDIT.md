# V101 Cloudflare Data API Gap Audit

Branch: `migration/d1-v101-prep`
Source reviewed: `Artist-Level-Up-LAUNCH-MASTER.html` and `workers/auth/worker.js`
Status: read-only route coverage audit; no live service or data changed.

## Existing Worker routes found

| Area | Existing route coverage | Remaining concern |
|---|---|---|
| Profile | `GET/PUT /api/me/profile` | Confirm client adapter and avatar policy; do not transfer excluded avatar media |
| Artist | `GET/POST /api/me/artist` | Existing owner artist identity must remain stable |
| Songs | `GET/POST /api/me/songs`, `PATCH /api/me/songs/:id` | Audio upload/storage and song lifecycle are not complete |
| Public songs | `GET /api/public/songs` | Read-only public listing |
| Video upload | `POST /api/me/videos/upload-intent` | Creates signed R2 PUT URL only; does not create/list/edit/delete video metadata |
| Admin videos | `GET/PATCH /api/admin/videos` | Moderation exists; owner-scoped video lifecycle still missing |
| Promotions | `POST /api/me/promotions` | No complete list/update/cancel lifecycle confirmed |
| Withdrawals | `POST /api/me/withdrawals` | Admin list exists; user history/status lifecycle incomplete |
| Marketplace beats | `GET /api/marketplace/beats` | Public read only |
| Marketplace orders | `GET /api/me/marketplace/orders` | Checkout/payment creation and verified webhook settlement not implemented here |
| Admin songs | `GET/PATCH /api/admin/songs` | Moderation route exists |
| Admin commissions | `GET /api/admin/marketplace/commissions` | Read only |

Authentication routes currently include native first-admin registration, password login, anonymous creation, session, refresh and logout. There is no Supabase session bridge route. Do not use anonymous creation or first-admin registration as a substitute for preserving the existing V101 owner identity.

## Supabase operations observed in the V101 HTML

- `profiles`: profile upsert.
- `artists`: lookup and artist creation.
- `songs`: list, insert, update and moderation status update.
- `artist_videos`: list, read one, update status, delete.
- `marketplace_beats`: published listing.
- `marketplace_orders`: paid-order/admin commission read.
- `promotions`: insert.
- `withdrawals`: insert.
- `music` Storage: object removal is present in legacy code. Do not redirect or execute it during this migration; the owner controls Supabase cleanup.
- Video upload in the current HTML still contains a Supabase Edge Function / Storage path. The existing Worker upload-intent endpoint alone is not a drop-in replacement.

## Safe implementation order

1. Finish owner-only video metadata routes around the existing D1 `artist_videos` table: list own videos, create metadata only after a successful R2 upload, edit allowed metadata, and delete only the owner's own record. Admin moderation remains separate.
2. Add tests for owner isolation, invalid IDs, invalid metadata, missing sessions, and ensuring one user cannot mutate another artist's records.
3. Implement the V101 browser adapter for the routes and verify response shapes against the actual HTML call sites.
4. Complete audio storage and song lifecycle before replacing the existing Supabase song calls.
5. Treat marketplace checkout, payments, payouts and privileged admin actions as separate security-critical work. Do not simulate payment success or accept client-supplied prices/roles.
6. Only after route and UI tests pass, plan a user-approved cutover.

## Owner's migration limits — binding

- Only the already-confirmed active owner/admin identity is in migration scope. Preserve its existing UUID and artist UUID.
- Do not import anonymous, unrecognized, secondary, duplicate, test, abandoned or unused profiles/accounts.
- Reuse the song, three pictures and two selected videos already placed in R2. Do not upload them again.
- Do not copy the other six videos or profile avatar to Cloudflare.
- Do not delete or alter Supabase accounts, rows or media. Exclusion from migration is not permission to delete.
- Work only on `migration/d1-v101-prep`; preserve the V101 backup. Do not deploy Worker, apply remote D1 migrations, update the live Render site, or push to `main` without explicit approval.
