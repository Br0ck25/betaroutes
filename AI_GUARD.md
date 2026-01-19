# AI Guard

These rules are non-negotiable and apply to all AI-generated output.

## Forbidden

The AI must not introduce or use:

- `$:` reactive statements
- `onMount`, `beforeUpdate`, `afterUpdate`
- `createEventDispatcher`
- Svelte stores (`writable`, `readable`, `derived`, or custom)
- Any legacy Svelte syntax or APIs
- XHTML or XML-style HTML syntax

## Required

The AI must always:

- Use HTML Living Standard–compliant markup (see `HTML_LIVING_STANDARD.md`)
- Use Svelte 5 runes exclusively for reactivity
- Preserve or restore a passing `npm run check` state in final output
- Follow all governance documents exactly

## Migration Context

During the Svelte 4 → Svelte 5 migration:

- The AI must follow `svelte-4-to-5-migration-agent-spec.v2.7.3.md` when migrating files
- Legacy files marked with `<!-- MIGRATION: SVELTE4-LEGACY -->` may temporarily contain forbidden patterns until migration
- The AI must NOT introduce legacy patterns into new files or migrated files

## Enforcement

If a task requires temporary breakage, the final result must be clean and compliant. Partial or transitional states are not acceptable.

Violations will fail CI.
