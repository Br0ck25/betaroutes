# AGENTS.md — AI Agent & LLM Guidelines

**CRITICAL INSTRUCTION:**
You are working in a **Strict Svelte 5 (Runes) + SvelteKit + Cloudflare (Edge)** environment.

Before generating any code, you MUST:

1. **Classify the request** (UI / Backend / Security / PWA / Styles / HTML / Repo governance)
2. **Read the required docs** from the router below
3. Implement strictly (no shortcuts, no exceptions)

**Precedence:** If there is a conflict, **SECURITY.md wins**, then `ARCHITECTURE.md`, then `PWA.md`.

---

## 1) Documentation router (read first)

| If the user asks for...        | You MUST read...                        | Critical constraint                                                         |
| :----------------------------- | :-------------------------------------- | :-------------------------------------------------------------------------- |
| **Repo rules / standards**     | `REPOSITORY_GOVERNANCE.md`              | Zero-tolerance enforcement; run `npm run gate`.                             |
| **UI / Components**            | `SVELTE5_STANDARDS.md`                  | **Runes only** (`$state`, `$derived`, `$props`). No `export let` or `$:`.   |
| **Data / API / Backend**       | `ARCHITECTURE.md`                       | **Composite keys** scoped to `locals.user.id`. No client-owned keys.        |
| **Security / Auth**            | `SECURITY.md`                           | **Zero trust.** Verify `locals.user` in every endpoint. No mass assignment. |
| **Offline / PWA**              | `PWA.md`                                | IndexedDB for offline writes. **Never cache `/api/**` in the SW.            |
| **Styles / CSS**               | `DESIGN_SYSTEM.md`                      | Tailwind only; no arbitrary values / raw CSS.                               |
| **HTML / Markup**              | `HTML_LIVING_STANDARD.md`               | Strict parsing; **no `<div />`** (non-void elements must close).            |
| **Recurring mistakes / risks** | `ERROR_PATTERNS_AND_STOP_CONDITIONS.md` | Don’t repeat known failure modes; stop when unsure.                         |

> If `ERROR_PATTERNS_AND_STOP_CONDITIONS.md` does not exist yet, use `AI_AGENTS.md` (or create the new file and keep `AI_AGENTS.md` as a stub for compatibility).

---

## 2) Strict-mode checklist (every time)

Before you output code, verify:

1. **Linter-safe:** passes `eslint.config.js` (no `any`, no unused vars, no banned patterns).
2. **Type-safe:** passes strict TS (no `// @ts-ignore`; handle `undefined`).
3. **Edge-safe:** no Node.js APIs (`fs`, `path`, `process`, etc).
4. **Scope-safe:** storage keys are user-scoped (`trip:${locals.user.id}:...`).
5. **PWA-safe:** no SW caching of `/api/**` or user data.

---

## 3) Forbidden patterns (instant fail)

If you generate any of the following, you have failed:

- ❌ **Svelte 4 syntax:** `export let`, `$:` labels, `createEventDispatcher`
- ❌ **Runes breakers:** `$$props`, `$$restProps` (use `$props()` destructuring)
- ❌ **Svelte slots:** `<slot>` (use snippets + `{@render ...}` per `SVELTE5_STANDARDS.md`)
- ❌ **Legacy stores:** `import { writable } from 'svelte/store'` (use runes)
- ❌ **Node imports:** `import fs from 'fs'`, `path`, `process`, etc.
- ❌ **Client-side secrets:** exposing private keys in `.svelte` / client bundles
- ❌ **Self-closing non-void tags:** `<div />`, `<span />`, `<script />`
- ❌ **Loose / global keys:** `KV.list({ prefix: "trips:" })` or unscoped `KV.get("trips")`
- ❌ **Auth by request body:** accepting `userId` / owner identifiers from the client

---

## 4) Operational protocol

1. **Plan:** name the files you will touch and which standards apply.
2. **Execute:** implement strictly (no hacks, no “temporary” disables).
3. **Verify:** instruct to run `npm run gate`.

---

## 5) Repo knowledge map

- **Project root:** `src/`
- **Server logic:** `src/routes/api/` or `src/lib/server/` (never import server code into client)
- **Platform bindings:** `src/app.d.ts` (defines `platform.env`)

---

## 6) Optional (ChatGPT-only): Svelte MCP server tools

Only use this section **if the environment provides these MCP tools**.
If these tools do not exist where you are running (e.g., Copilot), **ignore this section**.

### Available MCP tools

1. **list-sections**
   Use FIRST to discover available documentation sections.

2. **get-documentation**
   Fetch full documentation for all relevant sections returned by `list-sections`.

3. **svelte-autofixer**
   Analyze Svelte code and iterate until it returns no issues.

4. **playground-link**
   Generate a Svelte Playground link **only after user confirmation** and **never** if code was written to repo files.
