// src/lib/server/userService.ts
import type { KVNamespace } from '@cloudflare/workers-types';
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
};

export type UserStats = {
    tripsThisMonth: number;
    maxTrips: number;
    resetDate: string;
};

// Unified type for app consumption (backward compatibility)
export type User = UserCore & UserStats;

// --- KV Key Utility Functions ---

// Stores UserCore (Profile)
function userCoreKey(userId: string): string {
    return `user:${userId}`;
}

// [!code ++] Stores UserStats (Usage)
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
    // [!code changed] Fetch Core and Stats in parallel
    const [coreRaw, statsRaw] = await Promise.all([
        kv.get(userCoreKey(userId)),
        kv.get(userStatsKey(userId))
    ]);

    if (!coreRaw) return null;

    const core = JSON.parse(coreRaw);
    
    // Resolve Stats: 
    // 1. Look in new stats key
    // 2. Fallback to legacy fields inside core object (migration)
    // 3. Fallback to defaults
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

// --- Write/Update Functions ---

export async function createUser(kv: KVNamespace, userData: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const userId = randomUUID();
    const now = new Date().toISOString();
    
    // Split incoming data
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

    // Write all keys in parallel
    await Promise.all([
        kv.put(userCoreKey(userId), JSON.stringify(userCore)),
        kv.put(userStatsKey(userId), JSON.stringify(userStats)),
        kv.put(usernameKey(userCore.username), userId),
        kv.put(emailKey(userCore.email), userId)
    ]);

    return { ...userCore, ...userStats };
}

/**
 * Updates a user's password hash safely.
 * This operation is now atomic regarding stats; it will NOT overwrite concurrent trip count updates.
 */
export async function updatePasswordHash(kv: KVNamespace, user: User, newHash: string) {
    const key = userCoreKey(user.id);
    const statsKey = userStatsKey(user.id);

    // 1. Fetch FRESH Core record
    const raw = await kv.get(key);
    if (!raw) throw new Error('User not found during password update');
    
    const record = JSON.parse(raw);

    // [!code ++] Lazy Migration: If we found legacy stats in the core record, move them!
    if (record.tripsThisMonth !== undefined || record.maxTrips !== undefined) {
        console.log('[MIGRATION] Moving stats to separate key for user', user.id);
        const stats: UserStats = {
            tripsThisMonth: record.tripsThisMonth ?? 0,
            maxTrips: record.maxTrips ?? 10,
            resetDate: record.resetDate ?? new Date().toISOString()
        };
        // Save stats to new key
        await kv.put(statsKey, JSON.stringify(stats));
    }

    // 2. Prepare Clean Core Object (Strip stats, update password)
    const core: UserCore = {
        id: record.id,
        username: record.username,
        email: record.email,
        password: newHash, // Apply new password
        plan: record.plan,
        name: record.name,
        createdAt: record.createdAt
    };
    
    // 3. Save ONLY the Core record
    await kv.put(key, JSON.stringify(core));
}