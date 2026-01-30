# Go Route Yourself - SvelteKit + Cloudflare

A **strict SvelteKit 2 + Svelte 5 (Runes)** app deployed on **Cloudflare Pages/Workers** with an **offline-first PWA**.

This repo enforces strict type safety, security, and architectural boundaries.
**If a change conflicts with the governance docs, the docs win.**

---

## AI & Copilot rules (strict)

This repository enforces **zero tolerance** for legacy patterns. GitHub Copilot (and all AI tools) MUST follow:

1. **Svelte 5 only:** Runes (`$state`, `$derived`, `$props`) are mandatory. Svelte 4 syntax (`export let`, `$:`) is banned.
2. **Cloudflare-native runtime:** Use `platform.env` bindings (KV / D1 / Durable Objects). Node.js built-ins (`fs`, `process`) are forbidden.
3. **Strict types:** No `any`. No `// @ts-ignore` (use `// @ts-expect-error` only when truly necessary). Handle `undefined` explicitly.

Canonical AI router + forbidden patterns live in:

- `AGENTS.md`

Copilot-specific guidance (when editing with Copilot) lives in:

- `.github/copilot-instructions.md`

---

## Tech stack

- **Framework:** SvelteKit 2 + Svelte 5 (Runes)
- **Runtime:** Cloudflare Workers (Edge) / Cloudflare Pages
- **Storage:** Cloudflare KV (primary) + other Cloudflare bindings as configured in `wrangler.*` and Pages environment
- **Styling:** Tailwind CSS (strict config)
- **Offline:** PWA + IndexedDB (no sensitive data in browser storage)

---

## Quick start

### 1) Install

```bash
npm install
```

### 2) Local secrets

Copy `.dev.vars.example` -> `.dev.vars`. **Do not commit** `.dev.vars` or `.env`.

```bash
cp .dev.vars.example .dev.vars
```

### 3) Run locally

Run the local dev server with Cloudflare emulation.

```bash
npm run dev
```

### 4) Run the strict gate

Run this frequently to catch type/lint issues early.

```bash
npm run gate
```

---

## Architecture & standards (read these first)

**Start here:**

- `REPOSITORY_GOVERNANCE.md` - repo-wide rules & enforcement
- `AGENTS.md` - canonical AI router + forbidden patterns

**Core constraints:**

- `ARCHITECTURE.md` - data models, key patterns, boundaries
- `SECURITY.md` - zero-trust rules, forbidden patterns, auth + data isolation
- `PWA.md` - offline-first rules, service worker policy, cache rules
- `SVELTE5_STANDARDS.md` - runes-only Svelte 5 patterns (props/state/effects/snippets)
- `HTML_LIVING_STANDARD.md` - strict HTML parsing rules (Svelte 5 compatible)
- `DESIGN_SYSTEM.md` - Tailwind palette + UI constraints

**Supplemental (recommended):**

- `ERROR_PATTERNS_AND_STOP_CONDITIONS.md` - recurring AI/human mistakes + "stop" rules

---

## Key patterns

### Data access (KV composite keys)

We use **composite keys** to enforce ownership.

```ts
// CORRECT
const key = `trip:${locals.user.id}:${tripId}`;
const data = await platform.env.KV.get(key);

// FORBIDDEN (no client trust)
const key = `trip:${params.userId}:${tripId}`;
```

### Reactivity (Svelte 5 runes)

Use runes exclusively.

```svelte
<script lang="ts">
  let { count }: { count: number } = $props();
  let double = $derived(count * 2);
</script>
```

Forbidden legacy syntax:

```svelte
<script lang="ts">
  export let count; // legacy
  $: double = count * 2; // legacy
</script>
```

---

## Deployment

Cloudflare Pages handles deployment.

```bash
npm run build
```

Secrets are managed via the Cloudflare dashboard (Pages env vars / Workers secrets), not committed config files.

---

## Contributing

Before opening a PR:

1. Read `REPOSITORY_GOVERNANCE.md` + `AGENTS.md`
2. Run:

```bash
npm run gate
```

If you're unsure whether a change violates a governance doc, **stop and fix the doc conflict first**.
