// src/routes/dashboard/settings/+page.server.ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, parent }) => {
    const parentData = await parent();
    
    let remoteSettings = {};

    if (locals.user && platform?.env?.BETA_USER_SETTINGS_KV) {
        try {
            const raw = await platform.env.BETA_USER_SETTINGS_KV.get(`settings:${locals.user.token}`);
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