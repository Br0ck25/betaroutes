# sv — SvelteKit App

Everything you need to build and maintain this **SvelteKit + Svelte 5** project,
powered by [`sv`](https://github.com/sveltejs/cli).

---

## ⚠️ Project Conventions (Important for GitHub Copilot)

This repository enforces **strict frontend standards**.  
GitHub Copilot (and all AI tools) **must follow these rules** when adding or modifying code.

Violations will fail **linting, pre-commit hooks, and CI**.

> **Note**
> During the Svelte 4 → Svelte 5 migration, AI tools must also follow:
>
> - `svelte-4-to-5-migration-agent-spec.v2.7.3.md` (authoritative migration rules)
> - `MIGRATION.md` (operational guidance)
> - `AI_GUARD.md` (AI behavior enforcement)

---

## Migration Status

This project is currently undergoing a **controlled Svelte 4 → Svelte 5 migration**.

- Migration is **file-by-file**
- File order is defined in `MIGRATION_ORDER.md`
- Only **one file may be migrated at a time**
- All rules are enforced by CI

👉 See **`MIGRATION.md`** before making _any_ Svelte changes.

---

## HTML

- Follow the **HTML Living Standard (WHATWG)** only
- ❌ No XHTML or XML-style syntax
- ❌ No deprecated elements or attributes
- ❌ No self-closing non-void elements
- Use lowercase tag and attribute names
- Prefer semantic HTML (`main`, `section`, `nav`, `article`, etc.)

See: **`HTML_LIVING_STANDARD.md`**

---

## Svelte

- **Svelte 5 only** for new files and migrated files
- Use **runes-based reactivity exclusively**:
  - `$state`
  - `$derived`
  - `$effect`

### Legacy Exception (Temporary)

Files marked with:

```svelte
<!-- MIGRATION: SVELTE4-LEGACY -->
```

are allowed to use Svelte 4 syntax **only until migrated**.

These files may temporarily contain patterns that are otherwise forbidden (stores, lifecycle hooks, dispatchers) until pre-migration cleanup is performed.

See `MIGRATION.md` for complete rules.

---

### Forbidden in Svelte 5 Files

See `AI_GUARD.md` for the complete authoritative list:

- ❌ `svelte/store`
- ❌ `$:` reactive labels
- ❌ `onMount`, `beforeUpdate`, `afterUpdate`
- ❌ `createEventDispatcher`
- ❌ Legacy component instantiation (`new Component()`)

---

### Required Patterns

- Props via `$props()`
- DOM events via standard attributes (`onclick`, not `on:click`)
- Component communication via callback props
- Slots replaced with **snippets** and `{@render}`

See `EXAMPLES.md` for canonical code patterns.

These rules are **non-negotiable**.

---

## Tooling Expectations

Before committing:

```sh
npm run check
npm run lint
npx eslint
```

Optional but recommended:

```sh
npm test
```

CI must pass with **zero warnings**.

---

## Local secrets & Cloudflare Pages

- Local development: copy `.dev.vars.example` to `.dev.vars` and set local secrets (this file is ignored by git). Do **not** commit `.dev.vars`.
- Production: use `npx wrangler pages secret put <KEY_NAME>` or configure secrets via the Cloudflare Pages dashboard. Do **not** put secrets in `wrangler.toml`.
- Deprecated: `.env.example` has been removed in favor of `.dev.vars.example` to match Cloudflare Pages local dev conventions.

---

## Creating a Project

This project was scaffolded using `sv`:

```sh
# create a new project in the current directory
npx sv create

# create a new project in a new folder
npx sv create my-app
```

---

## Related Documentation

### Core Governance

- `REPOSITORY_GOVERNANCE.md` — Repository-wide rules
- `AI_GUARD.md` — AI behavior and enforcement
- `CONTRIBUTING.md` — Contributor guidelines

### Standards

- `HTML_LIVING_STANDARD.md` — HTML rules
- `ARCHITECTURE.md` — App structure and boundaries
- `EXAMPLES.md` — Canonical code patterns
- `DESIGN_SYSTEM.md` — Design guidelines and color palette

### Migration

- `svelte-4-to-5-migration-agent-spec.v2.7.3.md` — Authoritative migration rules
- `MIGRATION.md` — Operational migration guidance
- `MIGRATION_ORDER.md` — Approved migration order (generated)

### PWA

- `PWA.md` — PWA requirements and rules
