import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'url';
import type { ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: (() => {
      // Apply vendor stubs only in the browser build (not during SSR) so server
      // endpoints can import the real libraries when generating PDFs on the server.
      const isSSR = Boolean(process.env['SSR']) || Boolean(process.env['VITE_SSR']);
      if (isSSR) return {};

      return {
        canvg: `${__dirname}/src/lib/vendor-stubs/canvg-stub.ts`,
        html2canvas: `${__dirname}/src/lib/vendor-stubs/html2canvas-stub.ts`
      };
    })()
  },

  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    // Setup file to provide minimal shims for test environment (e.g., indexedDB)
    setupFiles: ['./src/vitest.setup.ts'],
    // Explicit environment (node for server-side tests)
    environment: 'node'
  },

  // Preview server: set Cache-Control headers for assets so local previews emulate CDN
  preview: {
    configurePreviewServer(server: ViteDevServer) {
      // Ensure preview returns long cache headers for static assets used in audits.
      server.middlewares.use((req, res, next) => {
        try {
          const url = req.url ?? '';
          // Match fonts, optimized images, and known static extensions
          if (
            url.startsWith('/fonts/') ||
            url.startsWith('/optimized/') ||
            /\.(?:woff2|woff|png|avif|webp|jpg|jpeg|svg)$/.test(url)
          ) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        } catch {
          // ignore
        }
        next();
      });

      // Move our middleware to the front of the stack so it runs before static file handlers
      try {
        const stack = server.middlewares.stack;
        if (Array.isArray(stack) && stack.length > 0) {
          const middleware = stack.pop();
          if (middleware) {
            stack.unshift(middleware);
          }
        }
      } catch {
        // ignore
      }
    }
  } as any
});
