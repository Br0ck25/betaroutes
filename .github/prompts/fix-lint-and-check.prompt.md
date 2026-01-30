---
name: 'fix-quality-gate'
description: 'Fix lint + check failures without shortcuts.'
agent: 'Strict Svelte 5 Implementer'
argument-hint: 'Paste errors from eslint/svelte-check/tsc'
---

Fix the reported errors.
Rules:

- No disabling rules.
- No any.
- Minimal diffs.
  Return:
- The precise edits to resolve each error
- Why each fix is correct
- Verification commands
