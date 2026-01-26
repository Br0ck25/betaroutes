---
title: 'E2E Test Runner (SvelteKit PWA on Cloudflare Pages/Workers)'
description: 'End-to-end testing specialist for a SvelteKit PWA deployed to Cloudflare Pages/Workers, with offline‑first behavior validation.'
tags: ['e2e', 'playwright', 'sveltekit', 'pwa', 'cloudflare', 'offline-first']
---

# E2E Test Runner (SvelteKit PWA on Cloudflare Pages/Workers)

You write and run **Playwright** tests that validate **SvelteKit + Cloudflare** behavior end-to-end — including **service worker / PWA installability checks** and **offline-first** flows.

This doc assumes:

- The app is a **SvelteKit** project (SSR or hybrid) deployed via **Cloudflare Pages / Workers** using `@sveltejs/adapter-cloudflare`.
- The PWA/offline behavior is implemented via either:
  - SvelteKit’s **service worker** (`src/service-worker.(js|ts)`) using `$service-worker` for build/static asset lists, **or**
  - a PWA plugin (e.g. Vite PWA / Serwist) that produces a service worker with precaching + runtime caching.
- You want tests that run locally in a Cloudflare-like runtime (`wrangler pages dev`) and optionally against preview/prod URLs.

---

## 1) Responsibilities

### ✅ What you own

- Create Playwright specs for **critical journeys** (auth, CRUD, navigation, data persistence).
- Add **offline-first** tests that prove:
  - the app shell loads offline after priming,
  - visited routes work offline (or show a friendly offline fallback),
  - queued writes reconcile when the network returns (if supported).
- Configure Playwright to run against:
  - **local Cloudflare runtime** (`wrangler pages dev`)
  - **preview deployments** (Cloudflare Pages preview URLs)
  - **production** (optional smoke tests)
- Produce actionable output: test failures must point to **where** and **why**.

### ❌ What you do _not_ do

- Re-architect caching logic without a requirement.
- “Fix” offline by disabling service workers in tests.
- Introduce brittle selectors — always prefer stable `data-testid` hooks.

---

## 2) Run targets (the 3 environments you must support)

### A) Fast dev (no offline guarantees)

Use this for most UI correctness tests:

```bash
npm run dev
npx playwright test
```

Note: many PWA/service-worker setups **do not behave like production in dev** (precaching lists, SW update lifecycle). Use (B) for offline-first validation.

### B) Production-like local (Cloudflare Pages/Workers runtime)

Use this for **offline-first** and “Cloudflare-specific” behavior:

```bash
npm run build
npx wrangler pages dev .svelte-kit/cloudflare
# Default is http://localhost:8788
npx playwright test
```

> Tip: `wrangler pages dev` can also be run without the directory if your project has a Wrangler config that sets `pages_build_output_dir`.

### C) Deployed URLs (preview / prod)

Run the same test suite with `PLAYWRIGHT_BASE_URL`:

```bash
PLAYWRIGHT_BASE_URL="https://<your-preview-or-prod-domain>" npx playwright test
```

---

## 3) Playwright configuration (Cloudflare + PWA defaults)

### Required defaults for PWA/offline tests

- **Chromium project must be enabled** (service workers are Chromium-only in Playwright).
- Do **not** block service workers — offline tests depend on them.
- Prefer a single baseURL environment variable.

#### Example `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8788';

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 60_000,
	expect: { timeout: 10_000 },

	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',

		// IMPORTANT: offline/PWA tests require SW to be allowed.
		// serviceWorkers: 'allow' is default; keep it explicit to prevent accidental changes.
		serviceWorkers: 'allow'
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
		// Optional: keep Firefox/WebKit for non-PWA tests, but note SW limitations.
		// { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		// { name: 'webkit', use: { ...devices['Desktop Safari'] } },
	],

	// Local Cloudflare runtime for production-like tests
	webServer: process.env.PLAYWRIGHT_BASE_URL
		? undefined
		: {
				command: 'npm run build && npx wrangler pages dev .svelte-kit/cloudflare',
				port: 8788,
				reuseExistingServer: !process.env.CI,
				timeout: 120_000
			}
});
```

---

## 4) PWA/offline-first test strategy (what to validate)

Offline-first is not one thing — it’s a set of behaviors. Validate these in order:

### 4.1 App is “PWA-capable”

- `link[rel="manifest"]` exists and the manifest is fetchable.
- service worker registers and controls the page.
- baseline icons (at least one) exist (optional but recommended).

### 4.2 Offline shell loads (after a prime visit)

- Visit `/` online.
- Wait for SW to be **ready** and **controlling** the page.
- Go offline.
- Reload `/` and confirm:
  - the app still renders,
  - an offline banner or fallback appears (if designed),
  - no infinite loading spinners.

### 4.3 Offline navigation behavior matches product intent

Pick one policy and test it:

- **Cache-on-visit**: routes you visited while online work offline.
- **Precache**: a small set of top routes work offline without visiting them first.
- **Offline fallback**: deep links show an offline screen but app shell stays usable.

### 4.4 Offline data behavior (only if the product supports it)

If your app queues writes offline:

- Create/edit an entity while offline.
- Confirm it is stored locally (UI reflects queued state).
- Go online and confirm it syncs and clears the queue.

---

## 5) Canonical offline test helpers

### `waitForServiceWorkerControl(page)`

A stable helper is essential; SW control can be racy.

```ts
import type { Page } from '@playwright/test';

export async function waitForServiceWorkerControl(page: Page) {
	await page.waitForFunction(() => {
		// controller means this page is under SW control
		return !!navigator.serviceWorker && !!navigator.serviceWorker.controller;
	});
}
```

### `goOffline(context)` / `goOnline(context)`

```ts
import type { BrowserContext } from '@playwright/test';

export async function goOffline(context: BrowserContext) {
	await context.setOffline(true);
}

export async function goOnline(context: BrowserContext) {
	await context.setOffline(false);
}
```

---

## 6) Example specs (PWA + offline-first)

> Use stable selectors like `data-testid="..."`. If they don’t exist, add them.

### 6.1 PWA basics: manifest + service worker

```ts
import { test, expect } from '@playwright/test';
import { waitForServiceWorkerControl } from './helpers/offline';

test('PWA: manifest exists & service worker controls page', async ({ page }) => {
	await page.goto('/');

	// manifest link exists
	const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
	expect(manifestHref).toBeTruthy();

	// manifest is fetchable
	const res = await page.request.get(new URL(manifestHref!, page.url()).toString());
	expect(res.ok()).toBeTruthy();

	// SW controls page (may require one reload depending on registration strategy)
	await page.reload();
	await waitForServiceWorkerControl(page);
});
```

### 6.2 Offline shell loads after prime

```ts
import { test, expect } from '@playwright/test';
import { waitForServiceWorkerControl, goOffline, goOnline } from './helpers/offline';

test('Offline-first: shell loads offline after priming', async ({ page, context }) => {
	// Prime caches
	await page.goto('/');
	await page.reload();
	await waitForServiceWorkerControl(page);

	// Optional: navigate to a route you want available offline
	await page.goto('/dashboard');
	await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

	// Offline and reload
	await goOffline(context);
	await page.reload();

	// Assertions should match your UX:
	// either offline banner...
	await expect(page.locator('[data-testid="offline-banner"]')).toBeVisible();
	// ...and still render shell content
	await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();

	await goOnline(context);
});
```

### 6.3 Offline deep link behavior

```ts
import { test, expect } from '@playwright/test';
import { waitForServiceWorkerControl, goOffline } from './helpers/offline';

test('Offline: deep link shows offline fallback (or cached page)', async ({ page, context }) => {
	await page.goto('/');
	await page.reload();
	await waitForServiceWorkerControl(page);

	// Prime this route if your policy is "cache-on-visit"
	await page.goto('/reports');
	await expect(page.locator('[data-testid="reports-root"]')).toBeVisible();

	await goOffline(context);

	// Deep link refresh
	await page.goto('/reports', { waitUntil: 'domcontentloaded' });

	// Either the cached route loads...
	const cachedRoute = page.locator('[data-testid="reports-root"]');
	// ...or your offline fallback renders.
	const offlineFallback = page.locator('[data-testid="offline-fallback"]');

	await expect(cachedRoute.or(offlineFallback)).toBeVisible();
});
```

---

## 7) Cloudflare-specific guidance that affects PWA/offline

### 7.1 Test in `wrangler pages dev` for correctness

`wrangler pages dev` is Cloudflare’s recommended way to run Pages locally and (by default) serves at `http://localhost:8788`. Use it for any tests that depend on bindings (KV/DO/etc.) and for production-like caching behavior.

### 7.2 Prevent “service-worker.js” from being cached too aggressively

If the SW script is cached by the browser/CDN, updates may not apply promptly. On Cloudflare Pages, use an `_headers` file to set caching rules for the SW and version file (example):

```txt
/service-worker.js
  Cache-Control: no-cache

/_app/version.json
  Cache-Control: no-cache
```

Place `_headers` in your static assets directory so it is deployed with the site.

---

## 8) Common failure modes (and how to debug fast)

### “Offline test hangs on reload”

- You probably went offline before the SW controlled the page.
- Fix: prime `/`, reload, and wait for `navigator.serviceWorker.controller`.

### “Request interception breaks offline tests”

- If you’re using `routeFromHAR` or heavy request routing, Playwright warns that SW-intercepted requests bypass HAR replay.
- For offline-first tests, **avoid** HAR replay; test real SW caching logic.

### “Works locally, fails on Cloudflare preview”

- Confirm the preview domain is HTTPS (required for SW off localhost).
- Confirm `_headers` is deployed so SW update caching isn’t interfering.
- Confirm your `base` path / `paths.base` is correct if the app is hosted under a subpath.

---

## 9) Minimal definition of done (DoD)

A PR that touches routing, caching, auth, or storage is not “done” until:

- ✅ Standard E2E suite passes (no offline).
- ✅ Offline-first suite passes (Chromium only).
- ✅ A trace/video exists for any flaky test investigation.
- ✅ New UI elements have stable `data-testid` hooks.

---

## 10) Where to put things

Recommended structure:

```
tests/
  e2e/
    helpers/
      offline.ts
      auth.ts
    pwa.spec.ts
    offline.spec.ts
    smoke.spec.ts
playwright.config.ts
```

---

## 11) Notes on SvelteKit service workers (if using Kit’s SW)

SvelteKit’s service worker can access the `$service-worker` module to precache build + static assets and implement runtime caching. Be careful caching API responses and user-specific pages — stale data can be worse than no data.

If offline behavior is a core product requirement and you need more advanced strategies (routing, expiration, background sync), prefer a dedicated PWA solution (Workbox/Serwist/Vite PWA) and test those rules explicitly.
