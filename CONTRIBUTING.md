# Contributing

Thank you for contributing to this project!

This repository enforces **strict frontend and architectural standards**.
All contributors (humans and AI) must follow these rules.

---

## Svelte Rules

This is a **mixed Svelte 4 / Svelte 5 codebase during migration**.

### Allowed File States

A file must be **exactly one** of the following:

- **Legacy Svelte 4**
  - Must include `<!-- MIGRATION: SVELTE4-LEGACY -->` at the top
  - Bug fixes only
  - No new features
  - May contain forbidden patterns temporarily (until pre-migration cleanup)

- **Migrated Svelte 5**
  - Uses runes-based reactivity exclusively (`$state`, `$derived`, `$effect`)
  - Represents the final architectural state
  - See `EXAMPLES.md` for canonical patterns

### New Code Rule (Non-Negotiable)

- **All new files MUST use Svelte 5**
- **All newly migrated files MUST use Svelte 5**
- Legacy Svelte 4 syntax is permitted **only** in files explicitly marked as legacy

Mixing Svelte 4 and Svelte 5 syntax in the same file will fail CI.

### Forbidden Patterns in Svelte 5 Files

See `AI_GUARD.md` for complete list. Key items:

- ❌ `$:` reactive statements
- ❌ `onMount`, `beforeUpdate`, `afterUpdate`
- ❌ `createEventDispatcher`
- ❌ Svelte stores

---

## HTML Rules

- Follow the **HTML Living Standard (WHATWG)** only
- No XHTML or XML-style syntax
- No deprecated elements or attributes
- Prefer semantic HTML

See `HTML_LIVING_STANDARD.md` for complete rules.

---

## Migration Rules

If you're migrating a file from Svelte 4 to Svelte 5:

- Follow `svelte-4-to-5-migration-agent-spec.v2.7.3.md` (authoritative rules)
- Read `MIGRATION.md` for operational guidance
- Migrate files in the order specified in `MIGRATION_ORDER.md`
- **One file at a time only**

---

## Mandatory Checks

After any change:

1. `npm run check`
2. `npm run lint`
3. `npx eslint`
4. Fix **all** errors and warnings

Optional but recommended: 5. `npm test`

CI must pass cleanly before committing.

---

## PWA Requirements

This is a Progressive Web App. All changes must preserve:

- Service worker registration
- Offline functionality
- Installability
- Manifest validity

See `PWA.md` for complete requirements.

---

If anything is unclear:
**STOP and ask instead of guessing.**
