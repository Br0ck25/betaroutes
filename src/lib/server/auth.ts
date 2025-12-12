// src/lib/server/auth.ts
import bcrypt from 'bcryptjs'; // [!code note] Kept for legacy verification
import type { KVNamespace } from '@cloudflare/workers-types';
import { findUserByEmail, findUserByUsername, updatePasswordHash, type User } from './userService';

// --- PBKDF2 CONFIGURATION (Web Crypto) ---
const PBKDF2_ITERATIONS = 100000;
const SALT_SIZE = 16;
const HASH_ALGO = 'SHA-256';

/**
 * Helper: Convert Buffer to Hex
 */
function bufferToHex(buffer: ArrayBuffer): string {
    return [...new Uint8Array(buffer)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Helper: Convert Hex to Buffer
 */
function hexToBuffer(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

/**
 * Generates a secure PBKDF2 hash using Native Web Crypto.
 * This is CPU-efficient on Cloudflare Workers.
 */
export async function hashPassword(password: string): Promise<string> {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
    
    const keyMaterial = await crypto.subtle.importKey(
        "raw", 
        enc.encode(password), 
        "PBKDF2", 
        false, 
        ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: HASH_ALGO
        },
        keyMaterial,
        256
    );

    const saltHex = bufferToHex(salt.buffer);
    const hashHex = bufferToHex(derivedBits);

    return `v1:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verifies a password against a stored PBKDF2 hash.
 */
async function verifyPBKDF2(password: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') return false;

    const iterations = parseInt(parts[1], 10);
    const salt = hexToBuffer(parts[2]);
    const originalHash = parts[3];

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", 
        enc.encode(password), 
        "PBKDF2", 
        false, 
        ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: iterations,
            hash: HASH_ALGO
        },
        keyMaterial,
        256
    );

    return bufferToHex(derivedBits) === originalHash;
}

/**
 * Authenticates a user using Hybrid Strategy:
 * 1. PBKDF2 (Preferred)
 * 2. Bcrypt (Legacy - Auto Migrates)
 * 3. Plaintext (Legacy - Auto Migrates)
 */
export async function authenticateUser(kv: KVNamespace, identifier: string, password: string) {
	const isEmail = identifier.includes('@');

	let user = isEmail
		? await findUserByEmail(kv, identifier)
		: await findUserByUsername(kv, identifier);

	if (!user) return null;
    
    let passwordMatches = false;
    let needsMigration = false;

    // --- Path A: PBKDF2 (New Standard) ---
    if (user.password && user.password.startsWith('v1:')) {
        passwordMatches = await verifyPBKDF2(password, user.password);
    }
    // --- Path B: Bcrypt (Legacy) ---
    else if (user.password && user.password.startsWith('$2')) {
        // Warning: This is CPU heavy, but necessary for migration
        passwordMatches = await bcrypt.compare(password, user.password);
        if (passwordMatches) needsMigration = true;
    } 
    // --- Path C: Plaintext (Legacy) ---
    else {
        if (user.password === password) {
            passwordMatches = true;
            needsMigration = true;
        }
    }

	if (!passwordMatches) return null;

    // --- Auto-Migration ---
    if (needsMigration) {
        console.log(`[AUTH] Migrating user "${user.username}" to optimized PBKDF2 hash.`);
        // Run in background (don't await) or await if you want strict consistency
        const newHash = await hashPassword(password);
        await updatePasswordHash(kv, user as User, newHash);
    }

	return { id: user.id, username: user.username, email: user.email };
}