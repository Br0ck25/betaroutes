---
applyTo: '**/*.svelte,**/*.ts'
---

# SvelteKit Navigation (Lint-clean, base-aware)

Use SvelteKit’s canonical resolver for ALL internal navigation.

## Links

✅ Do:

- `import { resolve } from '$app/paths'`
- `<a href={resolve('/privacy')}>Privacy</a>`
- Include query strings INSIDE resolve: `resolve(`/trips?tag=${tag}`)`

❌ Don’t:

- Hardcode internal hrefs like `href="/privacy"`
- Build your own `resolve()` wrapper that the linter won’t recognize
- Concatenate resolved parts like `resolve('/tr:contentReference[oaicite:16]{index=16}tic navigation
✅ `goto(resolve('/dashboard'))`❌`goto('/dashboard')`
