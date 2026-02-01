// src/routes/+layout.server.ts
//
// Server-side layout loader
// Per ARCHITECTURE.md: Use platform.env for secrets (NOT process.env)

import type { LayoutServerLoad } from './$types';
import { getEnv } from '$lib/server/env';

/**
 * Public user data (safe to expose to client)
 */
export type PublicUser = {
  id: string;
  name: string;
  plan: 'free' | 'premium';
  tripsThisMonth?: number;
};

/**
 * Root layout loader
 * Provides user data and environment to all pages
 */
export const load: LayoutServerLoad = async ({ locals, url, platform }) => {
  // Get environment bindings safely
  const env = getEnv(platform);

  // SECURITY NOTE:
  // Keep this public object minimal. Avoid using email/token/etc here (publicly exposed).
  // Name is a display-only string; if you later want a real display name, add it to locals on the server,
  // and pass only that sanitized field through here.
  const publicUser: PublicUser | null =
    locals.user && typeof locals.user.id === 'string'
      ? {
          id: locals.user.id,
          name: 'User',
          plan: locals.user.plan || 'free',
          tripsThisMonth: locals.user.tripsThisMonth
        }
      : null;

  return {
    user: publicUser,
    path: url.pathname,
    // ✅ CORRECT: Use platform.env (not process.env)
    // PUBLIC_ prefix means this can be exposed to client
    googleMapsApiKey: env.PUBLIC_GOOGLE_MAPS_API_KEY || ''
  };
};
