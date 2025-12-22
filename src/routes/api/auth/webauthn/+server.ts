import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateRegistrationOptions, verifyRegistrationResponse } from '$lib/server/webauthn';
import { db } from '$lib/server/db';
import { authenticators } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

// 🔧 Dynamic RP ID and Origin based on environment
function getRpID(request: Request): string {
  const hostname = new URL(request.url).hostname;
  console.log('[WebAuthn] Hostname:', hostname);
  
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost';
  }
  return 'gorouteyourself.com';
}

function getOrigin(request: Request): string {
  const url = new URL(request.url);
  console.log('[WebAuthn] Origin:', url.origin);
  return url.origin;
}

// GET: Generate registration options
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
  try {
    const type = url.searchParams.get('type');
    console.log('[WebAuthn] GET request - Type:', type);
    
    if (type !== 'register') {
      console.error('[WebAuthn] Invalid type:', type);
      return json({ error: 'Invalid request type' }, { status: 400 });
    }

    const session = await locals.auth();
    if (!session?.user?.email) {
      console.error('[WebAuthn] No authenticated user');
      return json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = session.user.email;
    console.log('[WebAuthn] Generating registration options for:', userEmail);

    // Get user from database
    const user = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.email, userEmail),
      with: {
        authenticators: true
      }
    });

    if (!user) {
      console.error('[WebAuthn] User not found:', userEmail);
      return json({ error: 'User not found' }, { status: 404 });
    }

    console.log('[WebAuthn] User found:', user.id, 'Existing authenticators:', user.authenticators?.length || 0);

    // Generate registration options
    const options = await generateRegistrationOptions(user);
    
    if (!options || !options.challenge) {
      console.error('[WebAuthn] Failed to generate options or missing challenge');
      return json({ error: 'Failed to generate registration options' }, { status: 500 });
    }

    console.log('[WebAuthn] Options generated successfully');
    console.log('[WebAuthn] Challenge length:', options.challenge.length);
    console.log('[WebAuthn] Challenge (first 20 chars):', options.challenge.substring(0, 20));

    // 🔧 CRITICAL: Store challenge in cookie with proper settings
    cookies.set('webauthn-challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 5 // 5 minutes
    });

    console.log('[WebAuthn] Challenge stored in cookie');

    return json(options);
  } catch (error) {
    console.error('[WebAuthn] GET Error:', error);
    return json({ 
      error: 'Failed to generate registration options',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};

// POST: Verify registration response
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  try {
    const type = new URL(request.url).searchParams.get('type');
    console.log('[WebAuthn] POST request - Type:', type);
    
    if (type !== 'register') {
      console.error('[WebAuthn] Invalid type:', type);
      return json({ error: 'Invalid request type' }, { status: 400 });
    }

    const session = await locals.auth();
    if (!session?.user?.email) {
      console.error('[WebAuthn] No authenticated user');
      return json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = session.user.email;
    console.log('[WebAuthn] Verifying registration for:', userEmail);

    // 🔧 CRITICAL: Retrieve challenge from cookie
    const expectedChallenge = cookies.get('webauthn-challenge');
    
    if (!expectedChallenge) {
      console.error('[WebAuthn] No challenge found in cookies');
      console.error('[WebAuthn] Available cookies:', Object.keys(cookies.getAll()));
      return json({ 
        error: 'Challenge expired or not found. Please try registering again.',
        hint: 'The registration process must be completed within 5 minutes.'
      }, { status: 400 });
    }

    console.log('[WebAuthn] Challenge retrieved from cookie');
    console.log('[WebAuthn] Challenge length:', expectedChallenge.length);
    console.log('[WebAuthn] Challenge (first 20 chars):', expectedChallenge.substring(0, 20));

    // Get credential from request body
    const credential = await request.json();
    console.log('[WebAuthn] Credential received');
    console.log('[WebAuthn] Credential ID:', credential.id);
    console.log('[WebAuthn] Credential type:', credential.type);

    // Get user from database
    const user = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.email, userEmail),
      with: {
        authenticators: true
      }
    });

    if (!user) {
      console.error('[WebAuthn] User not found:', userEmail);
      return json({ error: 'User not found' }, { status: 404 });
    }

    console.log('[WebAuthn] User found:', user.id);

    // 🔧 Get origin and rpID dynamically
    const expectedOrigin = getOrigin(request);
    const expectedRPID = getRpID(request);

    console.log('[WebAuthn] Expected origin:', expectedOrigin);
    console.log('[WebAuthn] Expected RP ID:', expectedRPID);

    // Verify the registration response
    console.log('[WebAuthn] Starting verification...');
    
    const verification = await verifyRegistrationResponse(
      credential,
      expectedChallenge,
      expectedOrigin,
      expectedRPID
    );

    console.log('[WebAuthn] Verification result:', verification.verified);

    if (!verification.verified || !verification.registrationInfo) {
      console.error('[WebAuthn] Verification failed');
      console.error('[WebAuthn] Verification object:', verification);
      return json({ 
        error: 'Registration verification failed',
        details: 'The credential could not be verified. Please try again.'
      }, { status: 400 });
    }

    console.log('[WebAuthn] Verification successful!');

    // Save the authenticator to database
    const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;
    
    console.log('[WebAuthn] Saving authenticator to database...');
    console.log('[WebAuthn] Credential ID (base64url):', credentialID);
    console.log('[WebAuthn] Counter:', counter);

    await db.insert(authenticators).values({
      userId: user.id,
      credentialID: Buffer.from(credentialID).toString('base64url'),
      credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64url'),
      counter: counter,
      transports: credential.response.transports || []
    });

    console.log('[WebAuthn] Authenticator saved successfully!');

    // 🔧 Clear the challenge cookie after successful registration
    cookies.delete('webauthn-challenge', { path: '/' });
    console.log('[WebAuthn] Challenge cookie cleared');

    return json({ 
      success: true,
      verified: true,
      message: 'Passkey registered successfully!'
    });

  } catch (error) {
    console.error('[WebAuthn] POST Error:', error);
    
    // Provide detailed error information
    if (error instanceof Error) {
      console.error('[WebAuthn] Error name:', error.name);
      console.error('[WebAuthn] Error message:', error.message);
      console.error('[WebAuthn] Error stack:', error.stack);
      
      return json({ 
        error: 'Registration verification failed',
        details: error.message,
        hint: 'Check server logs for more details'
      }, { status: 400 });
    }
    
    return json({ 
      error: 'An unexpected error occurred',
      details: 'Unknown error type'
    }, { status: 500 });
  }
};