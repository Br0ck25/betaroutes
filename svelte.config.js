import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Define your Cloudflare Pages routes here
		adapter: adapter({
			routes: {
				include: ['/dashboard', '/dashboard/*'],
				exclude: []
			}
		})
	}
};

export default config;