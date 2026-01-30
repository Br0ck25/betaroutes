---
name: 'create-svelte5-component'
description: 'Generate a new Svelte 5 runes component (strict).'
agent: 'Strict Svelte 5 Implementer'
argument-hint: 'component=Name props=... behavior=... styling=...'
---

Create a new Svelte component using Svelte 5 runes only.

- Follow /AGENTS.md and all instructions files.
- No legacy patterns, no placeholders.
- Include typed props via $props().
- Use onclick= for DOM events.
  Return:
- File path + full component code
- Any supporting types/helpers needed
- Verification steps
