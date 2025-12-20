// src/lib/server/userService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { randomUUID } from 'node:crypto';

// 1. Define Split Types
export type UserCore = {
    id: string;
    username: string;
    email: string;
    password: string;
    plan: string;
    name: string;
    createdAt: string;
    stripeCustomerId?: string; // [!code ++] Added this field
};

export type UserStats = {
    tripsThisMonth: number;
    maxTrips: number;
    resetDate: string;
};

export type User = UserCore & UserStats;

// --- KV Key Utility Functions ---

function userCoreKey(userId: string): string {
    return `user:${userId}`;
}

function userStatsKey(userId: string): string {
    return `user:stats:${userId}`;
}

function usernameKey(username: string): string {
    return `idx:username:${username.toLowerCase()}`;
}

function emailKey(email: string): string {
    return `idx:email:${email.toLowerCase()}`;
}

// --- Lookup Functions ---

export async function findUserById(kv: KVNamespace, userId: string): Promise<User | null> {
    const [coreRaw, statsRaw] = await Promise.all([
        kv.get(userCoreKey(userId)),
        kv.get(userStatsKey(userId))
    ]);

    if (!coreRaw) return null;

    const core = JSON.parse(coreRaw);
    
    const stats: UserStats = statsRaw ? JSON.parse(statsRaw) : {
        tripsThisMonth: core.tripsThisMonth ?? 0,
        maxTrips: core.maxTrips ?? 10,
        resetDate: core.resetDate ?? new Date().toISOString()
    };

    return {
        id: core.id,
        username: core.username,
        email: core.email,
        password: core.password,
        plan: core.plan,
        name: core.name,
        createdAt: core.createdAt,
        stripeCustomerId: core.stripeCustomerId, // [!code ++] Return it
        ...stats
    };
}

export async function findUserByEmail(kv: KVNamespace, email: string): Promise<User | null> {
    const userId = await kv.get(emailKey(email));
    if (!userId) return null;
    return findUserById(kv, userId);
}

export async function findUserByUsername(kv: KVNamespace, username: string): Promise<User | null> {
    const userId = await kv.get(usernameKey(username));
    if (!userId) return null;
    return findUserById(kv, userId);
}

// --- Write/Update/Delete Functions ---

export async function createUser(kv: KVNamespace, userData: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const userId = randomUUID();
    const now = new Date().toISOString();
    
    const { tripsThisMonth, maxTrips, resetDate, ...coreData } = userData;

    const userCore: UserCore = {
        ...coreData,
        id: userId,
        createdAt: now,
    };

    const userStats: UserStats = {
        tripsThisMonth: tripsThisMonth || 0,
        maxTrips: maxTrips || 10,
        resetDate: resetDate || now
    };

    await Promise.all([
        kv.put(userCoreKey(userId), JSON.stringify(userCore)),
        kv.put(userStatsKey(userId), JSON.stringify(userStats)),
        kv.put(usernameKey(userCore.username), userId),
        kv.put(emailKey(userCore.email), userId)
    ]);

    return { ...userCore, ...userStats };
}

// FIXED: Handle index updates when email changes
export async function updateUser(
    kv: KVNamespace, 
    userId: string, 
    updates: Partial<Pick<UserCore, 'name' | 'email'>>
): Promise<void> {
    const key = userCoreKey(userId);
    const raw = await kv.get(key);
    if (!raw) throw new Error('User not found');

    const record = JSON.parse(raw) as UserCore;
    
    // Handle Email Change: Update Indexes
    if (updates.email && updates.email.toLowerCase() !== record.email.toLowerCase()) {
        const newEmail = updates.email.toLowerCase();
        const oldEmail = record.email.toLowerCase();

        // 1. Check if new email is taken
        const existingId = await kv.get(emailKey(newEmail));
        if (existingId) {
            throw new Error('Email already in use');
        }

        // 2. Create new index BEFORE deleting old one (safety)
        await kv.put(emailKey(newEmail), userId);
        
        // 3. Delete old index
        await kv.delete(emailKey(oldEmail));
    }

    // Merge updates into the core record
    const updatedCore = {
        ...record,
        ...updates
    };

    await kv.put(key, JSON.stringify(updatedCore));
}

// [!code ++] NEW: Upgrade User Plan (For Stripe Webhooks)
export async function updateUserPlan(
    kv: KVNamespace, 
    userId: string, 
    plan: string,
    stripeCustomerId?: string // [!code ++] Optional customer ID
): Promise<void> {
    const coreKey = userCoreKey(userId);
    const statsKey = userStatsKey(userId);

    const [coreRaw, statsRaw] = await Promise.all([
        kv.get(coreKey),
        kv.get(statsKey)
    ]);

    if (!coreRaw) throw new Error('User not found');

    // 1. Update Plan in Core
    const core = JSON.parse(coreRaw) as UserCore;
    core.plan = plan;
    // [!code ++] Save Stripe Customer ID if provided
    if (stripeCustomerId) {
        core.stripeCustomerId = stripeCustomerId;
    }
    await kv.put(coreKey, JSON.stringify(core));

    // 2. Update Limits in Stats (Unlimited for Pro)
    if (statsRaw) {
        const stats = JSON.parse(statsRaw) as UserStats;
        if (plan === 'pro' || plan === 'business') {
            stats.maxTrips = 999999; // Effectively unlimited
        }
        await kv.put(statsKey, JSON.stringify(stats));
    }
}

export async function updatePasswordHash(kv: KVNamespace, user: User, newHash: string) {
    const key = userCoreKey(user.id);
    const statsKey = userStatsKey(user.id);

    const raw = await kv.get(key);
    if (!raw) throw new Error('User not found during password update');
    
    const record = JSON.parse(raw);

    // Migration Check
    if (record.tripsThisMonth !== undefined || record.maxTrips !== undefined) {
        console.log('[MIGRATION] Moving stats to separate key for user', user.id);
        const stats: UserStats = {
            tripsThisMonth: record.tripsThisMonth ?? 0,
            maxTrips: record.maxTrips ?? 10,
            resetDate: record.resetDate ?? new Date().toISOString()
        };
        await kv.put(statsKey, JSON.stringify(stats));
    }

    const core: UserCore = {
        id: record.id,
        username: record.username,
        email: record.email,
        password: newHash,
        plan: record.plan,
        name: record.name,
        createdAt: record.createdAt,
        stripeCustomerId: record.stripeCustomerId // Preserve existing ID
    };
    
    await kv.put(key, JSON.stringify(core));
}

/**
 * Completely delete a user and ALL associated data (Trips, Settings, Indexes)
 */
export async function deleteUser(
    kv: KVNamespace, 
    userId: string,
    resources?: {
        tripsKV?: KVNamespace;
        trashKV?: KVNamespace;
        settingsKV?: KVNamespace;
        tripIndexDO?: DurableObjectNamespace;
    }
): Promise<void> {
    const user = await findUserById(kv, userId);
    if (!user) return;

    console.log(`[UserService] 🗑️ START Account Wipe: ${userId} (${user.email})`);

    // 1. Delete Core User Data (Auth)
    const authPromises = [
        kv.delete(`user:${userId}`),
        kv.delete(`user:stats:${userId}`),
        kv.delete(`idx:username:${user.username.toLowerCase()}`),
        kv.delete(`idx:email:${user.email.toLowerCase()}`)
    ];

    // 2. Delete Settings
    if (resources?.settingsKV) {
        authPromises.push(resources.settingsKV.delete(`settings:${userId}`));
    }

    // 3. WIPE SQLITE DATA in Durable Object
    if (resources?.tripIndexDO) {
        try {
            // Identify the specific DO instance for this user
            const id = resources.tripIndexDO.idFromName(user.username);
            const stub = resources.tripIndexDO.get(id);
            
            // Call the new WIPE endpoint
            await stub.fetch('http://internal/admin/wipe-user', {
                method: 'POST'
            });
            console.log(`[UserService] Sent WIPE command to DO for ${user.username}`);
        } catch (e) {
            console.error('[UserService] Failed to wipe DO data:', e);
        }
    }

    // 4. Delete Trips (Iterate and Destroy)
    const wipeNamespace = async (ns: KVNamespace, prefix: string) => {
        let cursor: string | undefined = undefined;
        do {
            const list = await ns.list({ prefix, cursor, limit: 1000 });
            if (list.keys.length > 0) {
                await Promise.all(list.keys.map(k => ns.delete(k.name)));
            }
            cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
    };

    const cleanupTasks: Promise<void>[] = [];

    if (resources?.tripsKV) {
        cleanupTasks.push(wipeNamespace(resources.tripsKV, `trip:${user.username}:`)); 
        cleanupTasks.push(wipeNamespace(resources.tripsKV, `trip:${userId}:`));
    }

    if (resources?.trashKV) {
        cleanupTasks.push(wipeNamespace(resources.trashKV, `trash:${user.username}:`));
        cleanupTasks.push(wipeNamespace(resources.trashKV, `trash:${userId}:`));
    }

    await Promise.all(authPromises);
    await Promise.all(cleanupTasks);

    console.log(`[UserService] ✅ FINISHED Account Wipe for ${userId}`);
}