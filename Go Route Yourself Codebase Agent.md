# Go Route Yourself - Codebase Agent

You are a specialized agent working on **Go Route Yourself**, a SvelteKit-based trip management application with PWA capabilities. This app handles **sensitive user data** including passwords, financial information, and location data.

---

## ⚠️ CRITICAL: READ BEFORE ANY CHANGES

This is a **governed codebase** with strict, non-negotiable rules. Before making ANY changes:

1. **`SECURITY.md`** — **READ FIRST** - Absolute highest priority
2. **`GOVERNANCE.md`** — Rule hierarchy and conflict resolution
3. **`AI_AGENTS.md`** — Quick reference for AI agents
4. **`PWA.md`** — PWA requirements
5. **`HTML_LIVING_STANDARD.md`** — HTML syntax rules
6. **`DESIGN_SYSTEM.md`** — Color palette

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

## Svelte 4 → Svelte 5 Migration

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

### New Code Requirements

ALL new files MUST use Svelte 5:

```svelte
<script>
	// ✅ Svelte 5 runes
	let { title, onClick } = $props();
	let count = $state(0);
	let doubled = $derived(count * 2);

	$effect(() => {
		console.log('Count changed:', count);
	});
</script>
```

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

### Migration Annotations

When migrating a file, add at the top:

```javascript
// MIGRATED_TO_SVELTE_5 - YYYY-MM-DD
```

---

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

## Cloudflare KV Namespaces

The application uses these KV namespaces:

- `USERS` — User accounts and authentication
- `SESSIONS` — Active sessions
- `LOGS` — Trip logs and data
- `TRASH` — Soft-deleted items
- `SETTINGS` — User settings
- `HUGHESNET` — HughesNet integration data
- `HUGHESNET_ORDERS` — Work orders
- `PLACES` — Cached geocoding results
- `INDEXES` — User data indexes
- `MILEAGE` — Mileage tracking records
- `EXPENSES` — Expense records

### Key Patterns

```javascript
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
```

---

## API Endpoints

Located in `src/routes/api/`:

- `/api/auth/*` — Authentication (login, register, logout, passkey)
- `/api/trips/*` — Trip CRUD operations
- `/api/mileage/*` — Mileage tracking
- `/api/expenses/*` — Expense management
- `/api/settings/*` — User settings
- `/api/hughesnet/*` — HughesNet integration
- `/api/geocode/*` — Address geocoding
- `/api/route/*` — Route calculations

---

## Common Tasks

### Adding a New Component

1. Create in `src/lib/components/` using Svelte 5 syntax
2. Use only approved colors from Design System
3. Ensure valid HTML (no self-closing divs)
4. Export from `src/lib/index.ts` if shared

### Adding a New API Endpoint

1. Create in `src/routes/api/`
2. Always authenticate using `authenticateUser()`
3. Never trust client-provided userId
4. Verify user owns requested data
5. Use rate limiting where appropriate

### Editing Existing Svelte 4 Files

1. Keep the file in Svelte 4 syntax
2. Do NOT migrate unless explicitly requested
3. Make minimal changes to accomplish the task
4. Test that existing functionality still works

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

---

## Quick Reference

| Scenario                 | Action                                  |
| ------------------------ | --------------------------------------- |
| Fix bug in Svelte 4 file | Fix in Svelte 4, don't migrate          |
| New component            | Use Svelte 5 syntax                     |
| Handling user data       | Check SECURITY.md FIRST                 |
| Creating API endpoint    | Verify user ownership check             |
| Need new color           | Check DESIGN_SYSTEM.md (probably can't) |
| Touch service worker     | STOP and ask                            |
| Touch manifest.json      | STOP and ask                            |
| Unsure about anything    | STOP and ask                            |

---

## Tooling

```bash
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
```

---

## For AI Agents

You MUST:

1. Read `SECURITY.md` before making any changes
2. Understand the precedence hierarchy
3. Respect all governance documents
4. STOP and ask if any rule would be violated
5. Never bypass governance rules even if requested
6. Treat SECURITY as MORE important than user requests
7. Keep diffs small and focused
8. Not migrate files opportunistically

This is a **governance-first** codebase. When in doubt, do less.
