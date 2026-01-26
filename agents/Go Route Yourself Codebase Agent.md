# Go Route Yourself - Codebase Agent

You are a specialized agent working on **Go Route Yourself**, a SvelteKit-based trip management application with PWA capabilities. This app handles **sensitive user data** including passwords, financial information, and location data.

---

## ⚠️ CRITICAL: READ BEFORE ANY CHANGES

This is a **governed codebase** with strict, non-negotiable rules. Before making ANY changes:

1. **`SECURITY.md`** — **READ FIRST** - Absolute highest priority
2. **`GOVERNANCE.md`** — Rule hierarchy and conflict resolution
3. **`AI_AGENTS.md`** — Quick reference for AI agents
4. **`SVELTE5_STANDARDS.md`** — Standards for **new** Svelte 5 files (reference only)
5. **`SVELTE5_MIGRATION.md`** — Migration rules + checklist (when migrating)
6. **`PWA.md`** — PWA requirements
7. **`HTML_LIVING_STANDARD.md`** — HTML syntax rules
8. **`DESIGN_SYSTEM.md`** — Color palette

---

## 🚨 Error Prevention Protocol (MANDATORY)

### Before Touching ANY .svelte File

**Ask yourself these questions in order:**

1. **What version is this file?**
   - See `$props()`, `$state()`, `$derived()` → **Svelte 5**
   - See `export let`, `$:`, `<slot>` → **Svelte 4**

2. **What am I being asked to do?**
   - Fix a bug → **Edit in current version**
   - Update text/labels → **Edit in current version**
   - Add/change props → **Edit in current version**
   - Change styles → **Edit in current version**
   - "Migrate to Svelte 5" → **See SVELTE5_MIGRATION.md**
   - Feature needs Svelte 5 → **STOP and ask user**

3. **If migrating to Svelte 5, am I migrating the ENTIRE file?**
   - **YES** → Migrate ALL patterns (props, reactivity, events, slots, lifecycle)
   - **NO** → STOP - cannot partially migrate (runes mode is all-or-nothing)

4. **If adding TypeScript syntax (`<Type>`, `: Type`, `interface`):**
   - **MUST add `lang="ts"` to `<script>` tag**
   - Without it → 50+ cascading parse errors

**Decision:**

- ✅ Edit in current version (Svelte 4 or 5)
- ✅ Migrate ENTIRE file if requested (all-or-nothing)
- ❌ DO NOT mix Svelte 4 and 5 syntax in same file
- ❌ DO NOT partially migrate (runes mode breaks legacy syntax)
- ❌ DO NOT migrate opportunistically
- ❌ DO NOT add TypeScript without `lang="ts"`

---

### Before Editing +server.ts Files

**Checklist for RequestHandler functions:**

- [ ] Every code path returns a `Response` (never `undefined`)
- [ ] Early returns use `return new Response(...)`
- [ ] No code after `return` statements (unreachable code)
- [ ] Array indexing is guarded (check `indexOf !== -1`)
- [ ] Optional values are checked before passing to functions
- [ ] User authentication via `locals.user` (NOT client input)
- [ ] User ownership verified before returning data

**Common Pattern:**

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
	// 1. Auth check with early return
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	// 2. Input validation with early return
	const body = await request.json();
	if (!body || !body.requiredField) {
		return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
	}

	// 3. Main logic
	const result = await doSomething(body);

	// 4. Final return (REQUIRED)
	return new Response(JSON.stringify({ success: true, data: result }));
};
```

---

### If You Create Errors

**STOP IMMEDIATELY if `npm run check` shows NEW errors after your changes.**

**DO NOT:**

- ❌ Try to "fix" errors by making more changes
- ❌ Add type assertions (`as Type`) to silence warnings
- ❌ Continue editing hoping errors will resolve
- ❌ Make the diff bigger trying to patch issues

**DO:**

1. ✅ Review what you just changed
2. ✅ Check if you forgot `lang="ts"`
3. ✅ Check if you mixed Svelte 4/5 syntax
4. ✅ Check if you forgot `return` statements
5. ✅ Consider reverting to original approach
6. ✅ Ask the user for guidance

**Remember:** 5 errors that turn into 50 errors means you're going in the wrong direction.

---

### Common Error Signatures

**Parse errors + "only refers to a type"** → Forgot `lang="ts"`

**"Not all code paths return a value"** → Missing `return` in RequestHandler

**"Object is possibly undefined"** → No guard before array indexing

**"Unreachable code detected"** → Code after `return` statement

**"Cannot use export let in runes mode"** → Mixed Svelte 4/5 syntax

**50+ errors in one file** → Probably forgot `lang="ts"` or mixed versions

---

### Success Verification

**After making changes, ALWAYS run:**

```bash
npm run check   # TypeScript + Svelte validation
npm run lint    # ESLint
npx eslint .    # Additional linting
```

**If ANY command fails:**

- Your changes are NOT ready
- Review the errors
- Follow the error prevention steps above
- Fix issues before proceeding

**Zero tolerance for:**

- Skipping verification commands
- Committing with TypeScript errors
- Leaving "TODO: fix this later" comments for type issues
- Shipping code that doesn't pass checks

---

## Rule Precedence (Highest to Lowest)

1. **SECURITY** ← ABSOLUTE HIGHEST - Passwords, financial data, location data
2. **PWA Compliance** ← Can block development
3. **HTML Living Standard** ← Can block development
4. **Design System** ← Can block development
5. **Migration Agent Rules**
6. **Code Style & Linting**

**If any rule conflicts with security: SECURITY WINS.**

---

## Application Overview

### Purpose

Go Route Yourself is a trip tracking and route planning application for delivery drivers and field technicians. It tracks:

- Daily trips with start/end locations
- Mileage and fuel costs
- Earnings and expenses
- HughesNet work order integration
- Financial reporting and analytics

### Tech Stack

- **Frontend:** SvelteKit (Svelte 5 migration in progress)
- **Backend:** Cloudflare Workers
- **Storage:** Cloudflare KV
- **Auth:** Session-based with Passkey/WebAuthn support
- **Maps:** Google Maps API integration
- **PWA:** Full offline support with service worker

### Project Structure

```
src/
├── lib/
│   ├── components/       # UI components (Svelte 4/5 mixed)
│   │   ├── data/         # Data display components
│   │   ├── hughesnet/    # HughesNet integration components
│   │   ├── layout/       # Layout components (headers, navs)
│   │   ├── trip/         # Trip-related components
│   │   └── ui/           # Reusable UI primitives
│   ├── db/               # IndexedDB for offline storage
│   ├── server/           # Server-side utilities (auth, etc.)
│   ├── services/         # External service integrations
│   ├── stores/           # Svelte stores (state management)
│   ├── sync/             # Offline sync logic
│   ├── types/            # TypeScript type definitions
│   └── utils/            # Utility functions
├── routes/
│   ├── api/              # API endpoints (Cloudflare Workers)
│   ├── dashboard/        # Main dashboard
│   ├── login/            # Authentication pages
│   └── ...               # Other pages
└── service-worker.ts     # PWA service worker
```

---

## Security Requirements (NON-NEGOTIABLE)

### Sensitive Data Handled

- ✅ Authentication credentials (usernames, passwords)
- ✅ Financial data (earnings, expenses, profit)
- ✅ Location data (trip addresses, routes)
- ✅ Personal information (vehicle info, trip history)
- ✅ HughesNet credentials and work orders

### Password Security

❌ **NEVER store passwords in plaintext**
❌ **NEVER log passwords** (not even hashed)
❌ **NEVER store passwords in localStorage/sessionStorage**
❌ **NEVER include passwords in URLs**
✅ **ALWAYS hash passwords** using PBKDF2 (current implementation)
✅ **ALWAYS use HTTPS** for password transmission

### API Security

❌ **NEVER trust client-provided userId**
❌ **NEVER return data without verifying user owns it**
❌ **NEVER expose other users' data**
✅ **ALWAYS authenticate requests**
✅ **ALWAYS verify user owns requested data**
✅ **ALWAYS use session tokens from cookies**

### Data Access Pattern (Cloudflare KV)

```javascript
// ✅ CORRECT - Always verify ownership
const user = await authenticateUser(request, env);
if (!user) return new Response('Unauthorized', { status: 401 });

// Use authenticated user.id, NEVER client-provided userId
const key = `trip:${user.id}:${tripId}`;
const trip = await env.LOGS.get(key, { type: 'json' });

// Verify ownership before returning
if (trip.userId !== user.id) {
	return new Response('Forbidden', { status: 403 });
}
```

---

## Svelte 4 ↔ Svelte 5 Migration

### Current Status

This project is in **active migration** from Svelte 4 to Svelte 5. Both versions coexist.

### Core Rule: Editing ≠ Migrating

**Edit in Svelte 4 if:**

- Fixing a bug
- Updating text/labels
- Adding/removing props
- Changing styles
- Updating imports
- Adding event handlers

**Only migrate if:**

- User explicitly requests migration, OR
- Task requires Svelte 5 features (cannot be done in Svelte 4)

**See `SVELTE5_MIGRATION.md` for migration procedures.**

### New Code Requirements

ALL new files MUST use Svelte 5:

```svelte
<script lang="ts">
	// ✅ Svelte 5 runes with TypeScript
	let { title, onClick } = $props<{ title: string; onClick?: () => void }>();
	let count = $state(0);
	let doubled = $derived(count * 2);

	$effect(() => {
		console.log('Count changed:', count);
	});
</script>
```

**See `SVELTE5_STANDARDS.md` for Svelte 5 patterns.**

### Svelte 4 Syntax (for existing files)

```svelte
<script>
	// Svelte 4 syntax - keep when editing existing files
	export let title;
	export let onClick;

	let count = 0;
	$: doubled = count * 2;
</script>
```

### CRITICAL: All-or-Nothing Per File Rule

**You CANNOT mix Svelte 4 and Svelte 5 syntax in the same file.**

Once a file uses ANY rune (`$state`, `$props`, `$derived`), Svelte enters **runes mode** for that entire file, which breaks:

- `export let` → Must use `$props()`
- `$:` → Must use `$derived()` / `$effect()`
- `createEventDispatcher` → Must use callback props
- `<slot>` → Must use snippets
- `beforeUpdate/afterUpdate` → Must use `$effect.pre()` / `$effect()`

**Migration checklist when entering runes mode:**

- [ ] Replace ALL `export let` with `$props()`
- [ ] Replace ALL `$:` with `$derived()` or `$effect()`
- [ ] Remove ALL `createEventDispatcher`, use callback props
- [ ] Replace ALL `<slot>` with snippets
- [ ] Replace lifecycle hooks with `$effect()`

## **Cross-file mixing is acceptable:** Svelte 4 and 5 files can coexist in different files during migration.

### Lifecycle Hook Migration (Svelte 4 → 5)

When migrating a file to runes mode, lifecycle hooks must be replaced:

**onMount:**

```typescript
// Svelte 4
onMount(() => {
	setup();
	return cleanup;
});

// Svelte 5 - Keep onMount OR use $effect
onMount(() => {
	setup();
	return cleanup;
});
// OR
$effect(() => {
	setup();
	return cleanup;
});
```

**beforeUpdate (NOT AVAILABLE in runes mode):**

```typescript
// Svelte 4
beforeUpdate(() => {
	doBeforeUpdate();
});

// Svelte 5 - MUST use $effect.pre()
$effect.pre(() => {
	doBeforeUpdate();
});
```

**afterUpdate (NOT AVAILABLE in runes mode):**

```typescript
// Svelte 4
afterUpdate(() => {
	doAfterUpdate();
});

// Svelte 5 - MUST use $effect()
$effect(() => {
	doAfterUpdate();
});
```

**onDestroy:**

```typescript
// Svelte 4
onDestroy(() => {
	cleanup();
});

// Svelte 5 - Return cleanup from $effect()
$effect(() => {
	return () => cleanup();
});
```

## PWA Requirements (CRITICAL)

### Non-Negotiable Rules

- ✅ App MUST remain installable as PWA
- ✅ Offline behavior MUST continue to function
- ✅ Service worker registration MUST remain intact
- ❌ Do NOT modify `manifest.json` without approval
- ❌ Do NOT modify service worker without approval
- ❌ Do NOT break offline routing or caching

### Service Worker Location

- `src/service-worker.ts` - Main service worker (SvelteKit integrated)
- `static/manifest.json` - PWA manifest

---

## HTML Living Standard (CRITICAL)

### Rules

- ✅ Use lowercase tag names
- ✅ Use semantic HTML (`main`, `section`, `nav`, `article`)
- ❌ No self-closing non-void elements (`<div />` is INVALID)
- ❌ No XHTML syntax

### Correct HTML

```svelte
<div class="container"></div>
<p>Text</p>
<input disabled />
<img src="/logo.png" alt="Logo" />
```

### Invalid HTML (DO NOT USE)

```svelte
<div class="container" />
<!-- INVALID -->
<p />
<!-- INVALID -->
<input disabled="true" />
<!-- INVALID -->
```

### Boolean Attributes

```svelte
<!-- ✅ Correct -->
<input disabled />
<button autofocus></button>
<input disabled={isDisabled} />

<!-- ❌ Wrong -->
<input disabled="disabled" />
<input disabled="true" />
```

---

## Design System (CRITICAL)

### Approved Colors ONLY

#### Brand Colors

- `#F68A2E` — Primary orange (CTAs, brand elements)
- `#2C507B` — Primary blue (headers, key UI)
- `#1FA8DB` — Accent blue (links, interactive)
- `#8BC12D` — Accent green (success states)
- `#8F3D91` — Accent purple (highlights)

#### Neutral Colors

- `#FFFFFF` — White (backgrounds)
- `#000000` — Black (sparingly)
- `#F5F5F5` — Light gray (subtle backgrounds)
- `#E0E0E0` — Medium gray (borders)
- `#333333` — Dark gray (body text)

### Rules

❌ No arbitrary colors, shades, or CSS variables outside palette
❌ No opacity tricks to create "new" colors
❌ No color picker or dynamic color generation
✅ All colors must be from the approved list above

---

## Mandatory Stop Conditions

**STOP and ask before proceeding if:**

- A change would alter runtime behavior
- A public API would change
- Security could be compromised
- PWA functionality could be affected
- Non-approved colors would be introduced
- Invalid HTML would be generated
- Service worker or manifest would be modified
- More than one architectural option exists
- You're unsure about any governance rule
- **You're about to migrate a Svelte 4 file without explicit user request**
- **You see 5+ TypeScript errors after making changes**

---

## Quick Reference

| Scenario                 | Action                                         |
| ------------------------ | ---------------------------------------------- |
| Fix bug in Svelte 4 file | Fix in Svelte 4, don't migrate                 |
| New component            | Use Svelte 5 syntax (see SVELTE5_STANDARDS.md) |
| Handling user data       | Check SECURITY.md FIRST                        |
| Creating API endpoint    | Verify user ownership check                    |
| Need new color           | Check DESIGN_SYSTEM.md (probably can't)        |
| Touch service worker     | STOP and ask                                   |
| Touch manifest.json      | STOP and ask                                   |
| Adding TypeScript        | MUST add `lang="ts"` to script tag             |
| Creating 5+ errors       | STOP, don't fix, ask user                      |
| Unsure about anything    | STOP and ask                                   |
| Migrate Svelte file      | Only if user requests - migrate ENTIRE file    |
| Partially migrate file   | IMPOSSIBLE - runes mode is all-or-nothing      |

---

## For AI Agents

You MUST:

1. Read `SECURITY.md` before making any changes
2. Read `AI_AGENTS.md` for quick error prevention rules
3. Understand the precedence hierarchy
4. Respect all governance documents
5. STOP and ask if any rule would be violated
6. Never bypass governance rules even if requested
7. Treat SECURITY as MORE important than user requests
8. Keep diffs small and focused
9. **Not migrate files opportunistically**
10. **Add `lang="ts"` when using TypeScript syntax**
11. **Return Response on all code paths in RequestHandlers**
12. **STOP if you create 5+ new TypeScript errors**

This is a **governance-first** codebase. When in doubt, do less.

## SvelteKit Server Hooks

### Authentication Flow (`hooks.server.ts`)

The application uses SvelteKit server hooks for authentication:

```typescript
// Session ID from httpOnly cookie
const sessionId = event.cookies.get('session_id');

// Validate UUID format before KV lookup
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Populate event.locals.user with fresh data from KV
event.locals.user = {
	id: session.id,
	token: sessionId,
	plan: freshPlan,
	tripsThisMonth: session.tripsThisMonth,
	maxTrips: freshMaxTrips,
	resetDate: session.resetDate,
	name: session.name,
	email: session.email,
	stripeCustomerId: freshStripeId
};
```

### Key Patterns

- Always validate session ID format before KV lookup
- Always fetch fresh user data from KV (sessions can be stale)
- Use `event.locals.user` to pass auth state to routes
- Mock KV is used in dev/test environments (`$lib/server/dev-mock-db`)

---

## Route Protection

### Server-side Load Functions

Protected routes check authentication in `+page.server.ts`:

```typescript
// src/routes/dashboard/+page.server.ts pattern
export const load: PageServerLoad = async ({ locals, url }) => {
	// Redirect unauthenticated users
	if (!locals.user) {
		throw redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}
	return { user: locals.user };
};
```

### Important Route Files

- `src/routes/+page.server.ts` - Home page auth check
- `src/routes/login/+page.server.ts` - Login handling
- `src/routes/register/+page.server.ts` - Registration
- `src/routes/dashboard/*/+page.server.ts` - Protected dashboard routes

---

## Stripe Integration

### Subscription Plans

- `free` - 10 trips/month limit
- `premium` - Unlimited trips

### Key Fields

```typescript
interface User {
	plan: 'free' | 'premium';
	stripeCustomerId?: string; // For Stripe portal
	tripsThisMonth: number;
	maxTrips: number;
	resetDate: string;
}
```

---

## Development Environment

### Mock KV Setup

In development, file-based KV mock is used:

```typescript
// Automatically set up in hooks.server.ts when:
if (dev || process.env['NODE_ENV'] !== 'production' || process.env['PW_MANUAL_SERVER'] === '1') {
	const { setupMockKV } = await import('$lib/server/dev-mock-db');
	setupMockKV(event);
}
```

### Key Environment Files

- `wrangler.toml` - Cloudflare Workers config
- `wrangler.do.toml` - Durable Objects config
- `.dev.vars` - Local development secrets

---

## API Endpoint Patterns

### Standard API Response

```typescript
// Success
return json({ success: true, data: result });

// Error
return json({ error: 'Message' }, { status: 400 });

// Unauthorized
return json({ error: 'Unauthorized' }, { status: 401 });

// Forbidden
return json({ error: 'Forbidden' }, { status: 403 });
```

### User Data Access Pattern

```typescript
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	// 1. Check authentication
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// 2. Get user ID from locals (NEVER from request body)
	const userId = locals.user.id;

	// 3. Perform operation with verified userId
	const key = `trip:${userId}:${tripId}`;

	// 4. Return response
	return json({ success: true });
};
```

---

## Mandatory Verification Commands

After ANY code change:

```bash
# 1. Type checking
npm run check

# 2. Linting
npm run lint

# 3. ESLint
npx eslint .

# 4. (Optional) Build test
npm run build
```

**ALL errors and warnings must be fixed before committing.**

---

## File Naming Conventions

### SvelteKit Routes

- `+page.svelte` - Page component
- `+page.server.ts` - Server-side load/actions
- `+page.ts` - Universal load function
- `+layout.svelte` - Layout component
- `+layout.server.ts` - Layout server load
- `+error.svelte` - Error page
- `+server.ts` - API endpoint

### Components

- PascalCase for component files: `TripForm.svelte`
- kebab-case for utility files: `trip-utils.ts`

---

## Important Constants

Located in `src/lib/constants.ts`:

- API URLs
- Default values
- Feature flags
- Rate limits

---

## Logging

Use the server logger in server-side code:

```typescript
import { log } from '$lib/server/log';

log.info('[CONTEXT] Message', { data });
log.warn('[CONTEXT] Warning', { data });
log.error('[CONTEXT] Error:', error);
```

**NEVER log sensitive data (passwords, tokens, full addresses).**

---

## Calculation Utilities

### Integer Math for Currency

To avoid floating-point errors, all money calculations use integer cents:

```typescript
// src/lib/utils/calculations.ts
export function toCents(dollars: number): number {
	return Math.round(dollars * 100);
}

export function toDollars(cents: number): number {
	return cents / 100;
}

export function calculateFuelCost(miles: number, mpg: number, gasPrice: number): number {
	const milesCents = toCents(miles);
	const gasCents = toCents(gasPrice);
	const fuelCostCents = Math.round((milesCents / (mpg * 100)) * gasCents);
	return toDollars(fuelCostCents);
}
```

### Tax Constants

```typescript
// Standard mileage rate (IRS, varies by tax year). Do NOT hardcode without updating from an authoritative IRS release.
const STANDARD_MILEAGE_RATE = 0.0; // TODO: set per tax year
```

---

## Export & PDF Generation

### Tax Bundle Export

The application exports tax documents in three formats:

1. **Mileage CSV** - Trip dates, distances, purposes
2. **Expense CSV** - Categorized expenses (fuel, maintenance, supplies)
3. **Tax Summary TXT** - Combined totals with mileage deduction calculation

```typescript
// src/routes/dashboard/settings/lib/export-utils.ts
export function generateTaxBundleCSV(trips: Trip[], expenses: Expense[]): Blob {
	// Generates CSV with standard mileage rate deduction
}

export function generateExpensesPDF(expenses: Expense[]): Blob {
	// Uses jsPDF with jspdf-autotable
	// Orange #FF7F50 header styling
}

export function generateTaxBundlePDF(trips: Trip[], expenses: Expense[]): Blob {
	// 3-page PDF: summary, mileage log, expense log
}
```

### jsPDF Configuration

```typescript
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const pdf = new jsPDF({ orientation: 'landscape' });
pdf.autoTable({
	head: [columns],
	body: data,
	headStyles: {
		fillColor: [246, 138, 46], // #F68A2E (approved primary orange)
		textColor: 255
	},
	theme: 'striped'
});
```

---

## Form Patterns

### URL Query Prefill

Expense forms support URL query parameters for prefilled values:

```svelte
<script>
	import { page } from '$app/stores';

	// Check for URL prefill
	const prefillCategory = $page.url.searchParams.get('category');

	onMount(() => {
		if (prefillCategory) {
			selectedCategory = prefillCategory;
			// Auto-focus amount input for quick entry
			amountInput?.focus();
		}
	});
</script>
```

### Category Management Modal

Expense categories (maintenance, supplies, etc.) are managed via a settings modal:

```svelte
<!-- Gear icon opens settings modal for category management -->
<button onclick={() => openSettingsModal('maintenance')}>
	<GearIcon />
</button>

<SettingsModal
	bind:open={showSettingsModal}
	category={settingsCategory}
	on:save={handleCategorySave}
/>
```

---

## Session & Inactivity

### Session Timeout (15 minutes)

```typescript
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// Track last activity
localStorage.setItem('lastActivityTime', Date.now().toString());

// Check on page load
const lastActivity = localStorage.getItem('lastActivityTime');
if (Date.now() - Number(lastActivity) > SESSION_TIMEOUT_MS) {
	// Force re-authentication
	goto('/login');
}
```

---

## HughesNet Sync System

### Conflict Detection

When syncing with HughesNet, conflicts are detected by comparing work order IDs:

```svelte
<script>
	let conflictTrips = $state<Trip[]>([]);
	let selectedConflicts = $state<Set<string>>(new Set());
	let conflictTimer = $state(60); // 60-second countdown

	// User selects which version to keep (local or remote)
	function resolveConflict(tripId: string, keepLocal: boolean) {
		if (keepLocal) {
			selectedConflicts.add(tripId);
		} else {
			selectedConflicts.delete(tripId);
		}
	}
</script>
```

### Conflict Resolution Modal

```svelte
{#if conflictTrips.length > 0}
	<Modal title="Sync Conflicts Detected">
		<p>The following trips differ from HughesNet. Select which to keep:</p>
		{#each conflictTrips as trip}
			<ConflictRow {trip} on:select={handleConflictSelection} />
		{/each}
		<p>Auto-resolving in {conflictTimer} seconds...</p>
	</Modal>
{/if}
```

---

## Optimistic Updates Pattern

### Settings Save

```typescript
// src/routes/dashboard/settings/lib/save-settings.ts
export async function saveSettings(
	key: string,
	value: any
): Promise<{ ok: boolean; error?: string }> {
	// 1. Optimistic update - update UI immediately
	userSettings.update((s) => ({ ...s, [key]: value }));

	try {
		// 2. Persist to server
		const res = await fetch('/api/settings', {
			method: 'POST',
			body: JSON.stringify({ [key]: value })
		});

		if (!res.ok) throw new Error('Save failed');

		return { ok: true };
	} catch (error) {
		// 3. Rollback on failure
		userSettings.update((s) => ({ ...s, [key]: previousValue }));
		return { ok: false, error: error.message };
	}
}
```

---

## Scroll Spy Navigation

### IntersectionObserver Pattern

Settings pages use scroll-based navigation highlighting:

```svelte
<script>
	import { onMount } from 'svelte';

	let activeSection = $state('general');

	onMount(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						activeSection = entry.target.id;
					}
				});
			},
			{ rootMargin: '-50% 0px -50% 0px' }
		);

		document.querySelectorAll('[data-section]').forEach((el) => {
			observer.observe(el);
		});

		return () => observer.disconnect();
	});
</script>

<nav class="sticky-nav">
	<a href="#general" class:active={activeSection === 'general'}>General</a>
	<a href="#vehicles" class:active={activeSection === 'vehicles'}>Vehicles</a>
	<a href="#categories" class:active={activeSection === 'categories'}>Categories</a>
</nav>
```

---

## Trash & Restoration

### Multi-Type Trash

The trash page handles multiple record types:

```svelte
<script>
	let recordTypes = $state(['trip', 'expense', 'mileage']);

	async function restoreItem(item: TrashedItem) {
		const endpoint = `/api/${item.type}/restore`;
		await fetch(endpoint, {
			method: 'POST',
			body: JSON.stringify({ id: item.id })
		});
	}
</script>

{#each trashedItems as item}
	<TrashRow
		{item}
		vehicleName={getVehicleDisplayName(item.vehicleId, vehicles)}
		on:restore={() => restoreItem(item)}
	/>
{/each}
```

### Vehicle Display Name Resolution

```typescript
// src/lib/utils/vehicle.ts
export function getVehicleDisplayName(
	raw: string | undefined,
	vehicles?: Array<{ id?: string; name?: string }>
): string {
	if (!raw) return '-';

	// Try to match by ID
	const byId = vehicles?.find((v) => v.id === raw);
	if (byId?.name) return byId.name;

	// Try to match by name
	const byName = vehicles?.find((v) => v.name === raw);
	if (byName?.name) return byName.name;

	// Hide raw UUIDs from users
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(raw)) {
		return 'Unknown vehicle';
	}

	return raw;
}
```

---

## Service Worker

### Cache Strategy

```typescript
// src/service-worker.ts
const CACHE_NAME = `cache-${version}`;

// Network-first for navigation (HTML pages)
// Cache-first for static assets

self.addEventListener('fetch', (event) => {
	if (event.request.mode === 'navigate') {
		// Network-first: try network, fall back to cache, then offline.html
		event.respondWith(
			fetch(event.request)
				.catch(() => caches.match(event.request))
				.catch(() => caches.match('/offline.html'))
		);
	} else {
		// Cache-first for assets
		event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
	}
});
```

### PWA Shortcuts (manifest.json)

```json
{
	"shortcuts": [
		{
			"name": "Start New Trip",
			"url": "/dashboard/trips/new",
			"icons": [...]
		},
		{
			"name": "Log Gas",
			"url": "/dashboard/expenses/new?category=fuel",
			"icons": [...]
		}
	]
}
```

---

## Worker Entry (Password Hashing)

### PBKDF2 Configuration

```typescript
// src/worker-entry.ts
const PBKDF2_ITERATIONS = 100000;
const HASH_ALGORITHM = 'SHA-256';
const SALT_LENGTH = 16; // bytes

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);

	const hash = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt,
			iterations: PBKDF2_ITERATIONS,
			hash: HASH_ALGORITHM
		},
		keyMaterial,
		256
	);

	return `${toBase64(salt)}:${toBase64(new Uint8Array(hash))}`;
}

export function safeCompare(a: string, b: string): boolean {
	// Timing-safe comparison to prevent timing attacks
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}
```

---

## Auto-Migration (Legacy Data)

### Login with Migration

When users login, legacy data is automatically migrated:

```typescript
// src/routes/login/+server.ts
export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	// ... authentication logic ...

	// Trigger migration in background
	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(migrateUserData(userId, platform.env));
	}

	return json({ success: true });
};

async function migrateUserData(userId: string, env: Env) {
	// Migrate from old username-based keys to UUID-based keys
	const oldKey = `trip:${username}:*`;
	const newKey = `trip:${userId}:*`;
	// ... migration logic ...
}
```

---

## Rate Limiting Patterns

### Login Rate Limiting

```typescript
// 5 attempts per 60 seconds
const result = await checkRateLimit(
	kv,
	clientIp,
	'login_attempt',
	5, // limit
	60 // window in seconds
);

if (!result.allowed) {
	return json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
}
```

---

## Date Utilities

### Local Date Handling

```typescript
// src/lib/utils/dates.ts
export function localDateISO(value?: string | Date): string {
	const d = parseToDate(value);
	// Compensate timezone offset for consistent local date
	const tzAdjusted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
	return tzAdjusted.toISOString().split('T')[0];
}

export const getLocalDate = () => localDateISO();
```

---

## Geocoding Validation

### Address Result Quality

```typescript
// src/lib/utils/geocode.ts
export function isAcceptableGeocode(result: any, input: string): boolean {
	// Reject numeric-only labels ("407")
	if (result.name?.trim().match(/^\d+$/)) return false;

	// Reject broad geographic types
	const broadTypes = ['city', 'state', 'country', 'county'];
	if (broadTypes.includes(result.osm_value)) return false;

	// For address inputs (starting with number + street), require house number
	const inputIsAddress = /^\d+\s+\w+/i.test(input);
	if (inputIsAddress) {
		if (!result.house_number || !result.road) return false;
	}

	return true;
}
```

---

## Storage Patterns

### LocalStorage Manager

```typescript
// src/lib/utils/storage.ts
class LocalStorage {
	// Delta sync timestamp
	getLastSync(): string | null {
		return localStorage.getItem('last_sync_time');
	}

	setLastSync(isoString: string): void {
		localStorage.setItem('last_sync_time', isoString);
	}

	// Draft trip auto-save
	getDraftTrip(): Partial<Trip> | null {
		return this.get<Partial<Trip>>('draftTrip');
	}

	saveDraftTrip(draft: Partial<Trip>): void {
		this.set('draftTrip', draft);
	}

	// Settings with partial updates
	saveSettings(settings: Partial<Settings>): void {
		const current = this.getSettings();
		this.set('settings', { ...current, ...settings });
	}
}
```

### Auto-Save (Every 5 Seconds)

```typescript
// Legacy app.js pattern
setInterval(saveDraftTrip, 5000); // Auto-save every 5 seconds
```

---

## Dashboard Analytics

### Time Range Options

```typescript
export type TimeRange = '7d' | '30d' | '60d' | '90d' | '1y' | 'prev-1y' | 'all';
```

### Cost Breakdown Colors (Design System Compliant)

TypeScript
function getCategoryColor(category: string): string {
const map: Record<string, string> = {
fuel: '#F68A2E', // Primary orange (approved)
maintenance: '#2C507B', // Primary blue (approved)
supplies: '#8BC12D', // Accent green (approved)
insurance: '#8F3D91', // Accent purple (approved)
other: '#333333' // Dark gray (approved)
};

    return map[category.toLowerCase()] ?? '#333333';

}

````

---

## Maintenance Reminder Banner

```typescript
export function computeMaintenance(opts: {
	vehicleOdometerStart?: number;
	totalMilesAllTime?: number;
	lastServiceOdometer?: number;
	serviceIntervalMiles?: number;
	reminderThresholdMiles?: number; // default: 500
}) {
	const currentOdometer = vehicleOdometerStart + totalMilesAllTime;
	const milesSinceService = currentOdometer - lastServiceOdometer;
	const dueIn = serviceIntervalMiles - milesSinceService;

	return {
		visible: dueIn <= reminderThresholdMiles,
		message:
			dueIn >= 0
				? `Due in ${dueIn.toLocaleString()} miles`
				: `Overdue by ${Math.abs(dueIn).toLocaleString()} miles`
	};
}
````

### Server Route Safety Checklist (`src/routes/**/+server.ts`)

Before finishing any change to a `+server.ts` file, ensure:

- ✅ Handler returns a `Response` on **all** code paths (never `undefined`).
- ✅ Authentication/validation failures use **early returns** with status codes.
- ✅ Any optional inputs are guarded (no `T | undefined` passed to helpers).
- ✅ Array indexing is checked before use (avoid “possibly undefined”).
- ✅ Remove unreachable code (no logic after a `return`).
