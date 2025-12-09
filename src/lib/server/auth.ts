// src/lib/server/auth.ts
import bcrypt from 'bcryptjs';
import type { KVNamespace } from '@cloudflare/workers-types';
import { findUserByEmail, findUserByUsername, updatePasswordHash, type User } from './userService';

const SALT_ROUNDS = 10;

/**
 * Utility function to securely hash a plaintext password.
 */
export async function hashPassword(password: string): Promise<string> {
	return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Authenticates a user, handling legacy plaintext passwords by migrating them to hashes.
 */
export async function authenticateUser(kv: KVNamespace, identifier: string, password: string) {
	const isEmail = identifier.includes('@');

	let user = isEmail
		? await findUserByEmail(kv, identifier)
		: await findUserByUsername(kv, identifier);

	if (!user) return null;
    
    let passwordMatches = false;

    // --- Password Verification & Migration ---
    
    // Path A: Check if stored password is a hash (starts with $2)
    if (user.password && user.password.startsWith('$2')) {
        passwordMatches = await bcrypt.compare(password, user.password);
    } 
    // Path B: LEGACY PLAINTEXT CHECK
    else {
        if (user.password === password) {
            passwordMatches = true;
            
            // MIGRATION: Hash the plaintext password and save it
            console.log(`[AUTH] Migrating user "${user.username}" to secure password hash.`);
            const newHash = await hashPassword(password);
            await updatePasswordHash(kv, user as User, newHash);
        }
    }

	if (!passwordMatches) return null;

	return { id: user.id, username: user.username, email: user.email };
}