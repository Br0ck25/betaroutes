// src/routes/api/debug/reset-counter/+server.ts
import { json } from '@sveltejs/kit';
import { makeTripService } from '$lib/server/tripService';

// Helper to safely get KV namespace
function safeKV(env: any, name: string) {
	return env?.[name] || null;
}

export const GET = async ({ locals, platform }) => {
    if (!locals.user) return json({ error: 'Login first' });

    const kv = safeKV(platform?.env, 'BETA_LOGS_KV');
    const trashKV = safeKV(platform?.env, 'BETA_LOGS_TRASH_KV');
    const placesKV = safeKV(platform?.env, 'BETA_PLACES_KV');

    if (!kv) return json({ error: 'KV not found' });

    const tripIndexDO = (platform?.env as any)?.TRIP_INDEX_DO ?? ({} as any);
    const placesIndexDO = (platform?.env as any)?.PLACES_INDEX_DO ?? tripIndexDO;
    const svc = makeTripService(kv, trashKV, placesKV, tripIndexDO as any, placesIndexDO as any);
    
    // Use the same ID logic as your main app (guard index signature)
    const userId = (locals.user as any).name || (locals.user as any).token;

    // 1. Calculate correct count from DB
    // We list ALL trips and filter for the current month in memory
    const allTrips = await svc.list(userId);
    const now = new Date();
    
    const realCount = allTrips.filter(t => {
        const d = new Date((t as any)['date'] || (t as any)['createdAt']);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

    // 2. Force update the counter key
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const counterKey = `meta:user:${userId}:monthly_count:${monthKey}`;
    
    await kv.put(counterKey, realCount.toString());

    // 3. Also update the cached stats key (for the dashboard)
    const statsKey = `user:stats:${(locals.user as any).id}`;
    const statsRaw = await platform?.env?.BETA_USERS_KV?.get(statsKey);
    if (statsRaw) {
        const stats = JSON.parse(statsRaw);
        stats.tripsThisMonth = realCount;
        await platform?.env?.BETA_USERS_KV?.put(statsKey, JSON.stringify(stats));
    }

    return json({ 
        success: true, 
        message: `Counter corrected to: ${realCount}`,
        key: counterKey
    });
};