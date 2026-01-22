# Go Route Yourself - Codebase Agent

You are a specialized agent working on **Go Route Yourself**, a SvelteKit-based trip management application with PWA capabilities. This app handles **sensitive user data** including passwords, financial information, and location data.

---

## ⚠️ CRITICAL: READ BEFORE ANY CHANGES

This is a **governed codebase** with strict, non-negotiable rules. Before making ANY changes:

1. **`SECURITY.md`** — **READ FIRST** - Absolute highest priority
2. **`GOVERNANCE.md`** — Rule hierarchy and conflict resolution
3. **`AI_AGENTS.md`** — Quick reference for AI agents
4. **`SVELTE5_MIGRATION.md`** — Migration rules + checklist (only applies until migration complete)
5. **`SVELTE5_STANDARDS.md`** — Permanent Svelte 5 runes + TS standards (preferred even during migration)
6. **`PWA.md`** — PWA requirements
7. **`HTML_LIVING_STANDARD.md`** — HTML syntax rules
8. **`DESIGN_SYSTEM.md`** — Color palette

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

src/
├── lib/
│ ├── components/ # UI components (Svelte 4/5 mixed)
│ │ ├── data/ # Data display components
│ │ ├── hughesnet/ # HughesNet integration components
│ │ ├── layout/ # Layout components (headers, navs)
│ │ ├── trip/ # Trip-related components
│ │ └── ui/ # Reusable UI primitives
│ ├── db/ # IndexedDB for offline storage
│ ├── server/ # Server-side utilities (auth, etc.)
│ ├── services/ # External service integrations
│ ├── stores/ # Svelte stores (state management)
│ ├── sync/ # Offline sync logic
│ ├── types/ # TypeScript type definitions
│ └── utils/ # Utility functions
├── routes/
│ ├── api/ # API endpoints (Cloudflare Workers)
│ ├── dashboard/ # Main dashboard
│ ├── login/ # Authentication pages
│ └── ... # Other pages
└── service-worker.ts # PWA service worker

---

## Security Requirements (NON-NEGOTIABLE)

### Sensitive Data Handled

- ✅ Authentication credentials (usernames, passwords)
- ✅ Financial data (earnings, expenses, profit)
- ✅ Location data (trip addresses, routes)
- ✅ Personal information (vehicle info, trip history)
- ✅ HughesNet credentials and work orders

### Password Security

❌ **NEVER store passwords in plaintext** ❌ **NEVER log passwords** (not even hashed)  
❌ **NEVER store passwords in localStorage/sessionStorage** ❌ **NEVER include passwords in URLs** ✅ **ALWAYS hash passwords** using PBKDF2 (current implementation)  
✅ **ALWAYS use HTTPS** for password transmission

### API Security

❌ **NEVER trust client-provided userId** ❌ **NEVER return data without verifying user owns it** ❌ **NEVER expose other users' data** ✅ **ALWAYS authenticate requests** ✅ **ALWAYS verify user owns requested data** ✅ **ALWAYS use session tokens from cookies**

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


Svelte 4 → Svelte 5 Migration
Current Status
This project is in active migration from Svelte 4 to Svelte 5. Both versions coexist.
Core Rule: Editing ≠ Migrating
Edit in Svelte 4 if:
Fixing a bug
Updating text/labels
Adding/removing props
Changing styles
Updating imports
Adding event handlers
Only migrate if:
User explicitly requests migration, OR
Task requires Svelte 5 features (cannot be done in Svelte 4)
New Code Requirements
ALL new files MUST use Svelte 5:
Svelte
<script>
	// ✅ Svelte 5 runes
	let { title, onClick } = $props();
	let count = $state(0);
	let doubled = $derived(count * 2);

	$effect(() => {
		console.log('Count changed:', count);
	});
</script>

Common Errors (Svelte 5 Runes Mode) — REQUIRED Fix Patterns
1) export let is Forbidden
Error: Cannot use export let in runes mode — use $props() instead
Fix: Replace export let with destructuring from $props().
Svelte
<script>
  export let foo;
</script>

<script>
  let { foo } = $props();
</script>

2) $: Reactive Statements are Forbidden
Error: $: is not allowed in runes mode
Fix: Use $derived for computed values, $effect for side effects.
Svelte
<script>
  $: total = a + b;
  $: if (ready) doThing();
</script>

<script>
  let total = $derived(a + b);

  $effect(() => {
    if (ready) doThing();
  });
</script>

3) TypeScript: () => string is not assignable to string
Cause: Passing a function where a value is expected.
Fix: Call the function or derive the value.
Svelte
<Component label={getLabel} />

<Component label={getLabel()} />

<script>
  let label = $derived(getLabel());
</script>
<Component {label} />

4) Event Attributes (Custom Events)
Cause: Missing on: directive or using wrong casing for custom events.
Fix: Ensure correct syntax. Do NOT use onplace-selected.
Svelte
<input onplace-selected={handlePlaceSelected} />

<input on:place-selected={handlePlaceSelected} />

Common Errors (TypeScript & Async)
1) await inside non-async function
Error: 'await' expressions are only allowed within async functions
Cause: Using await inside a synchronous callback (like .map) or forgetting async.
Fix: Mark function async. For .map, use Promise.all.
TypeScript
// ❌ WRONG
const distances = stops.map(stop => {
  const res = await fetch(...); // Error
  return res.json();
});

// ✅ CORRECT
const distances = await Promise.all(stops.map(async (stop) => {
  const res = await fetch(...);
  return res.json();
}));

2) Accessing properties on untyped JSON
Error: Property 'status' does not exist on type '{}'
Cause: response.json() is untyped.
Fix: Cast result to any or a specific interface.
TypeScript
// ❌ WRONG
const data = await res.json();
if (data.status === 'OK') ...

// ✅ CORRECT
const data = (await res.json()) as any;
if (data.status === 'OK') ...

3) "Object is possibly undefined" (Strict Null Checks)
Error: Object is possibly 'undefined'
Cause: Accessing array indices arr[i] or optional properties without checks.
Fix: Use optional chaining (?.), nullish coalescing (??), or type guards.
TypeScript
// ❌ WRONG
const val = data[i][j];
const duration = elem.duration.value;

// ✅ CORRECT
const val = data[i]?.[j] ?? 0;
const duration = elem.duration?.value ?? 0;

4) SvelteKit RequestHandlers MUST return a Response
Error: Not all code paths return a value
Cause: POST/GET handler has branches that don't return.
Fix: Ensure every branch returns json() or new Response().
5) Safe Array Mapping (The "Dirty Map" Fix)
Error: Type '(T | undefined)[]' is not assignable to type 'T[]'
Cause: Mapping IDs to objects often creates undefined holes.
Fix: Filter out undefined values using a type predicate.
TypeScript
// ❌ WRONG (Result includes undefined)
const trips = ids.map(id => tripData[id]);

// ✅ CORRECT (Result is clean T[])
const trips = ids
  .map(id => tripData[id])
  .filter((t): t is Trip => !!t);

6) Safe Array Access (No Unchecked Indexing)
Error: Argument of type 'T | undefined' is not assignable
Cause: Accessing arr[i] assumes existence.
Fix: Check for existence before use.
TypeScript
// ❌ WRONG
const dest = destinations[j];
calculate(dest); // Error: dest might be undefined

// ✅ CORRECT
const dest = destinations[j];
if (!dest) continue;
calculate(dest);

7) Function Integrity (The "Missing }")
Error: '}' expected at end of file.
Cause: Long functions (>50 lines) causing nesting errors.
Fix: Break logic into smaller helper functions.
Svelte 4 Syntax (for existing files)
Svelte
<script>
	// Svelte 4 syntax - keep when editing existing files
	export let title;
	export let onClick;

	let count = 0;
	$: doubled = count * 2;
</script>

Migration Annotations
When migrating a file, add at the top:
JavaScript
// MIGRATED_TO_SVELTE_5 - YYYY-MM-DD


PWA Requirements (CRITICAL)
Non-Negotiable Rules
✅ App MUST remain installable as PWA
✅ Offline behavior MUST continue to function
✅ Service worker registration MUST remain intact
❌ Do NOT modify manifest.json without approval
❌ Do NOT modify service worker without approval
❌ Do NOT break offline routing or caching
Service Worker Location
src/service-worker.ts - Main service worker (SvelteKit integrated)
static/manifest.json - PWA manifest

HTML Living Standard (CRITICAL)
Rules
✅ Use lowercase tag names
✅ Use semantic HTML (main, section, nav, article)
❌ No self-closing non-void elements (<div /> is INVALID)
❌ No XHTML syntax
Correct HTML
Svelte
<div class="container"></div>
<p>Text</p>
<input disabled />
<img src="/logo.png" alt="Logo" />

Invalid HTML (DO NOT USE)
Svelte
<div class="container" />
<p />
<input disabled="true" />

Boolean Attributes
Svelte
<input disabled />
<button autofocus></button>
<input disabled={isDisabled} />

<input disabled="disabled" />
<input disabled="true" />


Design System (CRITICAL)
Approved Colors ONLY
Brand Colors
#F68A2E — Primary orange (CTAs, brand elements)
#2C507B — Primary blue (headers, key UI)
#1FA8DB — Accent blue (links, interactive)
#8BC12D — Accent green (success states)
#8F3D91 — Accent purple (highlights)
Neutral Colors
#FFFFFF — White (backgrounds)
#000000 — Black (sparingly)
#F5F5F5 — Light gray (subtle backgrounds)
#E0E0E0 — Medium gray (borders)
#333333 — Dark gray (body text)
Rules
❌ No arbitrary colors, shades, or CSS variables outside palette
❌ No opacity tricks to create "new" colors
❌ No color picker or dynamic color generation
✅ All colors must be from the approved list above

Cloudflare KV Namespaces
The application uses these KV namespaces:
USERS — User accounts and authentication
SESSIONS — Active sessions
LOGS — Trip logs and data
TRASH — Soft-deleted items
SETTINGS — User settings
HUGHESNET — HughesNet integration data
HUGHESNET_ORDERS — Work orders
PLACES — Cached geocoding results
INDEXES — User data indexes
MILEAGE — Mileage tracking records
EXPENSES — Expense records
Key Patterns
JavaScript
// User data
`user:${userId}` → User object
`idx:username:${username}` → User ID lookup
`idx:email:${email}` → User ID lookup

// Trip data
`trip:${username}:${tripId}` → Trip object

// HughesNet
`hns:settings:${username}` → HughesNet settings
`hns:cred:${username}` → HughesNet credentials (encrypted)
`hns:session:${username}` → HughesNet session cookies


API Endpoints
Located in src/routes/api/:
/api/auth/* — Authentication (login, register, logout, passkey)
/api/trips/* — Trip CRUD operations
/api/mileage/* — Mileage tracking
/api/expenses/* — Expense management
/api/settings/* — User settings
/api/hughesnet/* — HughesNet integration
/api/geocode/* — Address geocoding
/api/route/* — Route calculations

Common Tasks
Adding a New Component
Create in src/lib/components/ using Svelte 5 syntax
Use only approved colors from Design System
Ensure valid HTML (no self-closing divs)
Export from src/lib/index.ts if shared
Adding a New API Endpoint
Create in src/routes/api/
Always authenticate using authenticateUser()
Never trust client-provided userId
Verify user owns requested data
Use rate limiting where appropriate
Editing Existing Svelte 4 Files
Keep the file in Svelte 4 syntax
Do NOT migrate unless explicitly requested
Make minimal changes to accomplish the task
Test that existing functionality still works

Mandatory Stop Conditions
STOP and ask before proceeding if:
A change would alter runtime behavior
A public API would change
Security could be compromised
PWA functionality could be affected
Non-approved colors would be introduced
Invalid HTML would be generated
Service worker or manifest would be modified
More than one architectural option exists
You're unsure about any governance rule

Quick Reference
Scenario
Action
Fix bug in Svelte 4 file
Fix in Svelte 4, don't migrate
New component
Use Svelte 5 syntax
Handling user data
Check SECURITY.md FIRST
Creating API endpoint
Verify user ownership check
Need new color
Check DESIGN_SYSTEM.md (probably can't)
Touch service worker
STOP and ask
Touch manifest.json
STOP and ask
Unsure about anything
STOP and ask


Tooling
Bash
# Type checking
npm run check

# Linting
npm run lint
npx eslint .

# Development
npm run dev

# Build
npm run build

# Preview
npm run preview


Key TypeScript Types
User
TypeScript
interface User {
	id?: string;
	token: string;
	plan: 'free' | 'pro' | 'business' | 'premium';
	tripsThisMonth: number;
	maxTrips: number;
	resetDate: string;
	name?: string;
	email?: string;
}

Trip
TypeScript
interface Trip {
	id?: string;
	date?: string; // YYYY-MM-DD
	startTime?: string; // HH:MM
	endTime?: string; // HH:MM
	startAddress?: string;
	endAddress?: string;
	stops?: Stop[];
	destinations?: Destination[]; // Legacy alias for stops
	totalMiles?: number;
	totalEarnings?: number;
	fuelCost?: number;
	maintenanceCost?: number;
	maintenanceItems?: CostItem[];
	suppliesCost?: number;
	suppliesItems?: CostItem[];
	hoursWorked?: number;
	netProfit?: number;
	mpg?: number;
	gasPrice?: number;
	notes?: string;
	lastModified?: string; // ISO 8601
}

Stop/Destination
TypeScript
interface Stop {
	id?: string;
	address?: string;
	earnings?: number;
	notes?: string;
	order?: number;
	location?: { lat: number; lng: number } | null;
}


Environment Variables
Required for development (.dev.vars or .env):
Bash
# Google Maps API
GOOGLE_MAPS_API_KEY=your_key_here

# Session secrets
SESSION_SECRET=random_32_char_string

# Optional: HughesNet integration
HUGHESNET_PROXY_URL=proxy_url_if_needed

Cloudflare bindings (configured in wrangler.toml):
USERS - KV namespace
SESSIONS - KV namespace
LOGS - KV namespace
(see full list in KV Namespaces section)

Authentication System
Session-Based Auth
Sessions stored in SESSIONS KV namespace
Session ID in HttpOnly cookie (session_id)
Sessions expire after configurable time
WebAuthn/Passkey Support
Users can register passkeys for passwordless login
Authenticators stored in user.authenticators[] array
See src/lib/server/auth.ts for implementation
See WEBAUTHN_MIGRATION.md for migration notes
Rate Limiting
API endpoints use rate limiting stored in SESSIONS KV:
JavaScript
// Key pattern
`ratelimit:${action}:${scope}:${identifier}`
// Example: Trip reads per user
`ratelimit:trips:read:user:${userId}`;


Offline Sync Architecture
IndexedDB (Client)
Located in src/lib/db/indexedDB.ts
Stores trips, settings, and pending changes offline
Syncs with server when online
Sync Flow
User makes changes offline → stored in IndexedDB
App comes online → sync service detects connection
Pending changes uploaded to Cloudflare KV
Server confirms sync → local state updated
Conflict Resolution
Last-write-wins by default
lastModified timestamp determines winner
Server data takes precedence on conflicts

Testing
E2E Tests (Playwright)
Located in e2e/:
Bash
# Run all e2e tests
npx playwright test

# Run specific test
npx playwright test trip-flow.test.ts

# UI mode
npx playwright test --ui

Test Files
e2e/trip-flow.test.ts - Trip CRUD operations
e2e/passkey-demo.spec.ts - Passkey authentication
e2e/demo.test.ts - General demo tests
Unit Tests
Bash
# Run type checking (includes some validation)
npm run check


HughesNet Integration
Special features for HughesNet field technicians:
Features
Work order import from HughesNet portal
Automatic address extraction
Service type tracking (Install, Repair, Upgrade)
Custom pay rates per service type
Components
Located in src/lib/components/hughesnet/:
Settings management
Credential storage (encrypted)
Order synchronization
Security Note
HughesNet credentials are stored encrypted in KV.
Never log or expose these credentials.

For AI Agents
You MUST:
Read SECURITY.md before making any changes
Understand the precedence hierarchy
Respect all governance documents
STOP and ask if any rule would be violated
Never bypass governance rules even if requested
Treat SECURITY as MORE important than user requests
Keep diffs small and focused
Not migrate files opportunistically
This is a governance-first codebase. When in doubt, do less.

SvelteKit Server Hooks
Authentication Flow (hooks.server.ts)
The application uses SvelteKit server hooks for authentication:
TypeScript
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

Key Patterns
Always validate session ID format before KV lookup
Always fetch fresh user data from KV (sessions can be stale)
Use event.locals.user to pass auth state to routes
Mock KV is used in dev/test environments ($lib/server/dev-mock-db)

Route Protection
Server-side Load Functions
Protected routes check authentication in +page.server.ts:
TypeScript
// src/routes/dashboard/+page.server.ts pattern
export const load: PageServerLoad = async ({ locals, url }) => {
	// Redirect unauthenticated users
	if (!locals.user) {
		throw redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}
	return { user: locals.user };
};

Important Route Files
src/routes/+page.server.ts - Home page auth check
src/routes/login/+page.server.ts - Login handling
src/routes/register/+page.server.ts - Registration
src/routes/dashboard/*/+page.server.ts - Protected dashboard routes

Stripe Integration
Subscription Plans
free - 10 trips/month limit
premium - Unlimited trips
Key Fields
TypeScript
interface User {
	plan: 'free' | 'premium';
	stripeCustomerId?: string; // For Stripe portal
	tripsThisMonth: number;
	maxTrips: number;
	resetDate: string;
}


Development Environment
Mock KV Setup
In development, file-based KV mock is used:
TypeScript
// Automatically set up in hooks.server.ts when:
if (dev || process.env['NODE_ENV'] !== 'production' || process.env['PW_MANUAL_SERVER'] === '1') {
	const { setupMockKV } = await import('$lib/server/dev-mock-db');
	setupMockKV(event);
}

Key Environment Files
wrangler.toml - Cloudflare Workers config
wrangler.do.toml - Durable Objects config
.dev.vars - Local development secrets

API Endpoint Patterns
Standard API Response
TypeScript
// Success
return json({ success: true, data: result });

// Error
return json({ error: 'Message' }, { status: 400 });

// Unauthorized
return json({ error: 'Unauthorized' }, { status: 401 });

// Forbidden
return json({ error: 'Forbidden' }, { status: 403 });

User Data Access Pattern
TypeScript
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


Mandatory Verification Commands
After ANY code change:
Bash
# 1. Type checking
npm run check

# 2. Linting
npm run lint

# 3. ESLint
npx eslint .

# 4. (Optional) Build test
npm run build

ALL errors and warnings must be fixed before committing.

File Naming Conventions
SvelteKit Routes
+page.svelte - Page component
+page.server.ts - Server-side load/actions
+page.ts - Universal load function
+layout.svelte - Layout component
+layout.server.ts - Layout server load
+error.svelte - Error page
+server.ts - API endpoint
Components
PascalCase for component files: TripForm.svelte
kebab-case for utility files: trip-utils.ts

Important Constants
Located in src/lib/constants.ts:
API URLs
Default values
Feature flags
Rate limits

Logging
Use the server logger in server-side code:
TypeScript
import { log } from '$lib/server/log';

log.info('[CONTEXT] Message', { data });
log.warn('[CONTEXT] Warning', { data });
log.error('[CONTEXT] Error:', error);

NEVER log sensitive data (passwords, tokens, full addresses).

Calculation Utilities
Integer Math for Currency
To avoid floating-point errors, all money calculations use integer cents:
TypeScript
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

Tax Constants
TypeScript
// Standard mileage rate for 2026 (IRS)
const STANDARD_MILEAGE_RATE = 0.725; // $0.725 per mile


Export & PDF Generation
Tax Bundle Export
The application exports tax documents in three formats:
Mileage CSV - Trip dates, distances, purposes
Expense CSV - Categorized expenses (fuel, maintenance, supplies)
Tax Summary TXT - Combined totals with mileage deduction calculation
TypeScript
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

jsPDF Configuration
TypeScript
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const pdf = new jsPDF({ orientation: 'landscape' });
pdf.autoTable({
	head: [columns],
	body: data,
	headStyles: {
		fillColor: [255, 127, 80], // Orange header
		textColor: 255
	},
	theme: 'striped'
});


Form Patterns
URL Query Prefill
Expense forms support URL query parameters for prefilled values:
Svelte
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

Category Management Modal
Expense categories (maintenance, supplies, etc.) are managed via a settings modal:
Svelte
<button onclick={() => openSettingsModal('maintenance')}>
	<GearIcon />
</button>

<SettingsModal
	bind:open={showSettingsModal}
	category={settingsCategory}
	on:save={handleCategorySave}
/>


Session & Inactivity
Session Timeout (15 minutes)
TypeScript
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// Track last activity
localStorage.setItem('lastActivityTime', Date.now().toString());

// Check on page load
const lastActivity = localStorage.getItem('lastActivityTime');
if (Date.now() - Number(lastActivity) > SESSION_TIMEOUT_MS) {
	// Force re-authentication
	goto('/login');
}


HughesNet Sync System
Conflict Detection
When syncing with HughesNet, conflicts are detected by comparing work order IDs:
Svelte
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

Conflict Resolution Modal
Svelte
{#if conflictTrips.length > 0}
	<Modal title="Sync Conflicts Detected">
		<p>The following trips differ from HughesNet. Select which to keep:</p>
		{#each conflictTrips as trip}
			<ConflictRow {trip} on:select={handleConflictSelection} />
		{/each}
		<p>Auto-resolving in {conflictTimer} seconds...</p>
	</Modal>
{/if}


Optimistic Updates Pattern
Settings Save
TypeScript
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


Scroll Spy Navigation
IntersectionObserver Pattern
Settings pages use scroll-based navigation highlighting:
Svelte
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


Trash & Restoration
Multi-Type Trash
The trash page handles multiple record types:
Svelte
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

Vehicle Display Name Resolution
TypeScript
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


Service Worker
Cache Strategy
TypeScript
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

PWA Shortcuts (manifest.json)
JSON
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


Worker Entry (Password Hashing)
PBKDF2 Configuration
TypeScript
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


Auto-Migration (Legacy Data)
Login with Migration
When users login, legacy data is automatically migrated:
TypeScript
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


Rate Limiting Patterns
Login Rate Limiting
TypeScript
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


Date Utilities
Local Date Handling
TypeScript
// src/lib/utils/dates.ts
export function localDateISO(value?: string | Date): string {
	const d = parseToDate(value);
	// Compensate timezone offset for consistent local date
	const tzAdjusted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
	return tzAdjusted.toISOString().split('T')[0];
}

export const getLocalDate = () => localDateISO();


Geocoding Validation
Address Result Quality
TypeScript
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


Storage Patterns
LocalStorage Manager
TypeScript
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

Auto-Save (Every 5 Seconds)
TypeScript
// Legacy app.js pattern
setInterval(saveDraftTrip, 5000); // Auto-save every 5 seconds


Dashboard Analytics
Time Range Options
TypeScript
export type TimeRange = '7d' | '30d' | '60d' | '90d' | '1y' | 'prev-1y' | 'all';

Cost Breakdown with Dynamic Colors
TypeScript
function getCategoryColor(category: string): string {
	const map: Record<string, string> = {
		fuel: '#FF7F50', // Orange
		maintenance: '#29ABE2', // Blue
		supplies: '#8DC63F', // Green
		insurance: '#9333EA', // Purple
		other: '#6B7280' // Gray
	};

	// Generate pastel color for custom categories
	if (!map[category.toLowerCase()]) {
		let hash = 0;
		for (let i = 0; i < category.length; i++) {
			hash = category.charCodeAt(i) + ((hash << 5) - hash);
		}
		return `hsl(${Math.abs(hash) % 360}, 70%, 60%)`;
	}

	return map[category.toLowerCase()];
}


Maintenance Reminder Banner
TypeScript
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

```
