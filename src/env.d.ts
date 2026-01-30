/// <reference types="@sveltejs/kit" />

// Keep other minimal environment hints in app.d.ts. Avoid duplicating App.Locals here to prevent conflicting declarations.

declare namespace App {
  // Cloudflare Platform types (limited subset)
  interface Platform {
    env: Env; // Use the canonical Env defined in app.d.ts
    context: {
      waitUntil(promise: Promise<unknown>): void;
    };
    caches: CacheStorage & { default: Cache };
  }
}
