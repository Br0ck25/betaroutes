// src/routes/dashboard/settings/+page.server.ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, parent }) => {
    const parentData = await parent();
    
    let settingsData = {};

    if (locals.user && platform?.env?.BETA_USER_SETTINGS_KV) {
        try {
            // [!code fix] Use 'settings:' prefix to match the API write path
            const raw = await platform.env.BETA_USER_SETTINGS_KV.get(`settings:${locals.user.id}`);
            if (raw) {
                settingsData = JSON.parse(raw);
            }
        } catch (e) {
            console.error('Failed to load remote settings:', e);
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