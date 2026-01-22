# Copilot / AI Agent Quick Instructions

**Purpose:** Short, actionable guidance to help Copilot-style AI agents be productive immediately in this repository.

## Read first (must-read order) ✅

1. `SECURITY.md` — **READ FIRST** (absolute highest precedence)
2. `GOVERNANCE.md` — rule hierarchy & conflict resolution
3. `AI_AGENTS.md` — quick reference + stop conditions
4. `svelte-mixed-migration-agent.md` — migration rules (Svelte 4 → 5)
5. `ARCHITECTURE.md`, `src/README.md` — architecture & context

---

## Critical rules (short)

- Security > PWA > HTML Living Standard > Design System > Migration > Code Style. If in doubt, stop and ask.
- Never store or log sensitive data (passwords, full addresses, dollar amounts).
- All API access to Cloudflare KV must be authenticated and verify ownership. Keys MUST use the pattern: `trip:{userId}:{tripId}`.
- Never expose KV to the browser or trust client-provided `userId`.
- Service worker must not cache API responses containing user data; only cache app shell & public assets.

---

## Stop conditions (stop & ask)

- You are about to migrate a Svelte file and the user did not explicitly request migration.
- Your change touches auth/session, KV keys, or API ownership checks.
- Your changes introduce new `npm run check` / lint / TypeScript errors or Svelte diagnostics.
- Any architectural or PWA-affecting change (service worker, manifest, routing).

---

## Common, project-specific checks & commands 🔧

- Type checking: `npm run check` (runs `svelte-check` and `svelte-kit sync`).
- Lint & format: `npm run lint` and `npm run format`.
- Dev server: `npm run dev` (Vite + SvelteKit).
- Build: `npm run build`; Preview: `npm run preview`.
- Migration helpers: `npm run migrate:order` and `npm run migrate:done`.
- Node engine requirement: Node >= 22 (see `package.json`).

---

## Svelte migration & syntax rules

- New code MUST be Svelte 5. Existing Svelte 4 files must remain unchanged unless migration is requested.
- Detect versions:
  - Svelte 5 indicators: `$props()`, `$state()`, `$derived()`.
  - Svelte 4 indicators: `export let`, `$:`, `<slot>`.
- If adding TypeScript to a `.svelte` file, ensure `<script lang="ts">` is present.
- Do NOT mix Svelte 4 and Svelte 5 syntax in the same file.

---

## Common pitfalls & quick examples

- TypeScript in Svelte without `lang="ts"` → many parse errors. Add `lang="ts"` when using `: Type` or interfaces.
- Request handlers must `return` a Response on every code path. (See examples in `AI_AGENTS.md`.)
- **Unused variables:** Delete them. If a param is required but unused, prefix with `_` (e.g., `_req`).
- **Imports/Exports:** Always export utility functions and import them in components.
- Never use `{@html}` with user-provided input (XSS risk).

---

## Files to consult for specific tasks

- Security & storage: `SECURITY.md` (KV key formats, what can be cached, logging rules)
- Migration rules: `svelte-mixed-migration-agent.md` and `SVELTE5_MIGRATION.md`
- PWA and service worker rules: `PWA.md` and `service-worker.js`
- Styling constraints: `DESIGN_SYSTEM.md`
- Architecture and dataflow: `ARCHITECTURE.md` and `src/README.md`

---

If any of the above is unclear or you need more examples (e.g., typical RequestHandler patterns, KV usage snippets, or Svelte migration checklist), ask and I'll expand the relevant section.
