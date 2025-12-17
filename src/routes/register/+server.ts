// src/routes/register/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { sendVerificationEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
    try {
        // 1. Debug Database Binding
        const usersKV = platform?.env?.BETA_USERS_KV;
        if (!usersKV) {
            console.error('[Register] CRITICAL: BETA_USERS_KV binding missing');
            return json({ 
                message: 'Database service unavailable',
                technical: 'BETA_USERS_KV binding not configured'
            }, { status: 503 });
        }

        // 1.5. Check Email Configuration (Critical for Production)
        const resendKey = platform?.env?.RESEND_API_KEY;
        const isProduction = !url.hostname.includes('localhost') && !url.hostname.includes('127.0.0.1');
        
        if (!resendKey && isProduction) {
            console.error('[Register] CRITICAL: RESEND_API_KEY is missing in production');
            return json({ 
                message: 'Email service not configured. Please contact support.',
                technical: 'RESEND_API_KEY environment variable missing'
            }, { status: 503 });
        }

        // 2. Rate Limit
        const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
        // Wrap rate limit in its own try/catch to ensure it doesn't block critical flow if it fails
        let limitResult = { allowed: true };
        try {
             limitResult = await checkRateLimit(usersKV, clientIp, 'register_attempt', 100, 3600);
        } catch (e) {
             console.warn('[Register] Rate limit check failed (ignoring):', e);
        }

        if (!limitResult.allowed) {
            return json({ message: 'Too many registration attempts. Please try again later.' }, { status: 429 });
        }

        const { username, email, password } = await request.json();

        // 3. Validation
        if (!username || !email || !password) {
            return json({ message: 'Missing required fields' }, { status: 400 });
        }
        
        if (password.length < 8) {
            return json({ message: 'Password must be at least 8 characters' }, { status: 400 });
        }
        
        const normEmail = email.toLowerCase().trim();
        const normUser = username.toLowerCase().trim();

        // 4. Check Existing
        const existingEmail = await findUserByEmail(usersKV, normEmail);
        if (existingEmail) {
            return json({ message: 'Email already in use.' }, { status: 409 });
        }

        const existingUser = await findUserByUsername(usersKV, normUser);
        if (existingUser) {
            return json({ message: 'Username taken.' }, { status: 409 });
        }

        // 5. Check Reservations
        const [resUser, resEmail] = await Promise.all([
            usersKV.get(`reservation:username:${normUser}`),
            usersKV.get(`reservation:email:${normEmail}`)
        ]);

        if (resUser || resEmail) {
            return json({ message: 'Username or Email is pending verification.' }, { status: 409 });
        }

        // 6. Create Pending Record
        const hashedPassword = await hashPassword(password);
        const verificationToken = randomUUID();
        
        const pendingUser = {
            username: normUser,
            email: normEmail,
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };

        const ttl = 86400; // 24 hours

        // 7. Atomic Writes
        await Promise.all([
            usersKV.put(`pending_verify:${verificationToken}`, JSON.stringify(pendingUser), { expirationTtl: ttl }),
            usersKV.put(`reservation:username:${normUser}`, verificationToken, { expirationTtl: ttl }),
            usersKV.put(`reservation:email:${normEmail}`, verificationToken, { expirationTtl: ttl }),
            usersKV.put(`lookup:pending:${normEmail}`, verificationToken, { expirationTtl: ttl })
        ]);

        // 8. Send Email (Likely Failure Point)
        console.log(`[Register] Sending verification email to ${normEmail}...`);
        
        // Wrap email sending specifically to catch config errors
        let emailSent = false;
        try {
            // Pass API key from platform.env (required for Cloudflare Workers)
            const resendApiKey = platform?.env?.RESEND_API_KEY;
            emailSent = await sendVerificationEmail(normEmail, verificationToken, url.origin, resendApiKey);
        } catch (emailErr: any) {
            console.error('[Register] Email send failed:', emailErr);
            
            // Rollback pending registration
            await Promise.all([
                usersKV.delete(`pending_verify:${verificationToken}`),
                usersKV.delete(`reservation:username:${normUser}`),
                usersKV.delete(`reservation:email:${normEmail}`),
                usersKV.delete(`lookup:pending:${normEmail}`)
            ]);
            
            return json({ 
                message: 'Failed to send verification email. Please try again or contact support.',
                technical: emailErr.message 
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
                message: 'Failed to send verification email. Please check your email address and try again.',
                technical: 'Email service returned false'
            }, { status: 500 });
        }

        console.log(`[Register] ✅ Registration successful for ${normEmail}`);
        return json({ 
            success: true, 
            message: 'Verification email sent. Please check your inbox.' 
        });

    } catch (e: any) {
        console.error('[Register] Unexpected error:', e);
        
        // Don't expose stack traces in production
        const isProduction = !url?.hostname?.includes('localhost') && !url?.hostname?.includes('127.0.0.1');
        
        return json({ 
            message: 'Registration failed. Please try again.',
            ...(isProduction ? {} : { 
                debug_error: e.message,
                stack: e.stack 
            })
        }, { status: 500 });
    }
};