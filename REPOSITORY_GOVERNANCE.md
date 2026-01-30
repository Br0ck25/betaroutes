# Repository Governance

This document defines **repository-wide governance rules**.

This repository is a **Strict Svelte 5 (Runes) + Cloudflare** application.
It enforces **zero tolerance** for legacy syntax, insecure patterns, or "temporary exceptions".

**Status:**

- Legacy Mode: DISABLED (Svelte 4 syntax is banned)
- Strict Mode: ENABLED (all files must pass `eslint.config.js`)

---

## Mandatory reading (before any changes)

You MUST read and follow:

- `README.md`
- `AGENTS.md` (canonical AI router + forbidden patterns)
- `ARCHITECTURE.md` (data boundaries & key patterns)
- `SECURITY.md` (zero trust rules)
- `PWA.md` (offline-first + caching rules)
- `DESIGN_SYSTEM.md` (UI constraints & theme colors)
- `HTML_LIVING_STANDARD.md` (strict parsing rules)

**Supplemental (recommended):**

- `ERROR_PATTERNS_AND_STOP_CONDITIONS.md` (recurring mistakes + stop rules)

**Conflict rule:** If there is a conflict, **SECURITY.md always wins.**

---

## Svelte rules (Runes only)

**Target:** Svelte 5 (Runes)

All component state must use runes:

- `$state` / `$state.raw`
- `$derived` / `$derived.by`
- `$effect` / `$effect.pre`
- `$props`
- `$bindable`

### Strictly forbidden

- `export let` (use `$props()`)
- `$:` labels (use `$derived` / `$effect`)
- `createEventDispatcher` (use callback props)
- `onMount` (use `$effect(() => { ... })` and guard with `browser` when needed)
- `<slot>` (use snippets: `{#snippet}` / `{@render}`)
- `$$props` (use `let props = $props()`)
- `$$restProps` (use `let { ...rest } = $props()`)

**Enforcement:** Any file containing forbidden patterns will fail the build via `eslint-plugin-svelte`.

---

## Cloudflare & data rules

**Target:** Cloudflare Workers (edge runtime)

- **No Node.js APIs:** do not use `fs`, `path`, or `process`.
- **Secrets:** access secrets via `platform.env`, never `process.env`.
- **Data access:** all KV/D1 usage MUST follow composite key rules defined in `ARCHITECTURE.md` and user scoping in `SECURITY.md`.

---

## PWA rules (non-negotiable)

- **Offline-first:** critical flows must work offline using IndexedDB (never `localStorage` for queues).
- **Cache safety:** never cache API responses or user data in the service worker.
- **Manifest:** `static/manifest.json` must remain valid and must match `DESIGN_SYSTEM.md`.

See `PWA.md` for complete requirements.

---

## Mandatory verification

After **any** code change:

1. Run `npm run gate` (types + lint + format).
2. Verify **no red squiggles** in VS Code (strict `tsconfig`).

### Zero warnings policy

Never ignore or suppress errors.

- No `// @ts-ignore`
- No "temporary" eslint disables
- Fix the root cause (or update the governance doc first, then implement)
