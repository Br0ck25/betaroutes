import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
    // 1. Ensure KV bindings exist (mock in dev)
    if (dev) {
        const { setupMockKV } = await import('$lib/server/dev-mock-db');
        setupMockKV(event);
    }

    const sessionKV = event.platform?.env?.BETA_SESSIONS_KV;
    const userKV = event.platform?.env?.BETA_USERS_KV;

    // 2. Define Cookie Name (Strict __Host- prefix in production)
    const COOKIE_NAME = dev ? 'session_id' : '__Host-session_id';
    const sessionId = event.cookies.get(COOKIE_NAME);

    // 3. Process Session
    if (sessionId && sessionKV && userKV) {
        try {
            const sessionDataStr = await sessionKV.get(sessionId);

            if (sessionDataStr) {
                const session = JSON.parse(sessionDataStr);
                
                // Stale Data/Quota Bypass: Fetch fresh user data
                const freshUserStr = await userKV.get(`user:${session.id}`); 
                const freshUser = freshUserStr ? JSON.parse(freshUserStr) : null;

                if (freshUser) {
                    event.locals.user = {
                        id: freshUser.id,
                        token: sessionId,
                        plan: freshUser.plan ?? 'free',
                        tripsThisMonth: freshUser.tripsThisMonth ?? 0,
                        maxTrips: freshUser.maxTrips ?? 10,
                        resetDate: freshUser.resetDate ?? new Date().toISOString(),
                        name: freshUser.username,
                        email: freshUser.email,
                        role: freshUser.role ?? 'user'
                    };

                    // Rolling Sessions: Extend Cookie
                    event.cookies.set(COOKIE_NAME, sessionId, {
                        path: '/',
                        httpOnly: true,
                        sameSite: 'lax',
                        secure: !dev,
                        maxAge: 60 * 60 * 24 * 7 
                    });
                } else {
                    event.locals.user = null;
                }
            } else {
                if (event.url.pathname.startsWith('/dashboard')) {
                   event.cookies.delete(COOKIE_NAME, { path: '/' });
                }
                event.locals.user = null;
            }
        } catch (err) {
            console.error('[HOOK] Session Parse Error:', err);
            event.cookies.delete(COOKIE_NAME, { path: '/' });
            event.locals.user = null;
        }
    } else {
        event.locals.user = null;
    }

    // 4. Generate Response
    const response = await resolve(event);

    // 5. Add Security Headers
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    
    // [!code fix] Updated CSP for Google Maps (Script + Connect)
    response.headers.set(
        'Content-Security-Policy', 
        "default-src 'self'; " +
        "img-src 'self' data: https:; " +
        "script-src 'self' 'unsafe-inline' https://maps.googleapis.com; " + 
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " + 
        "font-src 'self' https://fonts.gstatic.com; " +
        "connect-src 'self' https://maps.googleapis.com https://maps.gstatic.com;"
    );

    if (!dev) {
        response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }

    return response;
};