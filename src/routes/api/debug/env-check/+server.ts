// src/routes/api/debug/env-check/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnv, safeKV, safeDO } from '$lib/server/env';

export const GET: RequestHandler = async ({ platform, url }) => {
    const env = getEnv(platform);
    const checks = {
        environment: url.hostname.includes('localhost') ? 'development' : 'production',
        bindings: {
            BETA_USERS_KV: !!safeKV(env, 'BETA_USERS_KV'),
            BETA_SESSIONS_KV: !!safeKV(env, 'BETA_SESSIONS_KV'),
            BETA_LOGS_KV: !!safeKV(env, 'BETA_LOGS_KV'),
            BETA_LOGS_TRASH_KV: !!safeKV(env, 'BETA_LOGS_TRASH_KV'),
            BETA_USER_SETTINGS_KV: !!safeKV(env, 'BETA_USER_SETTINGS_KV'),
            BETA_PLACES_KV: !!safeKV(env, 'BETA_PLACES_KV'),
            BETA_DIRECTIONS_KV: !!safeKV(env, 'BETA_DIRECTIONS_KV'),
            BETA_HUGHESNET_KV: !!safeKV(env, 'BETA_HUGHESNET_KV'),
            TRIP_INDEX_DO: !!safeDO(env, 'TRIP_INDEX_DO')
        },
        secrets: {
            RESEND_API_KEY: !!env.RESEND_API_KEY,
            RESEND_KEY_LENGTH: env.RESEND_API_KEY?.length || 0,
            RESEND_KEY_PREFIX: env.RESEND_API_KEY?.substring(0, 3) || 'N/A',
            PRIVATE_GOOGLE_MAPS_API_KEY: !!env.PRIVATE_GOOGLE_MAPS_API_KEY,
            HNS_ENCRYPTION_KEY: !!env.HNS_ENCRYPTION_KEY
        },
        critical_missing: [] as string[]
    }; 

    // Check critical requirements
    if (!checks.bindings.BETA_USERS_KV) {
        checks.critical_missing.push('BETA_USERS_KV binding');
    }
    if (!checks.bindings.BETA_SESSIONS_KV) {
        checks.critical_missing.push('BETA_SESSIONS_KV binding');
    }
    if (!checks.secrets.RESEND_API_KEY && checks.environment === 'production') {
        checks.critical_missing.push('RESEND_API_KEY secret');
    }

    const status = checks.critical_missing.length === 0 ? 'healthy' : 'missing_config';

    return json({
        status,
        ...checks,
        message: status === 'healthy' 
            ? '✅ All critical configuration present' 
            : `❌ Missing: ${checks.critical_missing.join(', ')}`
    });
};

// POST endpoint to test email sending
export const POST: RequestHandler = async ({ request, platform }) => {
    const logs: string[] = [];
    
    try {
        logs.push('🔍 Testing email service...');
        
        // 1. Check platform
        logs.push(`Platform exists: ${!!platform}`);
        logs.push(`Platform.env exists: ${!!platform?.env}`);
        
        // 2. Check API key
        const env = getEnv(platform);
        const resendKey = env.RESEND_API_KEY;
        logs.push(`RESEND_API_KEY exists: ${!!resendKey}`);
        logs.push(`RESEND_API_KEY length: ${resendKey?.length || 0}`);
        logs.push(`RESEND_API_KEY prefix: ${resendKey?.substring(0, 3) || 'N/A'}`);
        
        if (!resendKey) {
            logs.push('❌ RESEND_API_KEY is not set in environment');
            return json({ 
                success: false, 
                error: 'RESEND_API_KEY not configured',
                logs 
            }, { status: 500 });
        }
        
        // 3. Get test email from request
        const body: any = await request.json();
        const { email } = body;
        if (!email) {
            return json({ 
                success: false,
                error: 'Email required in request body: {"email": "test@example.com"}',
                logs 
            }, { status: 400 });
        }
        
        logs.push(`Target email: ${email}`);
        logs.push('📧 Attempting to send via Resend API...');
        
        // 4. Try sending test email
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resendKey}`
            },
            body: JSON.stringify({
                from: 'Go Route Yourself <noreply@gorouteyourself.com>',
                to: email,
                subject: 'Test Email from Go Route Yourself',
                html: '<h1>✅ Success!</h1><p>Your email service is working correctly.</p>'
            })
        });
        
        logs.push(`Resend API status: ${res.status}`);
        
        if (!res.ok) {
            const errorText = await res.text();
            logs.push(`❌ Resend API error response: ${errorText}`);
            return json({ 
                success: false,
                error: 'Resend API failed',
                statusCode: res.status,
                details: errorText,
                logs 
            }, { status: 500 });
        }
        
        const data: any = await res.json();
        logs.push(`✅ Email sent successfully!`);
        logs.push(`Email ID: ${data.id}`);
        
        return json({ 
            success: true, 
            message: 'Test email sent successfully',
            emailId: data.id,
            logs 
        });
        
    } catch (e: any) {
        logs.push(`❌ Unexpected error: ${e.message}`);
        return json({ 
            success: false,
            error: 'Unexpected error',
            message: e.message,
            logs 
        }, { status: 500 });
    }
};