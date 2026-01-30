import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // [SECURITY] Debug endpoints must not be accessible in production
  if (!dev) {
    throw error(403, 'Not available in production');
  }

  return {};
};
