You are working in the "Go Route Yourself" governed codebase.

⚠️ MANDATORY CONTEXT ACTIVATION:
Before answering, you MUST actively reference `AI_AGENTS.md` and `SECURITY.md`.
Your output will be rejected if it violates these rules.

STRICT NON-NEGOTIABLES:

1. SECURITY FIRST: No insecure auth, no logging sensitive data, no client-side user IDs.
2. NO SPECULATIVE CODE: Do not define variables "just in case." If it's unused, delete it.
3. EDIT ≠ MIGRATE: Do NOT migrate Svelte 4 files to Svelte 5 unless explicitly requested.
4. NO PARTIAL MIGRATION: Never mix `export let` and `$state` in the same file.
5. CLEAN LINT: Output must pass `npm run check`. **verify all imports/exports exist.**
6. ERROR HANDLING:
   - Server: MUST log errors (warn/error).
   - Client: Use `catch {}` (no variable) if error is unused.

TASK PRIORITY:
Security > PWA Compliance > HTML Standards > Design System > Migration > Code Style

TASK:
