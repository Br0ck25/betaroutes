// src/lib/server/userSettings.ts
import { kv } from '@vercel/kv'; // OR your specific KV adapter import

// The ID you provided looks like a User UUID. 
// We use this to construct a unique key for storage.
export const updateUserSettings = async (userId: string, settings: any) => {
    try {
        const key = `BETA_USER_SETTINGS_KV:${userId}`;
        
        // We get the existing settings first to merge, so we don't overwrite unrelated fields
        const existing = await kv.get(key) || {};
        
        const updated = {
            ...existing,
            ...settings,
            updatedAt: new Date().toISOString()
        };

        await kv.set(key, updated);
        console.log(`✅ Settings synced to KV for user ${userId}`);
        return updated;
    } catch (error) {
        console.error('❌ Failed to sync settings to KV:', error);
        throw error;
    }
};

export const getUserSettings = async (userId: string) => {
    try {
        const key = `BETA_USER_SETTINGS_KV:${userId}`;
        return await kv.get(key);
    } catch (error) {
        return null; // Fallback to DB or defaults if KV fails
    }
};