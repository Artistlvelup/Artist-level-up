# Artist Level Up V101 — Cloudflare-only rebuild

## Direction

Rebuild the V101 application so its runtime depends on Cloudflare services only. Supabase is not part of the target architecture. Do not add new Supabase SDK usage, Supabase Auth calls, PostgREST calls, Storage calls, or Supabase Edge Function calls.

This is a staged replacement, not a destructive deletion of the old service. Keep the existing V101 backup and preserve the current production website until the Cloudflare replacement has passed the acceptance checks.

## Target architecture

- **Cloudflare Pages or the existing V101 static hosting:** serves the V101 frontend.
- **Cloudflare Workers:** the only application API and authorization boundary.
- **Cloudflare D1:** application records, user identities, sessions, artist profiles, songs, videos, posts, marketplace, wallet, promotions, payouts, distribution and admin records.
- **Cloudflare R2:** user-uploaded audio, video, cover art, profile images and picture posts. The application uses short-lived signed upload intents and server-validated object keys. Existing user-managed R2 objects must not be copied, moved, renamed or deleted.
- **Cloudflare Turnstile:** bot protection for public registration and sensitive forms, where configured.
- **Email provider through a Worker secret:** verification and password-reset messages. The provider must never be called directly from browser code.
- **Payment provider webhooks:** verified server-side by the Worker; payment state is never trusted from browser redirects.

## Non-negotiable safety rules

1. Work only on the existing V101 preparation branch until the owner approves production deployment.
2. Preserve the V101 backup before changing the main HTML.
3. Do not import legacy or test accounts. Do not create a fake owner or admin.
4. Do not seed test profiles, sample media, or fake business records into D1 or R2.
5. Do not copy, move, rename, or delete any R2 media.
6. Do not delete the old Supabase project or its data as part of code migration. It is outside the target runtime and can be considered separately after the new site is verified.
7. Never expose secret values in source code, browser JavaScript, logs, or chat.
8. No live Render deployment, production D1 migration, or production cutover without explicit approval.

## Build order

### 1. Cloudflare identity and sessions
- Add native account registration, email verification, login, logout, session refresh, password reset, and account recovery.
- Store password hashes using a modern password-hashing design and store only hashed session tokens in D1.
- Enforce rate limits, CSRF protections where cookies are used, strict origin checks, and Turnstile on public entry points.
- Admin access must be granted only through a separately verified owner bootstrap process; never trust a role sent by the browser.
- Keep all old identities untouched and do not bridge Supabase sessions.

### 2. D1 data APIs
- Complete authenticated CRUD APIs for profiles, artist accounts, songs, videos, picture posts, promotions, distribution requests, marketplace, wallets, withdrawals, subscriptions and admin workflows.
- Enforce ownership and admin authorization inside every Worker route.
- Add schema constraints and indexes, plus migration tests against a temporary local SQLite database.

### 3. R2 media lifecycle
- Implement signed upload intents for audio, video, profile images, cover art and picture posts.
- Validate MIME type, file size, owner, object key, and upload completion server-side.
- Persist only Cloudflare R2 object keys/URLs in D1.
- Do not touch media objects already uploaded by the owner.

### 4. Payments and money movement
- Verify payment webhooks server-side using provider signatures.
- Make payment processing idempotent.
- Do not mark orders, subscriptions, upload fees or payouts as paid based on frontend callbacks alone.
- Keep payout and withdrawal actions behind admin authorization and audit logs.

### 5. Frontend conversion
- Replace all Supabase client initialization and calls in the V101 HTML with the Cloudflare Worker API.
- Replace Supabase Auth session handling with the native Cloudflare session flow.
- Replace all Supabase Storage and Edge Function upload paths with R2 upload intents.
- Preserve the existing V101 UI and features; change the data transport, not the product design unless necessary.

### 6. Verification and cutover
- Add automated tests for authentication, authorization, ownership boundaries, uploads, admin actions and payment webhooks.
- Run migration/schema tests without applying anything to the production D1 database.
- Confirm the built frontend contains no Supabase SDK, URL, Auth, PostgREST, Storage or Edge Function dependency.
- Confirm all essential features work against a non-production Cloudflare environment before requesting production approval.
- Only after explicit owner approval, configure production bindings, apply reviewed migrations and switch the live website.

## Definition of done

The migration is complete only when the V101 frontend has no runtime dependency on Supabase and every existing feature has a tested Cloudflare Worker/D1/R2 replacement. Merely creating D1 tables or deploying a Worker is not completion.
