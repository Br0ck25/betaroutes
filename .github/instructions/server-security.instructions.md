---
applyTo: 'src/routes/**/+server.ts,src/routes/**/+page.server.ts,src/lib/server/**/*.ts,src/**/*.server.ts'
---

# Server Code Security Rules

## Input validation

- Validate and normalize all input (params/query/body/headers).
- Reject unexpected fields (don’t silently accept).

## AuthN/AuthZ

- Treat auth as mandatory for protected data.
- Enforce authorization checks server-side (never rely on client state).

## Secrets

- Never log secrets or personal data.
- Nev:contentReference[oaicite:18]{index=18} environment bindings (Cloudflare) and keep local examples in templates only.

## Storage safety

- No plaintext passwords.
- Don’t store session/auth tokens in localStorage.
- Prefer httpOnly cookies where applicable.

## Anti-abuse

- Add rate limiting to sensitive endpoints where applicable.
- Avoid timing leaks in auth flows.
