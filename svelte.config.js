import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Remove the 'routes' block.
		// SvelteKit will automatically generate the correct rules to include everything.
		adapter: adapter()
	}
};

export default config;
