# sv — SvelteKit App

Everything you need to build and maintain this **SvelteKit + Svelte 5** project,
powered by [`sv`](https://github.com/sveltejs/cli).

---

## ⚠️ Project Conventions (Important for GitHub Copilot)

This repository enforces **strict frontend standards**.  
GitHub Copilot (Raptor Mini) **must follow these rules** when adding or modifying code.

Violations will fail **linting, pre-commit hooks, and CI**.

---

## HTML

- Follow the **HTML Living Standard (WHATWG)** only
- ❌ No XHTML or XML-style syntax
- ❌ No deprecated elements or attributes
- ❌ No self-closing non-void elements
- Use lowercase tag and attribute names
- Prefer semantic HTML (`main`, `section`, `nav`, `article`, etc.)

---

## Svelte

- **Svelte 5 only**
- Use **runes-based reactivity exclusively**:
  - `$state`
  - `$derived`
  - `$effect`

### Forbidden (No Exceptions)

- ❌ `svelte/store`
- ❌ `$:` reactive labels
- ❌ `onMount`, `beforeUpdate`, `afterUpdate`
- ❌ `createEventDispatcher`
- ❌ Legacy component instantiation (`new Component()`)

### Required Patterns

- Props via `$props()`
- DOM events via standard attributes (`onclick`, not `on:click`)
- Component communication via callback props
- Slots replaced with **snippets** and `{@render}`

These rules are **non-negotiable**.

---

## Creating a Project

If you're seeing this, the project has likely already been created. 🎉  
For reference, this project was scaffolded using `sv`:

```sh
# create a new project in the current directory
npx sv create

# create a new project in a new folder
npx sv create my-app
```
