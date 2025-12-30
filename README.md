# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

---

## HughesNet Archived Orders API 🔧

A new endpoint is available to inspect archived (previously synced) orders persisted from HughesNet:

- GET /api/hughesnet/archived - returns a list of archived orders for the authenticated user
- GET /api/hughesnet/archived?id=<ORDER_ID> - returns a single archived order if it belongs to the authenticated user

This endpoint reads from `BETA_HUGHESNET_ORDERS_KV` and only returns records scoped to the requesting user.

---

## PWA & mobile-first improvements ✅

Small set of focused changes to improve mobile-first experience and PWA behavior:

- Register a service worker and handle the `beforeinstallprompt` event in `src/routes/+layout.svelte` (adds `window.__deferredPWAInstall` and dispatches `pwa:beforeinstallprompt`). 🔧
- Add an offline fallback page: `static/offline.html` and return it for navigation failures in `src/service-worker.ts`. 🔁
- Add `viewport-fit=cover`, Apple meta tags and `apple-touch-icon` in `src/app.html` for better mobile integration. 🍎
- Add `maskable` purpose icon and `scope` to `static/manifest.json`. 🖼️
- Add safe-area and touch-target CSS helpers in `src/app.css` (safe-area insets + min 44px touch targets). ✋

How to test quickly:

1. Build and preview: `npm run build` then `npm run preview`.
2. Open the site in Chrome (mobile emulation) and check `Application` → `Manifest`, `Service Workers` and try `Add to home screen` flow.  
3. Simulate offline and reload a navigation route — the offline fallback should appear.
4. Run Lighthouse PWA audit and confirm installability / offline behavior.

Notes: For a custom install UI, listen for the `pwa:beforeinstallprompt` event on `window` and call `(window as any).__deferredPWAInstall.prompt()` when the user accepts the UI.

---

## Lighthouse findings & recommended follow-ups 🔎

I ran Lighthouse locally (emulated Moto G, slow 4G). Key measured scores and findings:

- Performance: **61** (FCP 3.1s, LCP 5.6s, TBT 20ms, CLS 0.244) — LCP and CLS are the primary areas to improve.
- Accessibility: **86** — missing labels for some selects and a few contrast/heading issues (I added ARIA labels where missing).
- Best Practices: **100** — good.
- SEO: **92** — missing meta description on some pages (added a default meta description) and other minor items.

Immediate fixes I implemented:
- Added width/height to logo images to reduce CLS.
- Added ARIA labels to selectable controls without labels.
- Added a default meta description and preloaded Google Fonts to improve FCP/LCP.
- Added an install prompt UI and offline fallback (already implemented previously).

Recommended next steps (prioritized):
1. Optimize large images and convert to WebP/AVIF (saves the most for LCP and payload size). 🔧
2. Audit large JS chunks and code-split if possible; remove or lazily-load unused libraries. ⚡
3. Serve fonts locally or inline critical font CSS to avoid render-blocking external stylesheet loads. 🗂️
4. Add server headers for security and best-practice audits (HSTS, COOP/COEP, CSP) — these are deployment concerns. 🔐
5. Run Lighthouse again (in regular Chrome DevTools) to get a reliable score (headless runs sometimes hit interstitials in this environment).

If you want, I can implement 1–2 of the above (image optimization and font delivery) next and re-run Lighthouse locally to show the improvements.

