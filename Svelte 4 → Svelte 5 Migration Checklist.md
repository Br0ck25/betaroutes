# Svelte 4 → Svelte 5 Migration Checklist (Repo Order of Operations)

Use this as the **single source of truth** for "what needs to happen, in what order" for this codebase.

> Key repo rule: **do not migrate files unnecessarily**. Keep PRs small and scoped.

---

## 0) Before you start (prep)

- [x] Create a migration branch (**one theme per PR**)
- [x] Branch name example: `chore/svelte5-migrate-events` / `chore/svelte5-migrate-props`
- [x] Confirm local Node version matches the repo requirement (Node `>= 22`)
- [x] Run the baseline quality gate **before changes** (establish a "green" baseline)
  - [x] `npm run gate` (typecheck + lint + unit tests)
- [ ] **Read governance docs when touching sensitive areas**
  - [ ] Read `SECURITY.md` **before** migrating any component that handles user data (auth, trips, expenses, settings)
  - [ ] Read `REPOSITORY_GOVERNANCE.md` + `AGENTS.md` and follow repo priority order (Security > PWA > Architecture > Svelte 5 Standards > HTML Standards > Design System > Code Style)
  - [ ] (Supplemental) Read `ERROR_PATTERNS_AND_STOP_CONDITIONS.md` for known failure modes and stop rules
- [ ] **Understand the "all or nothing per file" rule**
  - [ ] Once a file enters runes mode (uses `$state`, `$props`, `$derived`), ALL legacy patterns must be migrated in that file
  - [ ] You cannot use `$state()` alongside `export let` in the same file
  - [ ] You cannot use `$derived()` alongside `$:` in the same file
  - [ ] You cannot use `$props()` alongside `createEventDispatcher` in the same file
  - [ ] Slots should migrate when the component migrates to runes mode
  - [ ] **Runes mode is all-or-nothing per file** (but mixed usage across different files during migration is fine)
- [ ] **Scope Check:** Am I migrating this _entire_ file? (If no, do NOT change syntax to Svelte 5 runes/events/props in that file)
- [ ] Ecosystem compatibility sweep (do once up front; repeat if you add new deps)
  - [ ] List third-party Svelte libraries/components used in the UI and confirm Svelte 5 compatibility
  - [ ] Search for legacy patterns that break in Svelte 5:
    - [ ] `new Component(...)` instantiation / component class instance APIs (`$on`, `$set`, `$destroy`)
    - [ ] heavy `<slot>` usage in shared components (plan snippet migration later)
- [ ] **Check for two-way binding patterns that will break**
  - [ ] `bind:value` on component props (requires `$bindable()` in Svelte 5)
  - [ ] `bind:this` usage (works differently in Svelte 5)
  - [ ] Custom store bindings (may need refactoring)
- [ ] Quick repo-wide "grep" inventory (fast, high value)
  - [ ] Mixed `on:` and `on...` event syntax in the same file (migrate consistently per-file to avoid weird compiler errors)
  - [ ] `<script context="module">` usage (convert to `<script module>` when you touch those files)
  - [ ] `svelte:window`, `svelte:document`, `svelte:body` usage (events migrate to `on...` attributes; watch passive events)
  - [ ] `createEventDispatcher` usage (needs manual refactor to callback props)
  - [ ] `on:` event syntax (convert to `onclick` etc.)
  - [ ] `$app/stores` usage (migrate to `$app/state` if present)
  - [ ] `beforeUpdate/afterUpdate` usage (disallowed in runes mode)
  - [ ] `$$props` and `$$restProps` usage (migrate to `$props()` with rest syntax)
  - [ ] `<slot>` / `$$slots` usage (migrate to snippets when file enters runes mode)
  - [ ] `bind:` to component exports (breaks in runes mode — must switch to `bind:this`)
  - [ ] `:is(...)`, `:has(...)`, `:where(...)` selectors (scoping behavior changed in Svelte 5)
  - [ ] `immutable: true` component option (ignored in runes mode)
- [ ] Choose the scope for _this_ PR (pick exactly one "theme")
  - [ ] Events migration (`on:...` → `on...`)
  - [ ] Props migration (`export let` → `$props()`)
  - [ ] Reactivity migration (`$:` → `$derived/$effect`, `let` → `$state`)
  - [ ] Lifecycle migration (`onMount/beforeUpdate/afterUpdate` → `$effect/$effect.pre`)
  - [ ] Dispatcher migration (`createEventDispatcher` → callback props)
  - [ ] Slots/snippets migration (only when migrating a file to runes mode)
  - [ ] `$app/stores` → `$app/state` (if present)
  - [ ] Shared state modules (`.svelte.js/.svelte.ts`) (only if you're refactoring stores)
  - [ ] PWA or auth/session-related changes (**high risk: smallest PRs only**)

### 0.1 One-time config audit (do once up front)

- [x] Review `svelte.config.*` and `vite.config.*` for Svelte 5 behavior changes
  - [x] Remove or document deprecated/ignored compiler options (avoid "it worked in Svelte 4" assumptions)
  - [x] If you relied on `accessors: true` or instance props, note that **runes mode ignores accessors** — Confirmed: no repo code relies on accessors; `svelte.config.js` enforces `runes: true`, and the gate (check + lint + tests + build) is green.

### 0.2 Store-to-runes interop plan (if `svelte/store` remains)

- [x] Decide the bridge strategy for any remaining `svelte/store` usage — **Migrate to `.svelte.ts` modules** (documented below)
  - [ ] Keep stores temporarily (no refactor in this PR)
  - [x] Migrate shared state into `.svelte.ts/.svelte.js` runes modules — priority order: `user` (done) → `auth` → `trips` → `expenses` & `mileage` → `sync`, `toast`, misc.
- [x] Enforce: **no new `svelte/store` usage** during the migration (ESLint + CI guard added)
- [x] Migrate transitional helpers: `src/routes/dashboard/settings/lib/save-settings.ts` and `src/lib/services/googleMaps.ts` (done)

Notes:

- Migration pattern: convert one store per PR, export typed `$state` or a small typed class (see `src/lib/stores/user.svelte.ts`). Replace consumers in the same PR and add unit tests; run `npm run gate`.
- Enforcement: `eslint.config.js` now forbids `svelte/store` imports outside `src/lib/stores/**`. Additionally, a lightweight CI guard (`tools/check-no-legacy-stores.js`) runs as part of `npm run lint` to prevent accidental imports during the transition.

---

## 1) Dependency + tool migrations (only if needed)

> If the repo is already on Svelte 5 + SvelteKit 2, you may skip to section 2.

- [ ] Update SvelteKit to a Svelte 5-compatible version (SvelteKit 2+)
- [ ] Update `svelte` to `^5`
- [ ] Run the official migrator
  - [ ] `npx sv migrate svelte-5`
  - [ ] Search and track `@migration` follow-ups created by tooling
- [ ] Fix invalid self-closing non-void tags
  - [ ] `npx sv migrate self-closing-tags`
- [ ] If you use `$app/stores` **anywhere**
  - [ ] `npx sv migrate app-state`

### 1.1 Cloudflare Pages / adapter sanity (early)

- [ ] If `_routes.json` exists in the build output or repo:
  - [ ] Confirm your Cloudflare adapter routes configuration is correct (avoid build-time route configuration errors)
  - [ ] Confirm Pages build settings match your repo output directory and adapter usage

---

## 2) Stabilize build + CI (must be green before deeper refactors)

- [ ] Run the quality gate
  - [ ] `npm run gate`
- [ ] Run a build and do a **warnings review**
  - [ ] `npm run build`
  - [ ] Scan build output for Svelte 5 warnings and fix what you touch in this PR
  - [ ] Treat new compiler warnings as regressions; fix them rather than suppressing
  - [ ] **Do not suppress warnings**. `<!-- svelte-ignore ... -->` is **forbidden unless explicitly approved** (document the approval in the PR).

- [ ] Module scripts sanity
  - [ ] If you touch a file with `<script context="module">`, convert it to `<script module>`
  - [ ] Ensure any module-level side effects remain SSR-safe (no `window`, `document` access)
- [ ] Resolve migration markers created by tooling
  - [ ] `@migration` comments
  - [ ] `svelte/legacy` helper usage (allowed temporarily, but track for cleanup)
- [ ] Confirm stricter syntax rules won't bite you
  - [ ] Attribute/prop values: concatenated values must be quoted (runes mode is stricter)
  - [ ] HTML structure: Svelte 5 errors where browsers used to "repair" invalid HTML (e.g., table/tbody issues)
  - [ ] CSS scoping: selectors in `:is(...)`, `:has(...)`, `:where(...)` are now analyzed/scoped (use `:global(...)` inside if needed)
- [ ] PWA safety check (don't regress install/offline)
  - [ ] Confirm you did not change SW/manifest unless this PR is explicitly about PWA
  - [ ] Verify install + offline reload still works on at least one key route (see section 4.2)
  - [ ] Confirm SW caching still does **not** cache sensitive API responses

---

## 3) Migrate syntax incrementally (repeatable per PR)

### Recommended PR order (lowest risk → highest risk)

Do these in order unless there's a functional reason to deviate:

1. [ ] Events
2. [ ] Props
3. [ ] Reactivity (state/derived/effect)
4. [ ] Lifecycle (onMount/beforeUpdate/afterUpdate → $effect)
5. [ ] Component events (remove `createEventDispatcher`)
6. [ ] Shared state modules (`.svelte.js/.svelte.ts`) (optional)
7. [ ] Slots → snippets (when file enters runes mode)
8. [ ] Auth/session/PWA-adjacent components (**highest risk**)

---

## 3.1 Events migration PR (on: → on\*)

- [ ] Convert DOM events
  - [ ] `on:click` → `onclick`
  - [ ] `on:input` → `oninput`
  - [ ] `on:submit` → `onsubmit`
  - [ ] `on:change` → `onchange`
- [ ] Per-file consistency
  - [ ] Do not mix `on:` directives and `on...` event attributes in the same file; migrate events consistently per-file
- [ ] Capture-phase handlers (when needed)
  - [ ] Use the `capture` attribute with event attributes (e.g., `onkeydown capture={...}`) and re-test ordering
- [ ] Replace event modifiers (manual)
  - [ ] `|preventDefault` → call `event.preventDefault()` inside handler
  - [ ] `|stopPropagation` → call `event.stopPropagation()` inside handler
- [ ] Special elements (`svelte:window` / `svelte:document` / `svelte:body`)
  - [ ] Convert `on:keydown` → `onkeydown`, etc., and re-test global shortcuts
  - [ ] If you rely on `preventDefault()` for scroll/touch, ensure you're using a non-passive listener
- [ ] Touch/wheel passive-default gotcha (mobile & scroll-heavy UIs)
  - [ ] `onwheel`, `onmousewheel`, `ontouchstart`, `ontouchmove` handlers are passive by default
  - [ ] Docs nuance: `ontouchstart/ontouchmove` are passive (and `onwheel/onmousewheel` are also passive per the migration guide)
  - [ ] If you see `Unable to preventDefault inside passive event listener` warnings, switch to a non-passive listener via an action/`on(...)`
  - [ ] If you must prevent default scrolling, use a non-passive listener via an action or `on(...)` helper
- [ ] Run `npm run gate`

---

## 3.2 Props migration PR (`export let` → `$props()`)

- [ ] Convert props to `$props()` destructuring
  - [ ] `export let foo` → `let { foo } = $props()`
  - [ ] Provide defaults in destructure (`foo = defaultValue`)
  - [ ] Use rest syntax for remaining props: `let { foo, ...rest } = $props()`
- [ ] Replace `$$props` and `$$restProps`
  - [ ] `$$props` → `let props = $props()`
  - [ ] `$$restProps` → `let { ...rest } = $props()`
- [ ] Type props explicitly (TypeScript)
  - [ ] Use `$props<YourPropType>()` (or inline prop typing)
- [ ] Avoid reserved collisions
  - [ ] Rename any prop named `children` (reserved by snippets)
- [ ] Runes mode breaking changes to account for (if/when the component is in runes mode)
  - [ ] Bindings to component exports are **not allowed** (`<A bind:foo />` where `foo` is `export const foo = ...`)
    - [ ] Replace with `bind:this` and access exports from the instance (`a.foo`)
  - [ ] `accessors: true` is ignored in runes mode (props are never on the instance; use exports if you need instance access)
  - [ ] `bind:` to props requires `$bindable()` (props are not bindable by default)
  - [ ] Cannot reassign entire `$props()` object, only individual properties
- [ ] Run `npm run gate`

---

## 3.3 Reactivity migration PR (state → `$state`, `$:` → `$derived/$effect`)

- [ ] Convert reactive state (when migrating a component to runes)
  - [ ] `let x = 0;` → `let x = $state(0);`
- [ ] Convert derivations
  - [ ] `$: total = a + b;` → `const total = $derived(a + b);`
- [ ] Convert side effects
  - [ ] `$: if (x) doThing();` → `$effect(() => { if (x) doThing(); });`
- [ ] Use `$effect.pre()` for effects that need to run before DOM updates
- [ ] Use `$effect.tracking()` for conditional effect dependencies
- [ ] Use `$inspect()` for debugging reactive state during migration
- [ ] SSR vs browser correctness check (**important**)
  - [ ] Confirm you did **not** move SSR-required logic into `$effect` (effects run after mount; SSR behavior differs)
- [ ] Class "auto-reactive" gotcha
  - [ ] In Svelte 5, mutating `foo.value` on a class instance does **not** automatically trigger updates
  - [ ] Use `$state` fields inside the class (or use a plain object/array state proxy)
- [ ] `$state` destructuring gotcha
  - [ ] Avoid destructuring reactive proxies (destructured values are not reactive)
  - [ ] Use `let state = $state({ count: 0 })` and access `state.count`, NOT `let { count } = $state({ count: 0 })`
- [ ] Use `$state.frozen()` for immutable data that won't change
- [ ] Remove `svelte/legacy` `run(...)` usage where you can (cleanup pass)
- [ ] Re-test whitespace-sensitive UI (Svelte 5 whitespace behavior can change; consider `preserveWhitespace` only if truly needed)
- [ ] Whitespace regression watchlist (quick visual scan)
  - [ ] Spacing around inline text + icons/buttons
  - [ ] Table cell wrapping/alignment
  - [ ] `pre/code` blocks preserve formatting
- [ ] Run `npm run gate`

---

## 3.4 Lifecycle migration PR (`onMount/beforeUpdate/afterUpdate` → `$effect`)

- [ ] Identify lifecycle hook usage
  - [ ] `onMount` → **forbidden in this repo**; use `$effect(() => { ... })` with cleanup and guard browser-only work
  - [ ] `beforeUpdate` → **NOT AVAILABLE in runes mode**, use `$effect.pre()`
  - [ ] `afterUpdate` → **NOT AVAILABLE in runes mode**, use `$effect()`
- [ ] Replace `beforeUpdate` with `$effect.pre()`
  - [ ] `beforeUpdate(() => { ... })` → `$effect.pre(() => { ... })`
- [ ] Replace `afterUpdate` with `$effect()`
  - [ ] `afterUpdate(() => { ... })` → `$effect(() => { ... })`
- [ ] Convert `onMount` to `$effect()` if cleanup is needed
  - [ ] `onMount(() => { setup(); return cleanup; })` → `$effect(() => { setup(); return cleanup; })`
- [ ] `onDestroy` → return cleanup function from `$effect()` instead
  - [ ] `onDestroy(() => { cleanup(); })` → `$effect(() => { return () => cleanup(); })`
- [ ] Run `npm run gate`

---

## 3.5 Component events PR (`createEventDispatcher` → callback props)

- [ ] Identify dispatcher usage
  - [ ] `createEventDispatcher()` imports
  - [ ] `dispatch('event', payload)` calls
- [ ] Replace with callback props
  - [ ] Define callback prop in `$props()`: `let { onSave } = $props()`
  - [ ] Replace `dispatch('save')` with `onSave?.(payload)`
- [ ] Update parent components accordingly
- [ ] Run `npm run gate`

---

## 3.6 Shared state modules PR (optional): migrate shared state without `svelte/store`

Use this when you're refactoring shared state out of component top-level, or modernizing store-based shared state.

- [ ] Identify shared state candidates (things currently in `svelte/store`, or logic you want reusable)
- [ ] Create a `.svelte.ts` (or `.svelte.js`) module for shared reactive state
- [ ] Follow the export rule:
  - [ ] You can export `$state` from a `.svelte.ts/.svelte.js` file only if it's not directly reassigned by importers
  - [ ] Prefer exporting state wrapped in an object, and mutate properties rather than reassigning the exported binding
- [ ] Add tests around shared state if it affects auth/session, routing, or persistence
- [ ] Run `npm run gate`

---

## 3.7 Slots → snippets PR (when file enters runes mode)

> **Repo rule:** `<slot>` and snippets CAN coexist **across different files**, but NOT in the same file once that file is in runes mode.
>
> - Legacy files can keep `<slot>` until migrated
> - Once a file uses runes, ALL slots in that file should migrate to snippets
> - Mixed `<slot>` + snippets usage across the codebase is fine during transition
> - Only migrate slots when you're ready to migrate the entire component to runes mode

**Migration approach:**

- [ ] Slots are the LAST thing to migrate (after events, props, reactivity, dispatchers, lifecycle)
- [ ] When migrating a component to runes mode, migrate its slots at the same time
- [ ] Inventory slot usage (`<slot>`, `slot="name"`, `let:`)
- [ ] Migrate one component + its direct callers per PR
  - [ ] Default slot → `children` snippet + `{@render children?.()}`
  - [ ] Named slots → snippets + `{@render name?.(...)}`
- [ ] Confirm interop boundaries
  - [ ] Snippets can be passed to slot-components, but not the reverse once you render snippets
- [ ] Run `npm run gate`

---

## 4) High-risk areas (do last; smallest PRs)

### 4.1 Auth/session storage rules (do not regress)

- [ ] No tokens/passwords stored in localStorage/IndexedDB
- [ ] Cookie settings remain secure (httpOnly/secure/sameSite as appropriate)
- [ ] No sensitive info logging in production (addresses, financial amounts, secrets)

### 4.2 PWA/offline manual verification (when applicable)

Run these steps any time you migrate a user-facing page or modify navigation/layout:

- [ ] Installability
  - [ ] App still offers install (where supported) and installs successfully
- [ ] Offline reload test
  - [ ] Open DevTools → Application → Service Workers
  - [ ] Enable "Offline" (or Network tab offline)
  - [ ] Reload the page and navigate core routes
  - [ ] Confirm essential UX still works (expected offline behavior)
- [ ] Caching safety
  - [ ] Confirm the service worker does **not** cache authenticated/sensitive API responses

### 4.3 Migration Safety Checks (Repo Specific)

- [ ] **Security:** If the component fetches or mutates data, verify ownership/authorization checks are preserved (e.g., compare by `user.id`, never by username fallback)
- [ ] **HTML Standard:** Ensure no self-closing non-void elements (e.g., change `<div />` to `<div></div>`), and keep boolean attributes correct
- [ ] **PWA:** If the component loads/syncs data, verify offline behavior is preserved (DevTools Offline) and that moving from `onMount` → `$effect` did not break timing for Service Worker cache, IndexedDB, or sync logic
- [ ] **Design System:** Replace hardcoded hex/rgb values with approved CSS variables (e.g., `var(--color-text-primary)`) per `DESIGN_SYSTEM.md`
- [ ] **Data Privacy:** Search for and remove `console.log` statements (prevents accidental logging of trip/auth/financial data)
- [ ] **No new security regressions:** Do not introduce `{@html ...}` or store secrets/tokens in localStorage/IndexedDB

---

## 5) Per-PR finish criteria

- [ ] `npm run gate` passes
- [ ] Warnings review complete (`npm run build` and check output)
- [ ] E2E run (required when UI routes/flows change)
  - [ ] `npx playwright test` (or your repo's e2e command)
- [ ] Keyboard + focus verification (when UI behavior changes)
  - [ ] Form submit/validation focuses the correct field
  - [ ] Modals restore focus on close
  - [ ] Global shortcuts do not fire while typing in inputs
- [ ] Hydration mismatch smoke test (SSR routes)
  - [ ] Load key SSR pages with DevTools console open — no hydration mismatch warnings
  - [ ] No client-only logic accidentally moved into SSR paths
- [ ] SSR smoke check (when relevant)
  - [ ] Confirm SSR pages render without hydration mismatches (watch console warnings)
- [ ] Security hygiene
  - [ ] `npm audit` shows **no critical vulnerabilities**
- [ ] PR checklist housekeeping
  - [ ] Explicitly list files migrated (if any)
  - [ ] Confirm no unnecessary migration happened
  - [ ] Confirm PWA/offline verified if relevant
- [ ] Track leftovers
  - [ ] Any `svelte/legacy` helpers or `@migration` notes are either removed or logged for follow-up

## 5.1) Common Migration Errors & Fixes

### Error: "Cannot use `export let` in runes mode"

**Cause:** Tried to use `$state()` in a file that still has `export let` props
**Fix:** Replace ALL `export let` with `$props()` in the same commit

### Error: "Legacy `$:` statement is not allowed in runes mode"

**Cause:** Tried to use `$derived()` in a file that still has `$:` reactive statements
**Fix:** Replace ALL `$:` with `$derived()` or `$effect()` in the same commit

### Error: "`createEventDispatcher` is not allowed in runes mode"

**Cause:** File has both `$props()` and `createEventDispatcher`
**Fix:** Replace dispatcher with callback props (e.g., `let { onSave } = $props()`)

### Error: "Property 'X' does not exist on type 'never[]'"

**Cause:** Untyped state initialization (`let items = $state([])`)
**Fix:** Add explicit type: `let items = $state<Item[]>([])` with `lang="ts"`

### Error: "Parse error" or "only refers to a type"

**Cause:** Using TypeScript syntax without `lang="ts"`
**Fix:** Add `<script lang="ts">` to the component

### Error: Component renders but slots don't work

**Cause:** Parent passes `<slot>` content to a component using `{@render children()}`
**Fix:** Parent must use snippet syntax when calling a Svelte 5 component

### Error: "`$$props` / `$$restProps` is not allowed in runes mode"

**Cause:** Component uses legacy `$$props` or `$$restProps` in a runes-mode file
**Fix:** Replace with `$props()` destructuring:

- `$$props` → `let props = $props()`
- `$$restProps` → `let { ...rest } = $props()`

### Error: "Slots/snippets mismatch between parent and child"

**Cause:** Parent uses legacy `<slot>`-style composition while child renders snippets with `{@render ...}` (or vice versa).
**Fix:** When a component enters runes mode, migrate **its** slots to snippets and update **direct callers** to pass snippets.

---

## 6) Whole-migration "done" criteria

- [ ] No `@migration` annotations remain
- [ ] No `svelte/legacy` usage remains (unless explicitly approved)
- [ ] No `$$props` or `$$restProps` usage remains
- [ ] No `beforeUpdate`/`afterUpdate` remain in runes-mode components
- [ ] All high-traffic components/pages are migrated where it provides value
- [ ] Dispatcher usage removed (callback props used instead)
- [ ] Shared state modernized where it provides value
- [ ] Slot-heavy shared components migrated to snippets where beneficial
- [ ] PWA install/offline works reliably across core flows
- [ ] Security invariants preserved (no sensitive caching/logging/storage regressions)

---

## 7) Release + rollout + rollback (optional but recommended)

These are not "Svelte 5 syntax" items, but they prevent migration work from turning into a production fire drill.

### 7.1 Release + rollback hygiene

- [ ] Tag the last known-good pre-migration commit (easy rollback target)
- [ ] Define the rollback plan (how to redeploy the last known-good build quickly)
- [ ] For core auth/navigation changes, consider a feature flag or staged rollout (if your stack supports it)

### 7.2 Browser + device matrix (PWA reality)

- [ ] Verify key flows on:
  - [ ] Chrome (desktop)
  - [ ] Chrome (Android)
  - [ ] Safari (iOS) — PWA/offline quirks often show up here first
  - [ ] Firefox (desktop)
- [ ] Confirm install/offline behavior on iOS if you support iOS users

### 7.3 Dependency lock + reproducibility

- [ ] Ensure lockfile changes are committed with migration PRs (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`)
- [ ] Do at least one clean "from-scratch" build per milestone
  - [ ] Remove `node_modules` and reinstall
  - [ ] Build + run tests to catch "works on my machine" drift

### 7.4 Observability + regression detection

- [ ] Add a short post-deploy validation checklist for each milestone
  - [ ] Login/logout
  - [ ] Core pages render without hydration warnings
  - [ ] Critical API calls succeed
  - [ ] Offline reload check (if applicable)
- [ ] Monitor errors/logs after deploy (Sentry/Cloudflare logs/etc.)
  - [ ] Define a simple "revert trigger" threshold (e.g., error spike or 5xx rate)

### 7.5 Migration governance (keep the team consistent)

- [ ] "No new legacy debt" rule in touched files
  - [ ] Don't introduce new `on:` directives in files you migrate to `on...`
  - [ ] Don't introduce new `createEventDispatcher` usage (use callback props)
  - [ ] Don't introduce new `svelte/store` usage if you're moving to runes/shared state modules
- [ ] Track remaining migration debt (keep a running list)
  - [ ] `@migration` notes
  - [ ] `svelte/legacy` helpers
  - [ ] `createEventDispatcher`
- [ ] Slots/snippets policy
  - [ ] `<slot>` and snippets can coexist **across different files** during migration
  - [ ] Within a single file: if using runes, migrate slots to snippets
  - [ ] Cross-file mixed usage is acceptable and expected during transition

## References (for humans)

- Repo Svelte 5 standards (single source of truth for new Svelte 5 files): `SVELTE5_STANDARDS.md`
- Canonical AI/router rules: `AGENTS.md`
- Recurring mistakes + stop rules: `ERROR_PATTERNS_AND_STOP_CONDITIONS.md`
- Svelte 5 migration guide: [Svelte v5 migration guide](https://svelte.dev/docs/svelte/v5-migration-guide)
- `$state` (incl. `.svelte.js/.svelte.ts` and cross-module state): [Svelte `$state` docs](https://svelte.dev/docs/svelte/$state)
- `sv migrate` CLI: [sv migrate CLI docs](https://svelte.dev/docs/cli/sv-migrate)
- Migration experience writeup: [Migrating from Svelte 4 to Svelte 5 — Villa Plus Engineering](https://medium.com/villa-plus-engineering/migrating-from-svelte-4-to-svelte-5-our-experience-and-lessons-learned-6d383947819b)
- Notes on Svelte 5 changes: [Notes on Svelte 5 changes](https://shivan.xyz/posts/svelte-5)
