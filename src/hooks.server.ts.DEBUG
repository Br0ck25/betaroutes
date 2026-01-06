// /src/hooks.server.ts
// FALLBACK VERSION - Works even if /api/subscription doesn't exist

export const handle = async ({ event, resolve }) => {
    console.log('[HOOK] ===== HOOK EXECUTING =====');
    console.log('[HOOK] Request URL:', event.url.pathname);
    
    const token = event.cookies.get('token');
    console.log('[HOOK] Token from cookie:', token ? `exists (${token})` : 'missing');
    
    if (token) {
        // Token exists, try to fetch subscription data
        try {
            console.log('[HOOK] Fetching subscription data...');
            const res = await fetch('https://logs.gorouteyourself.com/api/subscription', {
                headers: {
                    Authorization: token
                }
            });
            
            console.log('[HOOK] Subscription API status:', res.status);
            
            if (res.ok) {
                const subscriptionData = await res.json();
                console.log('[HOOK] Subscription data:', subscriptionData);
                
                event.locals.user = {
                    token,
                    plan: subscriptionData.plan,
                    tripsThisMonth: subscriptionData.tripsThisMonth,
                    maxTrips: subscriptionData.maxTrips,
                    resetDate: subscriptionData.resetDate
                };
                
                console.log('[HOOK] User set from subscription API');
            } else {
                // Subscription endpoint doesn't exist or failed
                // Fall back to minimal user object with just the token
                console.log('[HOOK] Subscription API failed, using minimal user object');
                event.locals.user = {
                    token,
                    plan: 'free',
                    tripsThisMonth: 0,
                    maxTrips: 10,
                    resetDate: new Date().toISOString()
                };
                console.log('[HOOK] User set with fallback defaults');
            }
        } catch (err) {
            console.error('[HOOK] Error fetching subscription:', err);
            // On error, still set minimal user object if we have a token
            console.log('[HOOK] Using fallback user object due to error');
            event.locals.user = {
                token,
                plan: 'free',
                tripsThisMonth: 0,
                maxTrips: 10,
                resetDate: new Date().toISOString()
            };
        }
    } else {
        console.log('[HOOK] No token, setting user to null');
        event.locals.user = null;
    }
    
    console.log('[HOOK] Final locals.user:', event.locals.user ? 'SET' : 'NULL');
    console.log('[HOOK] ===== HOOK COMPLETE =====');
    
    return resolve(event);
};
