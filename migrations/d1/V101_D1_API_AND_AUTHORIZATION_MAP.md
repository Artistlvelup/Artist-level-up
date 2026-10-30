# V101 D1 Data and Worker API Map

Status: design document based on direct inspection of the V101 HTML on this migration branch. No live API has been deployed and no production traffic has been switched.

## Tables directly referenced by the current V101 HTML

| Table | Observed app operations | Migration handling |
|---|---|---|
| `profiles` | Upsert profile by auth user ID | Preserve the same user ID as the D1 `app_users.user_id` |
| `artists` | Find artist by `user_id`; create artist | Enforce ownership using the authenticated session, not a client-supplied user ID |
| `songs` | Insert, update, list by artist, update status; public published/approved list | Worker must scope writes to the session's artist; public reads can be a separate restricted endpoint |
| `promotions` | Insert promotion row | Worker derives owner from session; validate amount/status fields server-side |
| `withdrawals` | Insert pending withdrawal request | Worker derives owner from session; validate amount and never approve/pay from this endpoint |
| `marketplace_beats` | List published beats | Public read endpoint with explicit field allowlist |
| `marketplace_orders` | Read paid order/payment fields | Restrict to authorized admin/producer ownership; never trust browser-supplied paid status or payout amounts |
| `artist_videos` | Insert/update/list/delete; status transitions | Worker validates ownership and allowed transitions; privileged moderation actions require admin authorization |

The app also accesses the Supabase Storage bucket `music`; it is not a database table.

## Proposed Worker API surface

Implemented in the isolated Worker prototype: anonymous session creation/validation/logout, profile read/update, artist read/create, and artist-owned song list/create/update plus public published-song listing. Promotions, withdrawals, videos, marketplace, payment and storage routes below remain proposed contracts and are not yet implemented.

### Identity
- `POST /auth/anonymous`: create anonymous identity and opaque session.
- `GET /auth/session`: validate session and return stable user ID.
- `POST /auth/logout`: revoke current session.

### Artist and profile
- `GET /api/me/profile`
- `PUT /api/me/profile`
- `GET /api/me/artist`
- `POST /api/me/artist`

### Songs and audio metadata
- `GET /api/me/songs`
- `POST /api/me/songs`
- `PATCH /api/me/songs/:id`
- `GET /api/public/songs` (only published/approved fields)
- `PATCH /api/me/songs/:id/status` (strict allowlist; no client-set privileged status)

### Promotions and withdrawals
- `POST /api/me/promotions`
- `POST /api/me/withdrawals` (creates pending request only)

### Videos
- `GET /api/me/videos`
- `POST /api/me/videos`
- `PATCH /api/me/videos/:id`
- `DELETE /api/me/videos/:id`
- Separate admin-only moderation endpoints; do not reuse artist-owned routes for moderation.

### Marketplace and payments
- `GET /api/marketplace/beats` (published beats only)
- `GET /api/me/marketplace/orders` (ownership-filtered)
- `POST /api/marketplace/checkout` (server computes price and license; calls Paystack securely)
- `POST /api/payments/paystack/webhook` (signature verification, idempotency and authoritative payment-state update)

### Storage
- `POST /api/storage/audio/upload-intent`
- `POST /api/storage/video/upload-intent`
- `POST /api/storage/object/delete` (checks object ownership before deletion)
- `GET /api/storage/object/:key` only if a controlled/private delivery model is needed.

R2 upload authorization should use short-lived presigned URLs or a Worker-mediated upload. Never expose R2 credentials or D1 credentials in V101 browser JavaScript. Public object URLs should only be used for assets intentionally published.

## Required authorization rules

1. Resolve the current user exclusively from a validated server-side session. Ignore user IDs supplied in JSON for ownership decisions.
2. For artist-owned rows, verify the row's `artist_id` or `user_id` belongs to the authenticated user before read/update/delete.
3. Treat status, moderation, payouts, commissions, paid flags, and amounts as server-controlled fields.
4. Use explicit request schemas and column allowlists; do not pass arbitrary JSON directly into SQL.
5. Use prepared statements and bounded pagination; reject oversized request bodies.
6. Add rate limiting to anonymous account creation, upload-intent creation, checkout, and withdrawal requests.
7. Add audit events for moderation, payment and withdrawal state changes.
8. Add tests for unauthenticated access, cross-user access, invalid transitions, replayed webhooks, and repeated withdrawal/checkout requests.

## Important unresolved items

- Confirm exact RLS policies and admin-role checks from Supabase before implementing authorization. The HTML source alone cannot establish these.
- Confirm all table columns, defaults, constraints and relationships against the source schema.
- Confirm storage object key patterns, bucket visibility, size limits, MIME rules and existing object counts.
- Confirm whether there are additional admin pages or external scripts that call Supabase outside this HTML file.
- Do not run remote D1 migrations, deploy the Worker, or edit the live V101 website until the schema and API tests are reviewed.
