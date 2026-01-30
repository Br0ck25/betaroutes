MANDATORY CONTEXT ACTIVATION: Before answering, you MUST actively reference:

1. AGENTS.md (router - read FIRST to determine which docs apply)
2. ERROR_PATTERNS_AND_STOP_CONDITIONS.md (error prevention guide)
3. SECURITY.md (zero trust rules)
4. APPLICATION_CONTEXT.md (implementation patterns & examples)
   Use the AGENTS.md router to consult other docs (ARCHITECTURE / SVELTE5_STANDARDS / PWA / HTML / DESIGN) as needed.

STRICT NON-NEGOTIABLES:

SECURITY FIRST
• No debug/backdoor routes. No auth bypass.
• No mass assignment: never ...body / never dump request.json() directly into storage.
• NO FALLBACKS: ownership checks use locals.user.id only. Never user.name/email. Never accept userId/owner from request body.
• Use security wrappers: getUserTrips(userId), saveUserTrip(trip, userId), etc. Never raw IndexedDB access.
• CLIENT FETCH: All state-changing requests (POST/PUT/DELETE) MUST use `csrfFetch` from `$lib/utils/csrf`.

DATA ISOLATION
• ALL KV/D1/DO keys must be user-scoped composite keys (e.g. trip:${locals.user.id}:${tripId}).
• No global key prefixes / global lists.
• ALL IndexedDB access MUST use security wrappers from $lib/db/queries.ts.
• Logout MUST call clearUserData(userId) to prevent cross-user contamination.

SYNC QUEUE ISOLATION
• syncManager.addToQueue() MUST receive userId parameter.
• Every sync queue item MUST include userId for proper cleanup on logout.

PWA / CACHING
• Service Worker MUST never cache /api/** or any user-specific responses.
• /api/** responses MUST set Cache-Control: no-store.

STRICT NAVIGATION
• Internal <a> MUST use resolve() from $app/paths.
• No base imports. Keep query strings inside resolve().

SVELTE 5 (RUNES ONLY)
• No legacy syntax: export let, $:, createEventDispatcher, onMount, <slot>, $$props, $$restProps.
• No mixed syntax. Use runes + modern DOM attributes (onclick, not on:click).
• HTML must follow HTML_LIVING_STANDARD.md (no <div />, etc.).

TYPE SAFETY
• lang="ts" required if any TS syntax is used.
• No any, no // @ts-ignore (use // @ts-expect-error only with a justification).
• Typed state always ($state<Type>(...) / Type[]), no never[].

SERVER HANDLERS
• In +server.ts, every code path must return a Response (json(...), redirect(...)) or throw error(...) / throw redirect(...). No fallthrough.
• Use platform.env for secrets (NEVER process.env).

QUALITY / HYGIENE
• If npm run gate fails, STOP. Don't "patch" errors with insecure logic or exceptions.
• Verify signatures; don't guess.
• No unused vars; use catch {} when error is unused; remove unused args (or prefix with \_).
• ESM only: import, never require.
• DESIGN SYSTEM: No arbitrary Tailwind values (e.g. w-[13px], bg-[#123]). Use only approved tokens from DESIGN_SYSTEM.md.

LIMITS
• No unbounded arrays; cap growth (e.g. keep max N entries).

TASK PRIORITY: Security > PWA > Architecture > Svelte 5 standards > HTML standards > Design system > Code style

Task:
