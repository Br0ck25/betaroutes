# Contributing

Thank you for contributing to this project!

This repository enforces **strict frontend and architectural standards**.
All contributors (humans and AI) must follow these rules.

---

## Svelte Rules

This is a **mixed Svelte 4 / Svelte 5 codebase during migration**.

### Allowed States

A file must be **exactly one** of the following:

- **Legacy Svelte 4**
  - Must include `<!-- MIGRATION: SVELTE4-LEGACY -->` at the top
  - Bug fixes only
  - No new features

- **Migrated Svelte 5**
  - Uses runes-based reactivity exclusively
  - Represents the final architectural state

### New Code Rule (Non-Negotiable)

- **All new files and all newly migrated files MUST use Svelte 5**
- Legacy Svelte 4 syntax is permitted **only** in files explicitly marked as legacy

Mixing Svelte 4 and Svelte 5 syntax in the same file will fail CI.

---

## HTML Rules

- Follow the **HTML Living Standard (WHATWG)** only
- No XHTML or XML-style syntax
- No deprecated elements or attributes
- Prefer semantic HTML

---

## Mandatory Checks

After any change:

1. `npm run check`
2. `npm run lint`
3. `npx eslint`
4. Fix **all** errors and warnings

CI must pass cleanly before committing.

---

If anything is unclear:
**STOP and ask instead of guessing.**
