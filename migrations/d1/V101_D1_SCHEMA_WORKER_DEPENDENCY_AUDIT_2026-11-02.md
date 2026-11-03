# V101 D1 Schema and Worker Dependency Audit
Date: 2026-11-02
Working branch: `migration/v101-cloudflare-cutover-from-main-2026-11-02`

## Findings from the reviewed Cloudflare files
The older Cloudflare-only branch contains a 26-table business schema in `migrations/d1/0001_initial_schema.sql`. Static comparison against the current Worker SQL references found that the Worker uses these business tables:
`artist_videos`, `artists`, `marketplace_beats`, `marketplace_orders`, `picture_posts`, `platform_admins`, `profiles`, `promotions`, `songs`, `streaming_distribution_requests`, and `withdrawals`.
All are present in that older schema.

The Worker also uses identity/session tables:
- `app_users`, `app_sessions`: `0002_identity_sessions.sql`
- `app_session_families` and `app_sessions.family_id`: `0004_persistent_session_families.sql`
- `app_credentials`, `app_email_verification_tokens`, `app_auth_rate_limits`: `0006_password_auth.sql`
- `app_login_link_tokens`: `0007_passwordless_login_links.sql`

The Worker dependency scan found no other missing business table names after accounting for these identity/session migrations. The scan was static text analysis, not a SQL execution or runtime test.

## Migration ordering
The intended migration sequence is:
1. `0001_initial_schema.sql`
2. `0002_identity_sessions.sql`
3. `0004_persistent_session_families.sql`
4. `0006_password_auth.sql`
5. `0007_passwordless_login_links.sql`

The order matters because the identity/auth migrations reference `app_users` and `app_sessions`.

## Still blocked on the protected working branch
At the time of this review, the protected cutover branch is missing:
- `migrations/d1/0001_initial_schema.sql`
- `migrations/d1/0006_password_auth.sql`
- `migrations/d1/0007_passwordless_login_links.sql`
- `wrangler.toml`

The older branch's copies were inspected for dependency analysis only. They have not been added to the protected working branch. Earlier GitHub writes for these files were blocked by repository safety checks; no encoding or alternate-path workaround was attempted.

## Configuration and operational checks still required
The inspected older `wrangler.toml` defines:
- Worker entry point `workers/auth/worker.js`
- D1 binding `DB` for database `artist_level_up_v101`
- migration directory `migrations/d1`
- allowed website origins and public app URL

It does not contain secrets. Before any deployment, the environment still needs secure configuration of `SESSION_PEPPER`, Resend email credentials/from address, and any required R2 credentials/bindings/public URL. Verify the current Cloudflare account's actual database ID, bucket bindings, allowed origins, and secret names rather than assuming the older config remains correct.

## Cutover decision
This audit does not authorize a production D1 migration or Worker deployment. The current V101 frontend still depends on Supabase, its account identity mapping is unresolved, and the existing registration UI uses a 4–6 digit PIN while the Worker password registration requires a 12-character password. Preserve the current forms and do not switch production auth until those issues are solved and tested.

No remote D1 command, production deployment, Supabase write/delete, or media transfer was performed.
