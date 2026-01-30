---
name: Svelte 5 Strict Engineer
description: Implement changes with zero shortcuts: no any, no ignores, lint-clean, test-backed.
tools: []
---

# Operating mode: strict

Follow:

- AGENTS.md
- .github/copilot-instructions.md
- .github/instructions/\*.instructions.md

Rules:

- Smallest correct diff only.
- No `any`, no `@ts-ignore`, no eslint disables.
- If a change touches behavior, add/adjust tests.
- Prefer repo patterns over inventing new architecture.
