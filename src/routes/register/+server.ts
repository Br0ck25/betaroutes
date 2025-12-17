// src/routes/register/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { sendVerificationEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
    console.log('[Register] ===== START REGISTRATION =====');
    console.log('[Register] Hostname:', url.hostname);
    console.log('[Register] Platform available:', !!platform);
    console.log('[Register] Platform.env available:', !!platform?.env);
    
    try {
        // 1. Check Database Binding
        const usersKV = platform?.env?.BETA_USERS_KV;
        if (!usersKV) {
            console.error('[Register] CRITICAL: BETA_USERS_KV binding missing');
            return json({ 
                message: 'Database service unavailable',
                debug: { error: 'BETA_USERS_KV binding not configured' }
            }, { status: 503 });
        }
        console.log('[Register] ✅ KV binding present');

        // 1.5. Check Email Configuration
        const resendKey = platform?.env?.RESEND_API_KEY;
        const isProduction = !url.hostname.includes('localhost') && !url.hostname.includes('127.0.0.1');
        
        if (!resendKey && isProduction) {
            console.error('[Register] CRITICAL: RESEND_API_KEY is missing in production');
            return json({ 
                message: 'Email service not configured. Please contact support.',
                debug: { error: 'RESEND_API_KEY environment variable missing' }
            }, { status: 503 });
        }
        console.log('[Register] ✅ Email key present:', !!resendKey);

        // 2. Rate Limit
        console.log('[Register] Checking rate limit...');
        const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
        let limitResult = { allowed: true };
        try {
             limitResult = await checkRateLimit(usersKV, clientIp, 'register_attempt', 500, 3600);
        } catch (e) {
             console.warn('[Register] Rate limit check failed (ignoring):', e);
        }

        if (!limitResult.allowed) {
            return json({ message: 'Too many registration attempts. Please try again later.' }, { status: 429 });
        }
        console.log('[Register] ✅ Rate limit passed');

        // 3. Parse Body
        const body = await request.json();
        const { username, email, password } = body;
        console.log('[Register] Request body parsed:', { 
            hasUsername: !!username, 
            hasEmail: !!email, 
            hasPassword: !!password 
        });

        // 4. Validation
        if (!username || !email || !password) {
            return json({ 
                message: 'Missing required fields',
                debug: { 
                    hasUsername: !!username, 
                    hasEmail: !!email, 
                    hasPassword: !!password 
                }
            }, { status: 400 });
        }
        
        if (password.length < 8) {
            return json({ message: 'Password must be at least 8 characters' }, { status: 400 });
        }
        
        const normEmail = email.toLowerCase().trim();
        const normUser = username.toLowerCase().trim();
        console.log('[Register] ✅ Validation passed');

        // 5. Check Existing Users
        console.log('[Register] Checking for existing users...');
        const existingEmail = await findUserByEmail(usersKV, normEmail);
        if (existingEmail) {
            return json({ message: 'Email already in use.' }, { status: 409 });
        }

        const existingUser = await findUserByUsername(usersKV, normUser);
        if (existingUser) {
            return json({ message: 'Username taken.' }, { status: 409 });
        }
        console.log('[Register] ✅ User is new');

        // 6. Check Reservations
        console.log('[Register] Checking reservations...');
        const [resUser, resEmail] = await Promise.all([
            usersKV.get(`reservation:username:${normUser}`),
            usersKV.get(`reservation:email:${normEmail}`)
        ]);

        if (resUser || resEmail) {
            return json({ message: 'Username or Email is pending verification.' }, { status: 409 });
        }
        console.log('[Register] ✅ No conflicting reservations');

        // 7. Hash Password
        console.log('[Register] Hashing password...');
        const hashedPassword = await hashPassword(password);
        console.log('[Register] ✅ Password hashed');
        
        // 8. Create Pending Record
        const verificationToken = randomUUID();
        console.log('[Register] Generated token:', verificationToken.substring(0, 8) + '...');
        
        const pendingUser = {
            username: normUser,
            email: normEmail,
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };

        const ttl = 86400; // 24 hours

        // 9. Store in KV
        console.log('[Register] Writing to KV...');
        await Promise.all([
            usersKV.put(`pending_verify:${verificationToken}`, JSON.stringify(pendingUser), { expirationTtl: ttl }),
            usersKV.put(`reservation:username:${normUser}`, verificationToken, { expirationTtl: ttl }),
            usersKV.put(`reservation:email:${normEmail}`, verificationToken, { expirationTtl: ttl }),
            usersKV.put(`lookup:pending:${normEmail}`, verificationToken, { expirationTtl: ttl })
        ]);
        console.log('[Register] ✅ KV writes complete');

        // 10. Send Email
        console.log('[Register] Sending verification email...');
        let emailSent = false;
        try {
            // Import check
            if (typeof sendVerificationEmail !== 'function') {
                throw new Error('sendVerificationEmail is not a function - import failed');
            }
            
            emailSent = await sendVerificationEmail(normEmail, verificationToken, url.origin, resendKey);
            console.log('[Register] ✅ Email sent successfully');
        } catch (emailErr: any) {
            console.error('[Register] Email send failed:', emailErr);
            console.error('[Register] Email error stack:', emailErr.stack);
            
            // Rollback pending registration
            await Promise.all([
                usersKV.delete(`pending_verify:${verificationToken}`),
                usersKV.delete(`reservation:username:${normUser}`),
                usersKV.delete(`reservation:email:${normEmail}`),
                usersKV.delete(`lookup:pending:${normEmail}`)
            ]);
            
            return json({ 
                message: 'Failed to send verification email. Please try again.',
                debug: { 
                    error: emailErr.message,
                    name: emailErr.name
                }
            }, { status: 500 });
        }

        if (!emailSent) {
            console.error('[Register] Email service returned false');
            
            // Rollback
            await Promise.all([
                usersKV.delete(`pending_verify:${verificationToken}`),
                usersKV.delete(`reservation:username:${normUser}`),
                usersKV.delete(`reservation:email:${normEmail}`),
                usersKV.delete(`lookup:pending:${normEmail}`)
            ]);
            
            return json({ 
                message: 'Failed to send verification email.',
                debug: { error: 'Email service returned false' }
            }, { status: 500 });
        }

        console.log('[Register] ===== SUCCESS =====');
        return json({ 
            success: true, 
            message: 'Verification email sent. Please check your inbox.' 
        });

    } catch (e: any) {
        console.error('[Register] ===== CRITICAL ERROR =====');
        console.error('[Register] Error type:', typeof e);
        console.error('[Register] Error name:', e?.name);
        console.error('[Register] Error message:', e?.message);
        console.error('[Register] Error stack:', e?.stack);
        
        // Always return detailed error for debugging
        return json({ 
            message: 'Registration failed. Please try again.',
            debug: {
                error: e?.message || 'Unknown error',
                name: e?.name || 'Unknown',
                type: typeof e,
                stack: e?.stack?.split('\n').slice(0, 5).join('\n')
            }
        }, { status: 500 });
    }
};