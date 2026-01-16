# Architecture

## Target Architecture (Svelte 5)

This project targets **Svelte 5** as the final, stable architecture.

### Core Principles

- UI is composed of **Svelte 5 components**
- State is managed with **runes-based reactivity**
- Side effects are explicit and isolated
- Component communication is explicit and predictable
- No framework-agnostic abstraction layers

### Reactivity Model

- `$state` — mutable local or shared component state
- `$derived` — computed values derived from state
- `$effect` — side effects reacting to state changes

No other reactivity mechanisms are permitted.

---

## Event & Communication Model

- DOM events use **standard HTML attributes** (`onclick`, `oninput`, etc.)
- Component-to-component communication uses **callback props**
- No event dispatchers or global event buses

❌ `createEventDispatcher` is forbidden  
❌ Implicit side effects are forbidden

---

## Migration Architecture (Critical)

This repository is a **mixed Svelte 4 / Svelte 5 codebase** during migration.

### File-Level Isolation

Each `.svelte` file must be in **exactly one state**:

#### Legacy (Svelte 4)

- Explicitly marked with:
  ```html
  <!-- MIGRATION: SVELTE4-LEGACY -->
  ```
- Legacy syntax allowed temporarily
- Bug fixes only
- No refactors or new features

#### Migrated (Svelte 5)

- No migration marker
- Uses runes-based reactivity exclusively
- Represents the final architectural state

❌ Never mix legacy and runes syntax in the same file  
❌ Never partially migrate a file  
❌ Never remove a migration marker without completing migration

If legacy syntax exists without a marker: **STOP**

---

## Forbidden Patterns (All Files)

The following are permanently forbidden:

- `svelte/store`
- `$:` reactive labels
- `onMount`, `beforeUpdate`, `afterUpdate`
- `createEventDispatcher`
- Class-style component instantiation (`new Component()`)
- React hooks or React-inspired patterns
- Framework-agnostic abstraction layers

---

## HTML Architecture

- Markup follows the **HTML Living Standard (WHATWG)**
- Semantic HTML is required
- Accessibility is non-negotiable
- Markup changes must not alter semantics unless explicitly required

❌ No XHTML or XML-style syntax  
❌ No deprecated elements or attributes

---

## PWA Architecture

This application is **PWA-first**.

Architectural requirements:

- Service worker must remain registered and functional
- Offline behavior must be preserved
- Caching strategy must remain correct
- `manifest.json` must remain valid and complete
- Installability must not regress

Any architectural change that weakens PWA behavior is disallowed.

---

## Architectural Guardrails

- Prefer explicitness over abstraction
- Prefer local state over shared state
- Prefer simple composition over indirection
- Prefer standards over framework magic

If an architectural decision is unclear:
**STOP and ask before proceeding.**
