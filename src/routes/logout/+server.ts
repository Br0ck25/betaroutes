// src/routes/logout/+server.ts

import { json } from '@sveltejs/kit';

export async function POST({ cookies }) {
  // Clear the token cookie
  cookies.delete('token', { path: '/' });
  
  // Return success
  return json({ success: true });
}
