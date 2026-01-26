# Fixing `svelte/no-navigation-without-resolve` warnings (base-aware internal links)

This doc captures the strict, lint-clean approach for internal navigation in your SvelteKit app when deployed at `/` **or** under a subpath (Cloudflare Pages) **without** adding any `eslint-disable` exceptions.

---

## Why the warnings happened

The rule expects SvelteKit's canonical `resolve()`:

```ts
import { resolve } from '$app/paths';
```

It **does not recognize** a local wrapper like:

```ts
import { base } from '$app/paths';
const resolve = (href: string) => `${base}${href}`;
```

So even if your `href` is base-aware, the rule still flags it.

---

## Goal

- ✅ Use SvelteKit's `resolve()` API (linter-friendly)
- ✅ Keep navigation base-aware
- ✅ **No** `eslint-disable` lines
- ✅ Safe query strings (encode values)

---

## Dashboard page changes

### 1) Replace the custom `base`/`resolve` wrapper with SvelteKit's `resolve`

**Before**

```ts
import { base } from '$app/paths';
const resolve = (href: string) => `${base}${href}`;
```

**After**

```ts
import { resolve } from '$app/paths';
```

---

### 2) Add pre-resolved constants near the top of the `<script>`

Add these near `selectedRange`:

```ts
const tripsHref = resolve('/dashboard/trips');
const settingsHref = resolve('/dashboard/settings');
const newTripHref = resolve('/dashboard/trips/new');
```

These:

- are base-aware
- make intent obvious
- avoid repeated `resolve()` calls for static links

---

### 3) Use the constants for static internal links

**Before**

```svelte
<a href={resolve('/dashboard/trips/new')} class="btn-primary">New Trip</a>
```

**After**

```svelte
<a href={newTripHref} class="btn-primary">New Trip</a>
```

**Before**

```svelte
<a href={resolve('/dashboard/settings')}>Vehicle odometer start</a>
```

**After**

```svelte
<a href={settingsHref}>Vehicle odometer start</a>
```

**Before**

```svelte
<a href={resolve('/dashboard/trips')} class="btn-secondary">View All</a>
```

**After**

```svelte
<a href={tripsHref} class="btn-secondary">View All</a>
```

---

### 4) Fix the dynamic trip link (TypeScript-safe approaches)

Dynamic links with query parameters face a **TypeScript conflict**: SvelteKit's typed `resolve()` expects literal route strings, not template literals. Here are the working solutions:

#### **Option A: Call `resolve()` directly in href (recommended, no eslint-disable needed)**

```svelte
<a
  href={resolve('/dashboard/trips') + '?id=' + encodeURIComponent(String(trip.id))}
  class="trip-item"
>
```

**Pros:**

- ✅ No TypeScript errors
- ✅ No eslint-disable needed
- ✅ Linter sees `resolve()` called with literal string
- ✅ Most straightforward

**Cons:**

- Calls `resolve()` per item instead of once (but this is fine - resolve() is fast)

**Note:** Even though you have a `tripsHref` constant, calling `resolve()` directly in each dynamic link satisfies the linter without any exceptions.

#### **Option B: Pre-resolved constant (requires one eslint-disable per link)**

```svelte
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- using pre-resolved tripsHref -->
<a href={tripsHref + '?id=' + encodeURIComponent(String(trip.id))} class="trip-item">
```

**Pros:**

- ✅ Reuses the `tripsHref` constant
- ✅ No TypeScript errors
- ✅ Slightly less repetitive

**Cons:**

- ⚠️ Requires inline eslint-disable comment (linter doesn't track that `tripsHref` came from `resolve()`)
- The disable comment is a justified false-positive suppression

#### **Option C: `{@const}` with pre-resolved constant (requires one eslint-disable)**

```svelte
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- using pre-resolved tripsHref + encoded id for type-safety -->
{@const tripHref = `${tripsHref}?id=${encodeURIComponent(String(trip.id))}`}
<a href={tripHref} class="trip-item">
```

**Pros:**

- ✅ Cleaner template literal syntax
- ✅ No TypeScript errors (uses pre-resolved `tripsHref`)

**Cons:**

- ⚠️ Requires inline eslint-disable comment
- More complex than Option A or B

#### **Option D: Template literal in `resolve()` (DOES NOT WORK)**

```svelte
<!-- ❌ TYPESCRIPT ERROR - DO NOT USE -->
<a
  href={resolve(`/dashboard/trips?id=${encodeURIComponent(String(trip.id))}`)}
  class="trip-item"
>
```

**Why this fails:**

- SvelteKit's typed `resolve()` only accepts literal route strings
- Template literals like `` `/dashboard/trips?id=${...}` `` are rejected by TypeScript
- You'll get: `Argument of type 'string' is not assignable to parameter of type...`

---

**Recommendation:** Use **Option A** (call `resolve()` directly) for a fully lint-clean solution with no exceptions needed.

---

## `handleNav` (recommended approach)

If you have code like this:

```ts
function handleNav(e: MouseEvent, href: string) {
	e.preventDefault();
	closeSidebar();
	goto(resolve(href));
}
```

That pattern commonly triggers warnings because it passes raw strings around and often needs inline disables.

### For anchors (`<a>`): don't use `goto()` at all

**SvelteKit automatically intercepts internal `<a>` clicks for client-side navigation.** You don't need `goto()` for anchor elements. Use click handlers only for UI effects:

```ts
function handleNav(_e: MouseEvent) {
	closeSidebar();
}
```

Then:

```svelte
<a href={settingsHref} on:click={handleNav}>Profile Settings</a>
```

✅ No `goto()`, no raw path strings, no eslint disables.

### For non-anchors (buttons) where you must navigate

Use `goto()` only when you need programmatic navigation (e.g., after form submission, in non-anchor elements):

```ts
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

function navToSettings() {
	goto(resolve('/dashboard/settings'));
}
```

---

## Programmatic navigation with options

```ts
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

// Replace history entry (no back button)
goto(resolve('/dashboard/trips'), { replaceState: true });

// Disable scroll reset
goto(resolve('/dashboard/trips'), { noScroll: true });

// Invalidate data after navigation
goto(resolve('/dashboard/trips'), { invalidateAll: true });

// Combine options
goto(resolve('/dashboard/trips'), {
	replaceState: true,
	noScroll: true
});
```

---

## Refreshing data without navigation

```ts
import { invalidate, invalidateAll } from '$app/navigation';

// After a mutation, refresh specific data
await invalidate('/api/trips');

// Or refresh all data on the current page
await invalidateAll();
```

---

## Programmatic preloading

```ts
import { preloadData, preloadCode } from '$app/navigation';
import { resolve } from '$app/paths';

// Preload data for a route (on hover, etc.)
async function handleHover() {
	await preloadData(resolve('/dashboard/trips'));
}

// Preload just the code bundle
await preloadCode(resolve('/dashboard/trips'));
```

---

## Form submissions with redirects

After a form action succeeds, redirect using the base path:

```ts
// src/routes/dashboard/trips/+page.server.ts
import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

export const actions = {
	default: async ({ request }) => {
		// ... process form
		throw redirect(303, `${base}/dashboard/trips`);
	}
};
```

**Note:** Server-side redirects should use `base` from `$app/paths` rather than `resolve()`, as `resolve()` is primarily for client-side use.

---

## Hash/anchor links

```svelte
<!-- Same-page anchors don't need resolve() -->
<a href="#section-1">Jump to Section 1</a>

<!-- Cross-page with hash fragment -->
<a href={resolve('/dashboard/trips#recent')}>Recent Trips</a>
```

---

## Relative vs absolute paths

**Always use absolute paths with `resolve()`:**

```svelte
<!-- ✅ CORRECT - absolute path -->
<a href={resolve('/dashboard/trips')}>Trips</a>

<!-- ❌ WRONG - relative path -->
<a href={resolve('../trips')}>Trips</a>

<!-- ❌ WRONG - relative path -->
<a href={resolve('trips')}>Trips</a>
```

**Why?** `resolve()` expects root-relative paths (starting with `/`) to properly handle the base path.

---

## Server vs client context

**In `+page.svelte`, `+layout.svelte`, and other client-side components:**

```ts
import { resolve } from '$app/paths'; // ✅ Works perfectly
```

**In `+page.server.ts`, `+layout.server.ts`, and other server-side code:**

```ts
import { resolve } from '$app/paths'; // ⚠️ May not work in all contexts
import { base } from '$app/paths'; // ✅ Use this instead

const path = `${base}/dashboard/trips`;
throw redirect(303, path);
```

---

## Common pitfalls

### ❌ Template literal inside resolve() for dynamic values

```svelte
<!-- WRONG - TypeScript error: resolve() expects literal route strings -->
<a href={resolve(`/trips?id=${encodeURIComponent(id)}`)}>Trip</a>
```

### ✅ String concatenation OR pre-resolved constant

```svelte
<!-- CORRECT - Option 1: String concatenation -->
<a href={resolve('/trips') + '?id=' + encodeURIComponent(id)}>Trip</a>

<!-- CORRECT - Option 2: Pre-resolved with {@const} (requires eslint-disable) -->
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
{@const tripHref = `${resolve('/trips')}?id=${encodeURIComponent(id)}`}
<a href={tripHref}>Trip</a>
```

### ❌ Building URLs piece by piece

```ts
// WRONG - loses linter tracking
const basePath = resolve('/dashboard');
const fullPath = `${basePath}/trips`;
```

### ✅ Resolve the complete path at once

```ts
// CORRECT
const fullPath = resolve('/dashboard/trips');
```

### ❌ Forgetting to encode query parameters

```svelte
<!-- WRONG - breaks with special characters -->
<a href={resolve(`/trips?name=${trip.name}`)}>Trip</a>
```

### ✅ Always encode query parameter values

```svelte
<!-- CORRECT -->
<a href={resolve(`/trips?name=${encodeURIComponent(trip.name)}`)}>Trip</a>
```

---

## Verification checklist

Run:

```bash
npm run format
npm run lint
npm run check
npm test
```

Expected:

- ✅ No `svelte/no-navigation-without-resolve` warnings
- ✅ No `eslint-disable-next-line` needed for navigation
- ✅ Navigation remains base-aware under Cloudflare Pages subpaths

---

## Quick reference patterns (strict)

### ✅ Static internal link (base-aware)

```svelte
<a href={resolve('/dashboard/settings')}>Settings</a>
```

### ✅ Static link with constant (base-aware)

```svelte
<script>
	const settingsHref = resolve('/dashboard/settings');
</script>

<a href={settingsHref}>Settings</a>
```

### ✅ Dynamic internal link with query string (base-aware + safe)

**Method 1: String concatenation (no eslint-disable needed)**

```svelte
<a href={resolve('/dashboard/trips') + '?id=' + encodeURIComponent(String(trip.id))}>Trip</a>
```

**Method 2: With `{@const}` (requires one scoped eslint-disable)**

```svelte
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
{@const tripHref = `${tripsHref}?id=${encodeURIComponent(String(trip.id))}`}
<a href={tripHref}>Trip</a>
```

### ✅ Multiple query parameters

**Method 1: String concatenation**

```svelte
<a
	href={resolve('/dashboard/trips') +
		'?status=' +
		encodeURIComponent(status) +
		'&sort=' +
		encodeURIComponent(sort)}
>
	Filtered Trips
</a>
```

**Method 2: URLSearchParams (cleaner for many params)**

```svelte
<script>
	const params = new URLSearchParams({
		status: status,
		sort: sort,
		page: String(page)
	});
</script>

<a href={resolve('/dashboard/trips') + '?' + params}>Filtered Trips</a>
```

### ✅ Dynamic route parameters

```svelte
<!-- For /dashboard/trips/[id] routes - use string concatenation -->
<a href={resolve('/dashboard/trips/') + encodeURIComponent(tripId)}> View Trip </a>
```

### ✅ Close sidebar on click (still client-side nav)

```svelte
<a href={resolve('/dashboard/trips')} on:click={closeSidebar}>Trips</a>
```

### ✅ External link (no resolve needed)

```svelte
<a href="https://example.com" target="_blank" rel="noopener noreferrer">External</a>
```

### ✅ Preload data on hover (performance boost)

```svelte
<a href={tripsHref} data-sveltekit-preload-data="hover">Trips</a>
```

### ✅ Programmatic navigation

```svelte
<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	function navigateToTrips() {
		goto(resolve('/dashboard/trips'));
	}
</script>

<button on:click={navigateToTrips}>Go to Trips</button>
```

---

## Type safety tip (optional)

SvelteKit's types don't validate that your routes exist. Consider using a route helper for type-safe navigation:

```ts
// src/lib/routes.ts
import { resolve } from '$app/paths';

export const routes = {
	dashboard: () => resolve('/dashboard'),
	trips: () => resolve('/dashboard/trips'),
	trip: (id: string) => resolve(`/dashboard/trips?id=${encodeURIComponent(id)}`),
	tripDetail: (id: string) => resolve(`/dashboard/trips/${encodeURIComponent(id)}`),
	newTrip: () => resolve('/dashboard/trips/new'),
	settings: () => resolve('/dashboard/settings')
} as const;
```

Then in components:

```svelte
<script>
	import { routes } from '$lib/routes';
</script>

<a href={routes.newTrip()}>New Trip</a>
<a href={routes.trip(trip.id)}>View Trip</a>
```

**Benefits:**

- Autocomplete for all routes
- Single source of truth
- Easier refactoring
- Consistent parameter encoding

---

## Creating a Link component (optional)

For consistency across your app, you might create a wrapper component:

```svelte
<!-- src/lib/components/Link.svelte -->
<script lang="ts">
	import { resolve } from '$app/paths';

	export let href: string;
	export let external = false;

	$: resolvedHref = external ? href : resolve(href);
</script>

<a href={resolvedHref} {...$$restProps}>
	<slot />
</a>
```

Usage:

```svelte
<Link href="/dashboard/trips">Trips</Link>
<Link href="https://example.com" external>External</Link>
```

**Caveat:** This adds abstraction. Only use if your team prefers component-based navigation.

---

## SPA mode consideration

If using SvelteKit's SPA mode (`adapter-static` with `fallback`):

- Navigation still works the same way
- `resolve()` is still required for base path support
- No server-side routing occurs
- All navigation happens client-side

---

## Testing navigation

When testing components with navigation:

```ts
import { resolve } from '$app/paths';
import { vi } from 'vitest';

// Mock in tests
vi.mock('$app/paths', () => ({
	resolve: (path: string) => path, // or return `/base${path}` to test subpath behavior
	base: ''
}));
```

---

## Troubleshooting

### Still seeing warnings after using `resolve()`?

1. **Check you imported from the right place:**

   ```ts
   import { resolve } from '$app/paths'; // ✅ Correct
   import { base } from '$app/paths'; // ❌ Wrong function
   ```

2. **Ensure `resolve()` is called in the `href` attribute** (not assigned first for dynamic links)

3. **Verify you're using absolute paths** (starting with `/`)

4. **Run the linter with `--fix`:**

   ```bash
   npm run lint -- --fix
   ```

5. **Clear SvelteKit cache:**
   ```bash
   rm -rf .svelte-kit
   npm run dev
   ```

### Navigation works locally but breaks on Cloudflare Pages?

Check your `svelte.config.js`:

```js
const config = {
	kit: {
		paths: {
			base: process.env.NODE_ENV === 'production' ? '/your-repo-name' : ''
		}
	}
};
```

Make sure the base path matches your Cloudflare Pages project name.

### Links work but data doesn't load on deployed site?

Ensure your API endpoints also respect the base path:

```ts
// ❌ WRONG
const response = await fetch('/api/trips');

// ✅ CORRECT
import { base } from '$app/paths';
const response = await fetch(`${base}/api/trips`);
```

---

## Summary

- **Always** use `resolve()` from `$app/paths` for internal links in client-side code
- **Always** use absolute paths starting with `/`
- **Always** encode query parameter values with `encodeURIComponent()`
- **For static links:** Use constants like `const tripsHref = resolve('/dashboard/trips')`
- **For dynamic links with query params:** Use string concatenation: `resolve('/trips') + '?id=' + encodeURIComponent(id)` to avoid TypeScript errors
- **Alternative for dynamic links:** Use `{@const}` pattern with one scoped `eslint-disable` comment if you prefer template literal syntax
- **Let** SvelteKit handle `<a>` navigation automatically (don't use `goto()` unless necessary)
- **Use** `base` from `$app/paths` for server-side redirects and API calls
- **Test** your navigation on both development and production environments
