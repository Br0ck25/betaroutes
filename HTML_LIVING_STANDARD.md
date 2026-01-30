# HTML Living Standard Rules

This project follows the **HTML Living Standard (WHATWG)** exclusively.

These rules are enforced by linting, pre-commit hooks, and CI. **Violations fail the build.**

---

## General rules

- Use **lowercase** tag names and attribute names.
- Prefer **semantic HTML** (`main`, `section`, `nav`, `article`, `header`, `footer`, etc.).
- Write **valid HTML**: proper nesting, no missing end tags, no duplicate `id`s.
- **No deprecated HTML**: do not use `<center>`, `<font>`, or the `align` attribute.

---

## Non-void elements must not self-close (Svelte 5 critical)

**No XHTML:** self-closing syntax on **non-void** elements is **FORBIDDEN**.

✅ Correct:

```html
<div></div>
<span></span>
<script></script>
```

❌ Incorrect:

```html
<div />
<span />
<script />
```

**Why this matters:** Svelte 5’s parser is strictly HTML-compliant. `<div />` is treated as an **opening `<div>`** that can accidentally swallow the rest of the page.

---

## Void elements

Void elements do **not** have closing tags.

Void elements are:

- `area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`
- `link`, `meta`, `param`, `source`, `track`, `wbr`

**Project style:** do not use a trailing slash. (A trailing slash is technically tolerated by HTML for void elements, but we standardize on the HTML-style form.)

✅ Correct:

```html
<img src="/logo.png" alt="Logo" />
<input disabled />
<br />
```

---

## Boolean attributes

In HTML, boolean attributes are **presence-only**:

- Present = `true`
- Absent = `false`
- They MUST NOT have values (`="true"` / `="false"` is forbidden)

✅ Correct:

```html
<input disabled /> <button autofocus></button>
```

❌ Incorrect:

```html
<input disabled="true" /> <input disabled="false" />
```

---

## Svelte rules for boolean attributes (strict)

Svelte handles boolean attributes correctly **only if you use expression syntax**.

✅ Correct:

```svelte
<button disabled={isSubmitting}>Submit</button>
<input disabled={isDisabled} />
<input disabled />
<!-- always disabled -->
```

❌ Incorrect (string values / “always present” bugs):

```svelte
<button disabled={isSubmitting}>Submit</button>
<button disabled={isSubmitting ? 'true' : 'false'}>Submit</button>
<input disabled="false" />
```

---

## Security & injection rules

- `{@html ...}` is **restricted** by `SECURITY.md`. If raw HTML is ever required, it MUST be **sanitized server-side** before it reaches the client.
- Never place user-controlled input directly into `href` / `src` without validation (block `javascript:` and other unsafe schemes).
- If you use `target="_blank"`, you MUST also set `rel="noopener noreferrer"`.

---

## Enforcement

Violations will fail via:

- `eslint-plugin-svelte` (strict parsing)
- pre-commit hooks
- CI checks

These rules are non-negotiable.
