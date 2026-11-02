# V101 Authentication Form Compatibility Finding
Date: 2026-11-02
Branch: `migration/v101-cloudflare-cutover-from-main-2026-11-02`

## Existing registration UI (must be preserved)
The current launch master registration form contains:
- `regName`: Artist / Stage Name
- `regEmail`: Email
- `regCountry`: Country
- `regPin`: Account PIN, 4–6 digits

The profile edit form similarly contains artist name, email, country, avatar upload, and an optional 4–6 digit PIN.

## Cloudflare auth contract
The current native Worker password-registration handler requires:
- `email`: valid email
- `password`: at least 12 characters
- `display_name`: non-empty, up to 80 characters
It sends an email-verification message through Resend. Password login requires email and password, and verified email.

The current form does not collect a 12-character password. The existing PIN is explicitly a short sensitive-action PIN, not a password. Mapping the PIN into the password field would violate the Worker contract and weaken account security. Do not do this.

## Safe integration decision still required
- Keep the current form layout and visible fields unchanged unless the owner explicitly approves a UI change.
- Do not enable password registration/login by pretending the PIN is a password.
- A passwordless email-link onboarding flow may be an option, but the current Worker exposes passwordless login for already verified accounts; it does not currently establish that the existing registration form can create and verify a new account without a password.
- A secure short-PIN feature needs a separate server-side design (rate limiting, salted hash, lockout, recovery and authorization scope). The current local PIN is not suitable as an account credential.
- Existing Supabase account continuity remains unresolved. Do not auto-create duplicate D1 identities or switch live authentication until the identity mapping is verified.

## Current status
No frontend auth code was changed. No login/registration form was rebuilt. No production authentication was switched.
