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
 * Get user display name
 * Fallback helper if $lib/utils/user-display doesn't exist
 */
function getUserDisplayName(user: { name?: string; username?: string; email?: string }): string {
  return user.name || user.username || user.email || 'User';
}

/**
 * Root layout loader
 * Provides user data and environment to all pages
 */
export const load: LayoutServerLoad = async ({ locals, url, platform }) => {
  // Get environment bindings safely
  const env = getEnv(platform);

  // Create public user object (strips sensitive data)
  const publicUser: PublicUser | null =
    locals.user && typeof locals.user.id === 'string'
      ? {
          id: locals.user.id,
          name: getUserDisplayName(locals.user),
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
