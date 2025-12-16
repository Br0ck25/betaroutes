// src/routes/api/settings/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';

const settingsSchema = z.object({
  defaultStartAddress: z.string().max(500).optional(),
  defaultEndAddress: z.string().max(500).optional(), // [!code ++] Ensure this is included
  defaultMPG: z.number().positive().nullish(),
  defaultGasPrice: z.number().nonnegative().nullish(),
  vehicleName: z.string().max(100).optional(),
  distanceUnit: z.enum(['mi', 'km']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional()
});

export const GET: RequestHandler = async ({ locals, platform }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const kv = platform?.env?.BETA_USER_SETTINGS_KV;
  if (!kv) return json({}); 

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
      
      // [!code fix] Unwrap the 'settings' object if sent by the frontend helper
      const payload = body.settings || body;

      const result = settingsSchema.safeParse(payload);
      
      if (!result.success) {
          return json({ 
              error: 'Invalid settings', 
              details: result.error.flatten() 
          }, { status: 400 });
      }

      const key = `settings:${user.id}`;
      const existingRaw = await kv.get(key);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};

      // Merge and save
      const updated = { ...existing, ...result.data };
      await kv.put(key, JSON.stringify(updated));

      return json(updated);

  } catch (e) {
      console.error('Settings update failed', e);
      return json({ error: 'Internal Error' }, { status: 500 });
  }
};