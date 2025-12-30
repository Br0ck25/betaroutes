import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { resolve } from 'path';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: (() => {
		// Apply vendor stubs only in the browser build (not during SSR) so server
		// endpoints can import the real libraries when generating PDFs on the server.
		// Access environment keys using index signature to satisfy TS.
		const isSSR = Boolean(process.env['SSR']) || Boolean(process.env['VITE_SSR']);
		return isSSR
			? ({ alias: {} } as { alias: Record<string, string> })
			: ({
				alias: {
					canvg: resolve(__dirname, 'src/lib/vendor-stubs/canvg-stub.ts'),
					html2canvas: resolve(__dirname, 'src/lib/vendor-stubs/html2canvas-stub.ts')
				}
			} as { alias: Record<string, string> });
	})(),

	test: {
		// [!code changed] Simplified test config
		include: ['src/**/*.{test,spec}.{js,ts}'],
		// Optional: explicit environment (defaults to node in Vitest,
		// usually 'jsdom' is preferred for Svelte component testing if you add that later)
		environment: 'node'
	},

	// Preview server: set Cache-Control headers for assets so local previews emulate CDN
	preview: ({
		// `configurePreviewServer` isn't exported in some Vite types; keep `any` to avoid type conflicts
		configurePreviewServer(server: any) {
			// Ensure preview returns long cache headers for static assets used in audits.
			const mw = (req: any, res: any, next: any) => {
				try {
					const url = req.url || '';
					// Match fonts, optimized images, and known static extensions
					if (
						url.startsWith('/fonts/') ||
						url.startsWith('/optimized/') ||
						/\.(?:woff2|woff|png|avif|webp|jpg|jpeg|svg)$/.test(url)
					) {
						res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
					}
				} catch (e) {
					// ignore
				}
				next();
			};

			server.middlewares.use(mw as any);
			// Move our middleware to the front of the stack so it runs before static file handlers
			try {
				const stack = (server.middlewares as any).stack;
				if (Array.isArray(stack) && stack.length > 0) {
					stack.unshift(stack.pop());
				}
			} catch (e) {
				// ignore
			}
		}
	} as any),
});
