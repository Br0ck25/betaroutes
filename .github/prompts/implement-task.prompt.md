---
name: 'implement'
description: 'Implement a feature or bugfix with strict quality gates.'
agent: 'Strict Svelte 5 Implementer'
argument-hint: 'Goal + acceptance criteria + files touched'
---

Implement the request with minimal diffs.
Requirements:

- No any, no ts-ignore, no lint disables, no TODOs.
- Update/add tests if behavior changes.
  Output:
- Exact file edits (full code where changed)
- Commands: npm run lint, npm run check, npm test
