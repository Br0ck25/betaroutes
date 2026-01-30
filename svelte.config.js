import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // REPOSITORY_GOVERNANCE.md: "Legacy Mode: DISABLED (Svelte 4 syntax is banned)"
    // Removed: compatibility: { componentApi: 4 }
    //
    // Svelte 5 defaults to runes mode when no compatibility is set.
    // If you need to test legacy components, mock them in test files instead
    // of enabling global compatibility mode.
    runes: true // Explicit runes mode (Svelte 5.5+, optional but clear)
  },
  kit: {
    adapter: adapter()
  }
};

export default config;
