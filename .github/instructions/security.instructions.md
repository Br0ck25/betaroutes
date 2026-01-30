---
description: 'Security rules for server-side code'
applyTo: 'src/routes/**/+server.{ts,js}'
---

## Never trust input

- Validate and sanitize all user-controlled input (params, query, body).
- Enforce authn/authz consistently (fail closed).

## Sensitive data

- Never log secrets/tokens/PII.
- Do not leak internal errors to clients; return safe errors.

## Web security basics

- Use CSRF protections where applicable.
- Set safe cookies (HttpOnly, Secure, SameSite) when using sessions.
- Rate-limit sensitive endpoints (login, reset, delete, exports).
