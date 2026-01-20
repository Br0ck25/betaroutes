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
<img src="/logo.png" alt="Logo" /> <input disabled />
```

---

## Boolean Attributes

Boolean attributes:

- MUST NOT have values
- MUST NOT use `="true"` or `="false"`

Correct:

```html
<input disabled /> <button autofocus></button>
```

Incorrect:

```html
<input disabled="disabled" /> <input disabled="true" />
```

---

## Svelte-Specific Rules

Svelte components must output valid HTML Living Standard markup.

### Syntax Rules

- Do NOT use XHTML syntax in `.svelte` files
- Non-void elements must NOT be self-closing

Correct:

```svelte
<div class="container"></div><p>Text</p>
```

Incorrect:

```svelte
<div class="container" /> <!-- Invalid! --><p /> <!-- Invalid! -->
```

### Boolean Attributes in Svelte

Svelte has its own syntax for boolean attributes that compiles to valid HTML:

Correct:

```svelte
<input disabled={isDisabled} />
<!-- Compiles correctly -->
<input disabled={true} />
<!-- Compiles correctly -->
<input disabled />
<!-- Static true -->
```

Incorrect:

```svelte
<input disabled="true" />
<!-- String, not boolean! -->
<input disabled={false} />
<!-- Use conditional rendering instead -->
```

### Conditional Boolean Attributes

For conditional boolean attributes, use Svelte's reactive syntax:

```svelte
<button disabled={!isValid}>Submit</button>
<input required={fieldIsRequired} />
```

Do NOT use string values for boolean attributes.

---

## Accessibility

- Use proper labels for form controls
- Use `alt` text for images
- Prefer native elements over ARIA where possible
- Ensure keyboard navigation works correctly

---

## Enforcement

Violations will fail:

- Linting
- Pre-commit hooks
- CI

These rules are **non-negotiable**.

---

## Migration Note

When migrating Svelte 4 → Svelte 5:

- Verify all HTML output remains valid
- Check that boolean attributes compile correctly
- Ensure no XHTML syntax was introduced
- Test accessibility features after migration
