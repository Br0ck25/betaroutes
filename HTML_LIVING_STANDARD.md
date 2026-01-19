# HTML Living Standard Rules

This project follows the **HTML Living Standard (WHATWG)** exclusively.

These rules are enforced by linting, CI, and governance documents.

---

## General Rules

- Use lowercase tag and attribute names
- Use semantic HTML (`main`, `section`, `nav`, `article`, etc.)
- No XHTML or XML-style syntax
- No deprecated elements or attributes
- No self-closing non-void elements

---

## Void Elements (Self-Closing Allowed)

The following elements may be self-closing:

- `area`
- `base`
- `br`
- `col`
- `embed`
- `hr`
- `img`
- `input`
- `link`
- `meta`
- `param`
- `source`
- `track`
- `wbr`

Example:
```html
<img src="/logo.png" alt="Logo">
<input disabled>
```

---

## Boolean Attributes

Boolean attributes:

- MUST NOT have values
- MUST NOT use `="true"` or `="false"`

Correct:
```html
<input disabled>
<button autofocus>
```

Incorrect:
```html
<input disabled="disabled">
<input disabled="true">
```

---

## Accessibility

- Use proper labels for form controls
- Use `alt` text for images
- Prefer native elements over ARIA where possible

---

## Enforcement

Violations will fail:

- Linting
- Pre-commit hooks
- CI

These rules are **non-negotiable**.
