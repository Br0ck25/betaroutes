// src/routes/dashboard/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { log } from '$lib/server/log';

export const load = async ({ locals }) => {
  log.info('[DASHBOARD LAYOUT] Checking auth');

  if (!locals.user) {
    log.info('[DASHBOARD LAYOUT] No user found, redirecting to login');
    throw redirect(303, '/login');
  }

  // SECURITY: Only expose PUBLIC keys to the browser
  // NEVER send private/server-side keys to the client
  const clientApiKey = publicEnv['PUBLIC_GOOGLE_MAPS_API_KEY'];

  if (!clientApiKey) {
    log.error('[DASHBOARD LAYOUT] PUBLIC_GOOGLE_MAPS_API_KEY not configured');
    // Do not fallback to private key - it creates a security risk
  }

  log.info('[DASHBOARD LAYOUT] Frontend Key status', {
    status: clientApiKey ? 'Loaded' : 'MISSING'
  });

  return {
    user: locals.user,
    googleMapsApiKey: clientApiKey
  };
};
