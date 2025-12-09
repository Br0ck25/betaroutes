// src/lib/server/userService.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import { randomUUID } from 'node:crypto';

// Re-using the structure assumed in previous steps for consistency
export type User = {
    id: string;
    username: string;
    email: string;
    password: string; // Will store the HASHED password (or legacy plaintext during migration)
    plan: string;
    tripsThisMonth: number;
    maxTrips: number;
    resetDate: string;
    name: string;
    createdAt: string;
};

// --- KV Key Utility Functions ---

// Primary Key: Stores the full user record (JSON)
function userKey(userId: string): string {
    return `user:${userId}`;
}

// Index Key: Maps username -> userId (lower-casing for case-insensitive lookup)
function usernameKey(username: string): string {
    return `idx:username:${username.toLowerCase()}`;
}

// Index Key: Maps email -> userId (lower-casing for case-insensitive lookup)
function emailKey(email: string): string {
    return `idx:email:${email.toLowerCase()}`;
}

// --- Lookup Functions ---

/**
 * Retrieves the full user record by their internal UUID.
 */
export async function findUserById(kv: KVNamespace, userId: string): Promise<User | null> {
    const raw = await kv.get(userKey(userId));
    return raw ? JSON.parse(raw) as User : null;
}

/**
 * Finds a user by their email address using a KV index lookup.
 * Returns the full User object or null.
 */
export async function findUserByEmail(kv: KVNamespace, email: string): Promise<User | null> {
    const userId = await kv.get(emailKey(email));
    if (!userId) return null;
    
    // Now look up the primary record using the found userId
    return findUserById(kv, userId);
}

/**
 * Finds a user by their username using a KV index lookup.
 * Returns the full User object or null.
 */
export async function findUserByUsername(kv: KVNamespace, username: string): Promise<User | null> {
    const userId = await kv.get(usernameKey(username));
    if (!userId) return null;

    // Now look up the primary record using the found userId
    return findUserById(kv, userId);
}


// --- Write/Update Functions ---

/**
 * Creates the user record and all necessary KV index entries (email, username).
 */
export async function createUser(kv: KVNamespace, userData: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const userId = randomUUID();
    const now = new Date().toISOString();
    
    const user: User = {
        ...userData,
        id: userId,
        createdAt: now,
    };

    const userJson = JSON.stringify(user);

    // 1. Store the primary user record
    await kv.put(userKey(userId), userJson);

    // 2. Store the secondary index records (for lookups by email/username)
    await kv.put(usernameKey(user.username), userId);
    await kv.put(emailKey(user.email), userId);

    return user;
}


/**
 * CRITICAL FIX: Updates a user's password hash and saves the full user record.
 * This is used for the plaintext password migration strategy.
 */
export async function updatePasswordHash(kv: KVNamespace, user: User, newHash: string) {
    // 1. Update the user object in memory
    user.password = newHash;
    
    // 2. Save the full user record back to the primary key
    const key = userKey(user.id); 
    await kv.put(key, JSON.stringify(user));
    
    // NOTE: Index keys (username/email) do not need updating here.
}