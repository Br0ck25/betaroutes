---
description: 'SvelteKit navigation rules (base-aware)'
applyTo: '**/*.svelte,**/*.ts'
---

# SvelteKit Navigation (Lint-clean, base-aware)

Use SvelteKit's canonical resolver for ALL internal navigation.

## Links

✅ Do:

- `import { resolve } from '$app/paths'`
- `<a href={resolve('/privacy')}>Privacy</a>`
- Include query strings INSIDE resolve: `resolve(\`/trips?tag=\${tag}\`)`
- Include hash fragments INSIDE resolve: `resolve(\`/docs#section\`)`

❌ Don't:

- Hardcode internal hrefs like `href="/privacy"`
- Build your own `resolve()` wrapper that the linter won't recognize
- Concatenate resolved parts like `resolve('/trips') + '?tag=' + tag`
- Use `base` directly from `$app/paths`
- Build URLs manually: `\`\${base}/trips\``

## Programmatic navigation

✅ Do:

```typescript
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

// Navigate to internal route
goto(resolve('/dashboard'));

// With query params
goto(resolve(`/trips?filter=${filter}`));

// With options
goto(resolve('/settings'), { replaceState: true });
```

❌ Don't:

```typescript
// Missing resolve
goto('/dashboard');

// Manual base handling
goto(base + '/dashboard');

// Building URL manually
goto(`${base}/trips?filter=${filter}`);
```

## Dynamic routes

✅ Do:

```svelte
<script lang="ts">
  import { resolve } from '$app/paths';

  let tripId = $state('123');
</script>

<a href={resolve(`/trips/${tripId}`)}>View Trip</a>
```

❌ Don't:

```svelte
<!-- Missing resolve -->
<a href="/trips/{tripId}">View Trip</a>
```

## External links

For external URLs, use them directly (no resolve):

```svelte
<!-- External link (no resolve) -->
<a href="https://example.com" target="_blank" rel="noopener noreferrer"> External Site </a>

<!-- Internal link (use resolve) -->
<a href={resolve('/privacy')}>Privacy Policy</a>
```

## Why this matters

- Ensures app works when deployed to subpaths
- Prevents broken links in production
- Lint-clean (no custom wrappers needed)
- Compatible with SvelteKit's routing
