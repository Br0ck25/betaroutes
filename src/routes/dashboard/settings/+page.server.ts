// src/routes/dashboard/settings/+page.server.ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, parent }) => {
    const parentData = await parent();
    
    // Default structure
    let remoteSettings = {};

    if (locals.user && platform?.env?.BETA_USER_SETTINGS_KV) {
        try {
            const raw = await platform.env.BETA_USER_SETTINGS_KV.get(locals.user.id);
            if (raw) {
                remoteSettings = JSON.parse(raw);
            }
        } catch (e) {
            console.error('Failed to load remote settings:', e);
        }
    }

    return {
        ...parentData,
        remoteSettings
    };
};