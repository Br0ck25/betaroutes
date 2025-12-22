// src/routes/api/auth/webauthn/+server.ts
import { json } from '@sveltejs/kit';
import { getLoginOptions, verifyLogin } from '$lib/server/webauthn';
import { authenticateUser } from '$lib/server/auth'; // You might need to adjust this to find user by credential ID
import { createSession } from '$lib/server/sessionService'; // Assuming you have this

// 1. GET: Request a Challenge
export async function GET({ cookies, platform }) {
    const options = await getLoginOptions();
    
    // Store challenge in a secure, httpOnly cookie so we can verify it later
    cookies.set('webauthn_challenge', options.challenge, { path: '/' });
    
    return json(options);
}

// 2. POST: Verify the Biometric Signature
export async function POST({ request, cookies, platform }) {
    const body = await request.json();
    const challenge = cookies.get('webauthn_challenge');

    if (!challenge) return json({ error: 'No challenge found' }, { status: 400 });

    // TODO: In a real app, look up the user in KV by the credential ID sent in 'body.id'
    // const user = await findUserByCredentialId(platform.env.YOUR_KV, body.id);
    // const authenticator = user.authenticators.find(a => a.id === body.id);

    // MOCK for demonstration (You must implement the DB lookup)
    const mockAuthenticator = { id: body.id, publicKey: new Uint8Array([]), counter: 0 }; 

    try {
        const verification = await verifyLogin(body, challenge, mockAuthenticator);

        if (verification.verified) {
            // Log the user in
            // const session = await createSession(platform.env.YOUR_KV, user);
            // cookies.set('session', session.id, { path: '/' });
            return json({ verified: true });
        }
    } catch (e) {
        return json({ error: 'Verification failed' }, { status: 400 });
    }

    return json({ verified: false }, { status: 400 });
}