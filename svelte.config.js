import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Enable legacy component API for test environment so legacy-style `new Component()` works in tests
		// This avoids a broad migration and keeps runtime behavior unchanged for production.
		compatibility: { componentApi: 4 }
	},
	kit: {
		// Remove the 'routes' block.
		// SvelteKit will automatically generate the correct rules to include everything.
		adapter: adapter()
	}
};

export default config;
