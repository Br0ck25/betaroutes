# sv — SvelteKit App

Everything you need to build and maintain this **SvelteKit + Svelte 5** project,
powered by [`sv`](https://github.com/sveltejs/cli).

---

## ⚠️ Project Conventions (Important for GitHub Copilot)

This repository enforces **strict frontend standards**.  
GitHub Copilot (Raptor Mini) **must follow these rules** when adding or modifying code.

Violations will fail **linting, pre-commit hooks, and CI**.

> **Note**
> During the Svelte 4 → Svelte 5 migration, Copilot must also follow:
> - `MIGRATION.md`
> - `AI_GUARD.md`
> - `SVELTE5_MIGRATION_COMPLIANCE.md`

---

## Migration Status

This project is currently undergoing a **controlled Svelte 4 → Svelte 5 migration**.

- Migration is **file-by-file**
- File order is defined in `MIGRATION_ORDER.md`
- Only **one file may be migrated at a time**
- All rules are enforced by CI

👉 See **`MIGRATION.md`** before making *any* Svelte changes.

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

- **Svelte 5 only** (unless explicitly marked legacy)
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
See `MIGRATION.md` for rules.

---

### Forbidden (No Exceptions)

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

These rules are **non-negotiable**.

---

## Tooling Expectations

Before committing:

```sh
npm run check
npm run lint
```

CI must pass with **zero warnings**.

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

- `MIGRATION.md` — Migration rules and checklist
- `MIGRATION_ORDER.md` — Approved migration order
- `AI_GUARD.md` — AI behavior and enforcement
- `SVELTE5_MIGRATION_COMPLIANCE.md` — Svelte 5-only guarantees
- `HTML_LIVING_STANDARD.md` — HTML rules
- `PWA.md` — PWA requirements
- `ARCHITECTURE.md` — App structure and boundaries
