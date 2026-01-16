# sv — SvelteKit App (Svelte 5 + PWA)

This repository contains a **SvelteKit application built on Svelte 5**,
with **strict frontend standards**, **CI enforcement**, and a
**Progressive Web App (PWA)-first architecture**.

This project uses [`sv`](https://github.com/sveltejs/cli) for scaffolding
and tooling.

---

## ⚠️ Important: Enforced Standards

This repository enforces **non-negotiable rules**.

Violations will:
- Fail local checks
- Fail pre-commit hooks
- Fail CI
- Be rejected by AI_GUARD rules

If something is unclear:
**STOP and ask before proceeding.**

---

## Svelte Rules

- **Target version:** Svelte 5
- **Default and final state:** runes-based reactivity only
  - `$state`
  - `$derived`
  - `$effect`
- Mixed Svelte 4 / Svelte 5 syntax in the same file is forbidden

### Forbidden (All Files)

- `svelte/store`
- `$:` reactive statements
- `onMount`, `beforeUpdate`, `afterUpdate`
- `createEventDispatcher`
- Class-style component instantiation (`new Component()`)

### Migration Support

This is a **mixed Svelte 4 / Svelte 5 codebase** during migration.

- Legacy files must be explicitly marked:
  ```svelte
  <!-- MIGRATION: SVELTE4-LEGACY -->
  ```
- Legacy files may receive **bug fixes only**
- All new code must be Svelte 5
- See **MIGRATION.md** for the full process

---

## HTML Rules

- Follow the **WHATWG HTML Living Standard**
- ❌ No XHTML or XML-style syntax
- ❌ No deprecated elements or attributes
- Prefer semantic, accessible HTML

See **HTML_LIVING_STANDARD.md** for details.

---

## Progressive Web App (PWA)

This is a **PWA-first application**.

All changes must preserve:
- Installability
- Service worker registration
- Offline / caching behavior
- Manifest validity

PWA regressions are considered **breaking changes**.

See **PWA.md** for full rules.

---

## Required Reading

Before making *any* changes, you must read:

- README.md
- CONTRIBUTING.md
- AI_GUARD.md
- ARCHITECTURE.md
- MIGRATION.md
- HTML_LIVING_STANDARD.md
- PWA.md

If there is a conflict, **CI enforcement wins**.

---

## Tooling & Verification

After **any** code change:

```sh
npm run check
npm run lint
npx eslint
```

All must pass with **zero errors or warnings**.

Never suppress or bypass failures.

---

## Getting Started (Reference)

This project was scaffolded using `sv`:

```sh
# create a new project in the current directory
npx sv create

# create a new project in a new folder
npx sv create my-app
```

---

## Final Note

This repository prioritizes:
- Long-term maintainability
- Predictable behavior
- CI safety
- PWA correctness

When in doubt:
**STOP and ask instead of guessing.**
