# Architecture Decision Records

This document records key architectural decisions and the rationale behind them.

**DO NOT question or change these decisions unless explicitly requested.**

---

## ADR-001: Gradual Migration to Svelte 5

**Status:** Active

**Context:**

- Project built with Svelte 4
- Svelte 5 offers better reactivity and performance
- Full rewrite is too risky and time-consuming

**Decision:**

- Migrate incrementally from Svelte 4 to Svelte 5
- Allow both versions to coexist during transition
- All new code must be Svelte 5
- Existing code migrates only when necessary or requested

**Rationale:**

- Maintains working application at all times
- Reduces risk of regressions
- Allows learning Svelte 5 patterns gradually
- Prevents "big bang" migration failures

**Consequences:**

- Mixed codebase during transition period
- Need clear rules for when to migrate
- Potential for confusion about which syntax to use
- Requires discipline to not migrate opportunistically

**See:** `svelte-mixed-migration-agent.md`

---

## ADR-002: PWA-First Architecture

**Status:** Active

**Context:**

- Users need offline functionality
- App should work on mobile devices
- Installation provides better UX

**Decision:**

- Build as Progressive Web App
- Maintain strict PWA compliance
- Never break offline functionality
- Service worker is critical infrastructure

**Rationale:**

- Offline-first provides better UX
- Installation increases engagement
- Works across platforms without app stores
- Future-proof for mobile usage

**Consequences:**

- Service worker must always work
- Offline behavior must be tested
- Manifest.json is sacrosanct
- Migration cannot break PWA features

**See:** `PWA.md`

---

## ADR-003: HTML Living Standard Only

**Status:** Active

**Context:**

- Multiple HTML standards exist
- XHTML syntax is common but deprecated
- Svelte syntax can look like JSX

**Decision:**

- Follow WHATWG HTML Living Standard exclusively
- No XHTML syntax
- No self-closing non-void elements
- Boolean attributes without values

**Rationale:**

- Living Standard is actively maintained
- Eliminates confusion about which standard
- Ensures browser compatibility
- Prevents invalid HTML

**Consequences:**

- No `<div />` syntax (even though Svelte allows it)
- Must use `disabled` not `disabled="true"`
- Requires vigilance during code generation
- AI agents must be specifically instructed

**See:** `HTML_LIVING_STANDARD.md`

---

## ADR-004: Strict Color Palette

**Status:** Active

**Context:**

- Visual consistency is important
- Ad-hoc color choices lead to design drift
- Brand colors must be enforced

**Decision:**

- Define approved color palette
- No colors outside the palette
- No opacity tricks to create new colors
- Enforce through code review

**Rationale:**

- Maintains brand consistency
- Prevents visual chaos
- Simplifies design decisions
- Makes refactoring easier

**Consequences:**

- Limited color choices
- May need palette updates for new features
- Requires discipline to not "just use" a color
- AI agents must check palette before suggesting colors

**See:** `DESIGN_SYSTEM.md`

---

## ADR-005: Governance-First Development

**Status:** Active

**Context:**

- Multiple conflicting rules can exist
- AI agents need clear precedence
- Humans need conflict resolution process

**Decision:**

- Create explicit rule hierarchy
- Document all governance rules
- PWA/HTML/Design trump migration preferences
- STOP and ask when rules conflict

**Rationale:**

- Prevents "best practice" drift
- Gives AI agents clear decision framework
- Reduces rework from rule violations
- Makes expectations explicit

**Consequences:**

- More documentation to maintain
- Rules must be kept consistent
- May slow initial development
- Requires discipline to follow process

**See:** `GOVERNANCE.md`

---

## Folder Structure

project/
├── src/
│ ├── lib/
│ │ ├── components/ # Reusable components (mixed Svelte 4/5)
│ │ ├── stores/ # State management (mixed Svelte 4/5)
│ │ └── utils/ # Utility functions
│ ├── routes/ # SvelteKit routes (mixed Svelte 4/5)
│ └── service-worker.js # PWA service worker
├── static/ # Static assets
│ └── manifest.json # PWA manifest
└── [governance docs] # All .md files

**Rules:**

- Do NOT restructure without explicit approval
- Migration does not require restructuring
- Keep related files together

---

## State Management

**Current approach:**

- Svelte stores (writable, derived, readable)
- Some components use local reactive statements

**During migration:**

- New code can use `$state`, `$derived`, `$effect`
- Existing stores remain unchanged
- New stores can be Svelte 5 runes or traditional stores

**Do NOT:**

- Replace working stores unnecessarily
- Introduce new state management libraries
- Change store APIs during migration

---

## Styling Approach

**Current approach:**

- [Document your styling approach: Tailwind/vanilla CSS/CSS modules/etc.]

**Rules:**

- Only approved colors from DESIGN_SYSTEM.md
- Migration should not change styling unnecessarily
- Keep existing styling approach unless explicitly changed

---

## Questions About Architecture?

If an architectural decision seems wrong or outdated:

1. **Don't change it immediately**
2. Open an issue with `architecture-question` label
3. Propose alternative with rationale
4. Wait for discussion and approval

Architecture exists for a reason. Understand it before changing it.
