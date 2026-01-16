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
			// Read primary key by user id
			const key = `settings:${(locals.user as any).id}`;
			let raw = await kv.get(key);

			// Fallback: older saves may have used username or email as the key. Try those and migrate.
			if (!raw) {
				const fallbacks = [
					`settings:${(locals.user as any).username}`,
					`settings:${(locals.user as any).email}`
				].filter(Boolean) as string[];

				for (const fk of fallbacks) {
					const fRaw = await kv.get(fk);
					if (fRaw) {
						raw = fRaw;
						// migrate to new key
						await kv.put(key, raw);
						try {
							await kv.delete(fk);
						} catch {}
						break;
					}
				}
			}

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
