Contributing Guidelines

These rules are mandatory and enforced by CI.

Any violation will result in a failing build.

General

All changes must begin from and end in a passing npm run check state

Do not commit changes that leave the repository in a broken or partially migrated state

HTML

Follow the HTML Living Standard exclusively

No XHTML syntax (including self-closing void misuse or XML-style attributes)

Semantic, standards-compliant markup is required

Svelte

Svelte 5 only

Runes-based reactivity only

No legacy Svelte patterns, including:

$: reactive statements

onMount

Svelte stores

Legacy lifecycle APIs

Violations of any rule above will fail CI.
