import { redirect } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { log } from '$lib/server/log';

export const load = async ({ locals, platform }) => {
  if (!locals.user) {
    throw redirect(303, '/login');
  }

  let clientApiKey = publicEnv['PUBLIC_GOOGLE_MAPS_API_KEY'];
  if (!clientApiKey) {
    const { getEnv } = await import('$lib/server/env');
    const env = getEnv(platform);
    const envRec = env as Record<string, unknown> | undefined;
    const privateKey =
      (typeof envRec?.['PRIVATE_GOOGLE_MAPS_API_KEY'] === 'string'
        ? String(envRec['PRIVATE_GOOGLE_MAPS_API_KEY'])
        : undefined) ?? privateEnv['PRIVATE_GOOGLE_MAPS_API_KEY'];
    if (privateKey) {
      log.warn('Using PRIVATE key for frontend on tools/assign-stops (fallback)');
      clientApiKey = privateKey;
    }
  }

  return {
    googleMapsApiKey: clientApiKey
  };
};
