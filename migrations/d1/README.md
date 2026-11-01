# Artist Level Up V101 — migration preparation

## Safety boundary

All work in this document belongs to `migration/d1-v101-prep`. The live V101 website and its existing Supabase project have not been switched over. No remote D1 migration has been applied. Do not publish the migration HTML to the live Render site or change the production branch until the end-to-end checks and an explicit owner approval are complete.

The V101 backup remains the rollback reference. Do not create another app version or copy extra videos, pictures, or other media. The selected media already moved by the owner to Cloudflare must remain as-is.

## Current architecture

- The existing V101 browser app continues to use its current Supabase client for artist/profile/content flows.
- The Cloudflare Worker is deployed from this migration branch only: `https://artist-level-up-v101.otunbacashmonnie1.workers.dev`.
- The Worker provides a server-verified bridge at `POST /auth/bridge/supabase`. It validates the supplied access token against the configured Supabase Auth `/auth/v1/user` endpoint. It accepts only the exact pre-approved, existing non-anonymous owner UUID and then checks for the active `platform_admins` mapping and matching profile in D1.
- The bridge does not trust browser-supplied IDs, email, roles, or admin flags. It creates a hashed-token session only after those checks pass.
- The V101 migration HTML now requests that bridge before showing the owner admin view. The browser-only PIN unlock and public `openOwnerAdmin()` bypass no longer grant access. The temporary Worker session token is kept in memory and revoked on owner logout; it is not written to local storage.
- Admin data APIs in the Worker are only partially ported. The V101 app has not been cut over to use the Worker for all data, media, payment, and admin operations. Keep the existing Supabase app backend active until each flow has been ported and tested.

## Identity migration boundary

`0005_verified_owner_identity.sql` is the only owner identity import in this branch. It is additive and idempotent. It inserts only the already verified owner profile, artist mapping, and active platform-admin mapping if absent. It does not overwrite existing rows and does not import passwords, auth sessions, anonymous users, other profiles, video metadata, picture posts, or media files. The owner avatar is not copied.

The SQL is currently a local migration file only. It has **not** been applied to remote D1. Until it is reviewed and separately approved for application, the Worker bridge will fail closed if the required owner mapping/profile are not present in D1.

## Required Worker configuration

- `DB`: the intended D1 binding.
- `SESSION_PEPPER`: Worker Secret, at least 32 characters.
- `SUPABASE_URL`: existing Supabase project URL, as a Variable.
- `SUPABASE_ANON_KEY`: existing Supabase publishable/anon key, as a Secret.
- `ALLOWED_ORIGINS`: exact HTTPS origins permitted to call the Worker.

Never put secret values in source control or chat. The removed bootstrap-registration route and password-login route must not be reintroduced; owner access must be bridged from the already existing verified identity.

## Validation and deployment

The D1 workflow validates all five uniquely numbered SQL migrations against a local SQLite database, checks the single expected owner mapping and absence of seeded video/picture rows, checks foreign keys, and syntax-checks the V101 inline JavaScript and Worker source. It does not apply remote migrations.

The Worker deployment workflow deploys the Worker from this migration branch only. It does not publish the V101 website and does not apply D1 migrations.

## Remaining work before any production cutover

1. Confirm the required Worker environment configuration is present without exposing secrets.
2. Review and explicitly approve the one additive owner-identity migration before applying it to remote D1.
3. Test the owner bridge end-to-end using the existing owner account and confirm anonymous/other accounts are rejected.
4. Finish and test every required Worker endpoint, including all admin, artist, media, payment, and callback paths; verify authorization at the server for every protected operation.
5. Test the migration HTML against the Worker on the migration branch, verify rollback, then request explicit approval before any live-site change.

A successful syntax or migration-validation workflow is not proof that the complete backend or production cutover is finished.
