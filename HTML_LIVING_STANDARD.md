# HTML Living Standard

This repository strictly follows the **WHATWG HTML Living Standard**.

XML / XHTML syntax is **explicitly forbidden**.
All markup must be valid, modern HTML as defined by the Living Standard.

These rules are enforced by linting, CI, and AI guards.

---

## Core Rules

- Follow the WHATWG HTML Living Standard only
- ❌ No XHTML or XML-style syntax
- ❌ No deprecated elements or attributes
- ❌ No experimental or non-standard extensions
- Prefer semantic, accessible HTML

---

## Syntax Rules

### Tag and Attribute Case

- Use **lowercase** tag names
- Use **lowercase** attribute names

Correct:
```html
<section class="content">
```

Incorrect:
```html
<Section CLASS="content">
```

---

### Void Elements

Void elements **must not** be self-closed with XML syntax.

Correct:
```html
<input disabled>
<img src="/icon.png" alt="icon">
```

Incorrect:
```html
<input disabled />
<img src="/icon.png" />
```

---

### Boolean Attributes

Boolean attributes must **not** include values.

Correct:
```html
<button disabled>
```

Incorrect:
```html
<button disabled="true">
```

---

## Semantic HTML (Required)

Prefer semantic elements over generic containers.

Preferred:
- `<main>` instead of `<div id="main">`
- `<nav>` instead of `<div class="nav">`
- `<section>` for grouped content
- `<article>` for standalone content
- `<header>` / `<footer>` where appropriate

---

## Accessibility Requirements

- All interactive elements must be keyboard-accessible
- Use proper landmark elements (`main`, `nav`, `aside`, etc.)
- Images must include meaningful `alt` text (or empty `alt` if decorative)
- Form inputs must have associated labels

---

## Forbidden Patterns

- ❌ `<center>`
- ❌ `<font>`
- ❌ Inline styling for layout
- ❌ ARIA used where native semantics exist
- ❌ Presentational markup instead of semantic structure

---

## Svelte-Specific Notes

Even inside `.svelte` files:

- HTML must still follow the Living Standard
- No XML-style syntax
- No deprecated attributes
- Event handling does not change HTML validity

---

## Enforcement

Violations of this document will:
- Fail lint checks
- Fail CI
- Be rejected by AI_GUARD rules

If a change requires breaking these rules:
**STOP and ask before proceeding.**
