// src/lib/server/auth.ts
import bcrypt from 'bcryptjs'; // [!code note] Kept for legacy verification
import type { KVNamespace, ExecutionContext } from '@cloudflare/workers-types';
import { findUserByEmail, findUserByUsername, updatePasswordHash, type User } from './userService';

// --- PBKDF2 CONFIGURATION (Web Crypto) ---
// [!code fix] Increased to 600,000 (OWASP 2025 Recommendation)
const PBKDF2_ITERATIONS = 600000;
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
 * Helper: Constant-time comparison to prevent timing attacks.
 * Returns true if the two arrays are equal, false otherwise.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let c = 0;
    for (let i = 0; i < a.length; i++) {
        c |= a[i] ^ b[i];
    }
    return c === 0;
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
    const originalHashBuffer = hexToBuffer(parts[3]);

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

    // [!code fix] Use constant-time comparison
    return constantTimeEqual(new Uint8Array(derivedBits), originalHashBuffer);
}

/**
 * Authenticates a user using Hybrid Strategy:
 * 1. PBKDF2 (Preferred)
 * 2. Bcrypt (Legacy - Auto Migrates)
 * * Note: context is optional but recommended to offload migration logic.
 */
export async function authenticateUser(
    kv: KVNamespace, 
    identifier: string, 
    password: string,
    context?: ExecutionContext
) {
	const isEmail = identifier.includes('@');

	let user = isEmail
		? await findUserByEmail(kv, identifier)
		: await findUserByUsername(kv, identifier);

    // [!code fix] PREVENT TIMING ATTACK
    // If user is not found, verify against a dummy hash to consume the same CPU time.
	if (!user) {
        // Use a pre-generated valid hash (PBKDF2 v1 with same iteration count and zeroed salt/hash)
        const dummyHash = 'v1:600000:00000000000000000000000000000000:00000000000000000000000000000000';
        await verifyPBKDF2(password, dummyHash);
        return null;
    }
    
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
    // [!code fix] REMOVED Path C: Plaintext (Vulnerability)
    // Plaintext passwords are no longer supported. 

	if (!passwordMatches) return null;

    // --- Auto-Migration ---
    if (needsMigration) {
        console.log(`[AUTH] Migrating user "${user.username}" to optimized PBKDF2 hash.`);
        
        const migrationTask = async () => {
             const newHash = await hashPassword(password);
             await updatePasswordHash(kv, user as User, newHash);
        };

        // [!code fix] Use waitUntil if available to prevent blocking the login response
        if (context) {
            context.waitUntil(migrationTask());
        } else {
            // Fallback: Await if no context is provided (preserves consistency at cost of latency)
            await migrationTask();
        }
    }

	return { id: user.id, username: user.username, email: user.email };
}