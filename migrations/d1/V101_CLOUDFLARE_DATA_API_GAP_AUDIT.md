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
| Video upload/metadata | `POST /api/me/videos/upload-intent`; `GET/POST /api/me/videos`; `PATCH/DELETE /api/me/videos/:id` | Owner-scoped metadata routes are now implemented on the migration branch; automated test added, pending workflow validation. Delete removes only the D1 metadata row and explicitly does not delete the R2 object |
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

1. Owner-scoped video metadata routes are now present on the migration branch. They list only the authenticated artist's records, create pending metadata only for URLs under that artist's R2 video prefix, restrict thumbnail URLs to that artist's R2 thumbnail prefix, and allow edits only to title/description/thumbnail/social links. Admin moderation remains separate.
2. A data API test covers unauthenticated access, rejection of an external video URL, creation/listing/editing, prevention of client status/video URL changes, and metadata-only deletion. GitHub Actions validation still needs to confirm the suite passes.
3. Implement the V101 browser adapter for these routes and verify response shapes against the actual HTML call sites.
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
