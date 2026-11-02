# Native Worker foundation — migration branch only

- Built from the live V101 source commit and preserved backup recorded in `V101_CLOUDFLARE_ONLY_CUTOVER_AUDIT_2026-11-02.md`.
- Reused the existing reviewed D1 schema/session/password-auth implementation from the preparation branch.
- Removed the legacy session bridge function, route, owner ID placeholder, and obsolete bridge-config table from this branch.
- Added native password-auth module and focused route tests.
- No external legacy database or authentication calls are made by this Worker.
- This is a foundation, not yet full V101 feature parity. Payments, marketplace fulfillment, R2 upload workflows, and complete media/profile/admin paths still need endpoint mapping and tests.
- Schema and auth migrations are source files only. Do not apply them remotely until full migration review is complete.
- No production service, Render deployment, D1 data, R2 objects, or Supabase records were changed.
