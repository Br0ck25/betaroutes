import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  try {
    const session = locals.session;
    if (!session?.id) return json({ error: 'Unauthorized' }, { status: 401 });

    return json({ success: true, lastUsedCredentialID: session.lastUsedCredentialID || null });
  } catch (err) {
    console.error('[Session Info] Error:', err);
    return json({ error: 'Failed to retrieve session info' }, { status: 500 });
  }
};