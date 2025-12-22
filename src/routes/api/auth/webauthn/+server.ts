// src/routes/api/auth/webauthn/+server.ts
import { json } from '@sveltejs/kit';
import { getRegistrationOptions, verifyRegistration, getLoginOptions, verifyLogin } from '$lib/server/webauthn';
import { findUserByCredentialId, saveAuthenticator, type Authenticator } from '$lib/server/userService';
import { createSession } from '$lib/server/sessionService';
import { Buffer } from 'node:buffer'; // Required for Cloudflare/Node compatibility

function getRpID(url: URL) {
    return url.hostname; 
}

export async function GET({ url, cookies, locals }) {
    const type = url.searchParams.get('type');
    const rpID = getRpID(url);

    if (type === 'register') {
        if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

        const options = await getRegistrationOptions(locals.user, rpID);
        cookies.set('webauthn_challenge', options.challenge, { path: '/' });
        return json(options);
    } 
    else {
        const options = await getLoginOptions(rpID);
        cookies.set('webauthn_challenge', options.challenge, { path: '/' });
        return json(options);
    }
}

export async function POST({ request, cookies, platform, locals }) {
    const body = await request.json();
    const challenge = cookies.get('webauthn_challenge');
    
    const url = new URL(request.url);
    const rpID = getRpID(url);
    const origin = url.origin;

    const type = url.searchParams.get('type');

    if (!challenge) return json({ error: 'No challenge found' }, { status: 400 });

    try {
        if (type === 'register') {
            if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

            const verification = await verifyRegistration(body, challenge, rpID, origin);

            if (verification.verified && verification.registrationInfo) {
                const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;

                const newAuthenticator: Authenticator = {
                    credentialID: Buffer.from(credentialID).toString('base64url'),
                    credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64url'),
                    counter,
                    transports: body.response.transports,
                };

                await saveAuthenticator(platform.env.KV, locals.user.id, newAuthenticator);
                return json({ verified: true });
            }
        } else {
            const user = await findUserByCredentialId(platform.env.KV, body.id);
            if (!user || !user.authenticators) return json({ error: 'User not found' }, { status: 400 });

            const authenticator = user.authenticators.find(a => a.credentialID === body.id);
            if (!authenticator) return json({ error: 'Authenticator not found' }, { status: 400 });

            const userCredential = {
                id: body.id,
                publicKey: Buffer.from(authenticator.credentialPublicKey, 'base64url'),
                counter: authenticator.counter
            };

            const verification = await verifyLogin(body, challenge, userCredential, rpID, origin);

            if (verification.verified) {
                const session = await createSession(platform.env.KV, user);
                cookies.set('session_id', session.id, { 
                    path: '/',
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    maxAge: 60 * 60 * 24 * 7 
                });
                return json({ verified: true });
            }
        }
    } catch (e: any) {
        console.error('WebAuthn Error:', e);
        return json({ error: e.message || 'Verification failed' }, { status: 400 });
    }

    return json({ verified: false }, { status: 400 });
}