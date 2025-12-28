// src/routes/api/debug/fix-user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import type { User } from '$lib/server/userService';
import bcrypt from 'bcryptjs';

export const POST: RequestHandler = async ({ request, platform }) => {
    const body: any = await request.json();
    const { username, password } = body;
    const kv = platform?.env?.BETA_USERS_KV;

    if (!kv) return json({ error: 'KV not found' }, { status: 500 });

    const report: any[] = [];
    report.push(`🔍 Analyzing user: ${username}`);

    // 1. Try to find user via the standard Index
    const indexKey = `idx:username:${username.toLowerCase()}`;
    const userIdFromIndex = await kv.get(indexKey);

    if (userIdFromIndex) {
        report.push(`✅ Index found. Points to ID: ${userIdFromIndex}`);
    } else {
        report.push(`❌ Index MISSING for ${username}. Will attempt to find by scanning...`);
    }

    // 2. Scan ALL users to find the record (Fallback/Repair method)
    let foundUser: User | null = null;
    
    if (!userIdFromIndex) {
        const list = await kv.list({ prefix: 'user:' });
        for (const key of list.keys) {
            const raw = await kv.get(key.name);
            if (raw) {
                const u = JSON.parse(raw);
                if (u.username.toLowerCase() === username.toLowerCase()) {
                    foundUser = u;
                    report.push(`✅ Found user record via SCAN at key: ${key.name}`);
                    
                    // REPAIR: Create the missing index
                    await kv.put(indexKey, u.id);
                    report.push(`🛠️ REPAIRED: Created missing index key ${indexKey}`);
                    
                    // Also repair email index if needed
                    if (u.email) {
                        const emailKey = `idx:email:${u.email.toLowerCase()}`;
                        await kv.put(emailKey, u.id);
                        report.push(`🛠️ REPAIRED: Created missing email key ${emailKey}`);
                    }
                    break;
                }
            }
        }
    } else {
        // Retrieve directly
        const raw = await kv.get(`user:${userIdFromIndex}`);
        if (raw) foundUser = JSON.parse(raw);
    }

    if (!foundUser) {
        return json({ 
            success: false, 
            message: 'User does not exist in this database.',
            logs: report 
        });
    }

    // 3. Password Check
    const isHashed = foundUser.password.startsWith('$2');
    report.push(`🔐 Stored Password Format: ${isHashed ? 'Bcrypt Hash' : 'Plaintext'}`);

    let match = false;
    if (isHashed) {
        match = await bcrypt.compare(password, foundUser.password);
        report.push(`Testing provided password against hash: ${match ? 'MATCH ✅' : 'FAIL ❌'}`);
    } else {
        match = (foundUser.password === password);
        report.push(`Testing provided password against plaintext: ${match ? 'MATCH ✅' : 'FAIL ❌'}`);
        
        if (match) {
            // Auto-migrate to hash if we match plaintext here
            const newHash = await hashPassword(password);
            foundUser.password = newHash;
            await kv.put(`user:${foundUser.id}`, JSON.stringify(foundUser));
            report.push(`✨ MIGRATED: Converted plaintext password to hash.`);
        }
    }

    return json({ 
        success: match, 
        message: match ? 'User is healthy and password is correct.' : 'User exists but password incorrect.',
        logs: report
    });
};