// src/routes/dashboard/settings/+page.server.ts
import type { PageServerLoad } from './$types';
import { log } from '$lib/server/log';

export const load: PageServerLoad = async ({ locals, platform, parent }) => {
  const parentData = await parent();

  let settingsData = {};

  if (locals.user) {
    try {
      const { getEnv, safeKV } = await import('$lib/server/env');
      const env = getEnv(platform);
      const kv = safeKV(env, 'BETA_USER_SETTINGS_KV');
      if (!kv) throw new Error('settings KV missing');
      // [!code fix] Use 'settings:' prefix to match the API write path
      const raw = await kv.get(`settings:${locals.user.id}`);
      if (raw) {
        settingsData = JSON.parse(raw);
      }
    } catch (e) {
      log.error('Failed to load remote settings:', e);
    }
  }

  return {
    ...parentData,
    // [!code fix] Wrap in 'settings' property to match frontend expectation (data.remoteSettings.settings)
    remoteSettings: {
      settings: settingsData
    }
  };
};
