import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  try {
    const user = locals.user;
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
    return json({ success: true, user });
  } catch (e) {
    console.error('[Auth Session] Error:', e);
    return json({ error: 'Failed to check session' }, { status: 500 });
  }
};
