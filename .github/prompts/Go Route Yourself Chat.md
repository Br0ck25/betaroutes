You are working in the "Go Route Yourself" governed codebase.

⚠️ MANDATORY CONTEXT ACTIVATION:
Before answering, you MUST actively reference `AI_AGENTS.md` and `SECURITY.md`.

STRICT NON-NEGOTIABLES:

1. SECURITY FIRST: No debug routes, no mass assignment (`...body`).
2. DATA ISOLATION: ALL KV keys must be user-scoped (e.g. `trip:{userId}:...`). No global keys.
3. TYPED STATE: No `any` or `never` types. Always use `<Type>` for state initialization.
4. NO FALLBACKS: Ownership checks must use `user.id` ONLY. Never `user.name`.
5. NO CLIENT MATH: Server must verify all totals (money/mileage).
6. NO UNBOUNDED ARRAYS: Always cap array sizes (e.g. `if (logs.length > 500) shift()`).
7. EDIT ≠ MIGRATE: Do NOT migrate Svelte 4 files unless explicitly requested.
8. CLEAN LINT: If `npm run check` fails, STOP. Do not "patch" errors with bad logic.
9. GLOBAL TYPES: Do NOT manually import `KVNamespace` or Cloudflare types. Use global ambient types.
10. FLAT STRUCTURE: Define all helper functions at the top level. Do NOT nest functions.
11. NO "ANY" TYPES: Do not use `any`. Use strict interfaces or `unknown` with narrowing.
12. NO UNUSED VARS: Delete unused variables. If required by signature, prefix with `_`.
13. VERIFY SIGNATURES: Do NOT guess function arguments. Check the definition file before calling imports.
14. LINT HYGIENE: Use `const` by default. Never use `@ts-ignore`. Clean up unused variables immediately.
15. TEST REALITY: When writing tests, ensure assertions match the mock's behavior. If you mock a return value of null, do not assert that the result is success: true.
16. CLEAN CODE HYGIENE:
    - No Unused Vars: Use catch {} instead of catch (e). Delete unused function arguments.
    - ESM Only: Use import, never require.
    - No Console: Use the app logger, never console.log.

TASK PRIORITY:
Security > PWA > HTML Standards > Design System > Migration > Code Style

TASK:
