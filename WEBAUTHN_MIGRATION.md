# WebAuthn KV Migration

This script-based endpoint helps normalize legacy authenticator records in Cloudflare KV where `credentialID` or `credentialPublicKey` were stored as binary/Buffer-like shapes rather than base64url strings.

Usage (production):

1. Set `ADMIN_MIGRATE_SECRET` env var in production to a secure secret.
2. Deploy the app with this code.
3. Call POST https://<your-app>/api/admin/webauthn/migrate with the header `x-admin-secret: <secret>`.

What it does:

- Lists keys prefixed with `authenticators:` (user-specific authenticator store) and reads the JSON array.
- Attempts to normalize each authenticator's `credentialID` and `credentialPublicKey` to Base64URL strings.
- Writes back normalized authenticators and refreshes `credential:{credentialID}` index keys.
- Returns counts of migrated / skipped records.

Security:

- The endpoint is gated by `ADMIN_MIGRATE_SECRET` and returns only aggregate counts.
- Remove or rotate the secret once migration is complete.

If you prefer not to use the endpoint, you can write a one-off worker or run a script that uses Cloudflare's API to iterate and normalize the keys in the same way.
