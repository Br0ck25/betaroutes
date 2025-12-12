import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		// [!code changed] Simplified test config
		include: ['src/**/*.{test,spec}.{js,ts}'],
		// Optional: explicit environment (defaults to node in Vitest, 
        // usually 'jsdom' is preferred for Svelte component testing if you add that later)
		environment: 'node' 
	}
});