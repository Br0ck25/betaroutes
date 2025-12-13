import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';

// [!code ++] Security Schema: Whitelist allowed settings only
const settingsSchema = z.object({
  defaultStartAddress: z.string().max(500).optional(),
  defaultMPG: z.number().positive().nullish(), // Nullish allows resetting to default
  defaultGasPrice: z.number().nonnegative().nullish(),
  vehicleName: z.string().max(100).optional(),
  distanceUnit: z.enum(['mi', 'km']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional()
});

export const GET: RequestHandler = async ({ locals, platform }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  // [!code fix] Use Cloudflare Platform Env, not Vercel SDK
  const kv = platform?.env?.BETA_USER_SETTINGS_KV;
  
  // Fallback for dev mode if bindings are missing
  if (!kv) {
      return json({}); 
  }

  try {
      const raw = await kv.get(`settings:${user.id}`);
      const settings = raw ? JSON.parse(raw) : {};
      return json(settings);
  } catch (err) {
      console.error('Failed to load settings:', err);
      return json({});
  }
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const kv = platform?.env?.BETA_USER_SETTINGS_KV;
  if (!kv) return json({ error: 'Service Unavailable' }, { status: 503 });

  try {
      const body = await request.json();
      
      // 1. Security: Validate input against schema
      // This prevents "Arbitrary Injection" of unapproved keys
      const result = settingsSchema.safeParse(body);
      
      if (!result.success) {
          return json({ 
              error: 'Invalid settings', 
              details: result.error.flatten() 
          }, { status: 400 });
      }

      // 2. Fetch existing settings to merge correctly
      const key = `settings:${user.id}`;
      const existingRaw = await kv.get(key);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};

      // 3. Merge: Only apply the valid data from Zod
      const updated = { ...existing, ...result.data };
      
      await kv.put(key, JSON.stringify(updated));

      return json(updated);

  } catch (e) {
      console.error('Settings update failed', e);
      return json({ error: 'Internal Error' }, { status: 500 });
  }
};