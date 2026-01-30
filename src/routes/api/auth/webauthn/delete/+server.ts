import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeAuthenticator } from '$lib/server/authenticatorService';
import { verifyPasswordForUser } from '$lib/server/auth';
import { safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { sendSecurityAlertEmail } from '$lib/server/email';
import { getUserEmail } from '$lib/utils/user-display';

export const POST: RequestHandler = async ({ request, platform, locals, cookies }) => {
  try {
    // Check if user is authenticated
    const user = locals.user as { id?: string; email?: string; name?: string } | undefined;
    if (!user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const env = platform?.env;
    if (!safeKV(env, 'BETA_USERS_KV') || !safeKV(env, 'BETA_SESSIONS_KV')) {
      return json({ error: 'Service unavailable' }, { status: 503 });
    }

    const usersKV = safeKV(env, 'BETA_USERS_KV')!;
    const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV')!;

    // Get the credential ID and password from request
    const body = (await request.json()) as Record<string, unknown>;
    const credentialID =
      typeof body['credentialID'] === 'string' ? (body['credentialID'] as string) : undefined;
    const password =
      typeof body['password'] === 'string' ? (body['password'] as string) : undefined;

    if (!credentialID) {
      return json({ error: 'Invalid credential ID' }, { status: 400 });
    }

    // [SECURITY] Sudo Mode: Require password re-entry for sensitive WebAuthn operations
    if (!password) {
      return json({ error: 'Password required', requiresPassword: true }, { status: 403 });
    }

    const passwordValid = await verifyPasswordForUser(usersKV, user.id, password);
    if (!passwordValid) {
      return json({ error: 'Invalid password' }, { status: 401 });
    }

    // Remove the authenticator
    await removeAuthenticator(usersKV, user.id, credentialID);

    // If this credential was used to create the current session, remove it from session KV
    try {
      const sessionId = cookies.get('session_id');
      if (sessionId) {
        const sessionStr = await sessionsKV.get(sessionId);
        if (typeof sessionStr === 'string' && sessionStr) {
          const sessionObj = JSON.parse(sessionStr) as Record<string, unknown>;
          if (
            sessionObj['lastUsedCredentialID'] &&
            typeof sessionObj['lastUsedCredentialID'] === 'string' &&
            sessionObj['lastUsedCredentialID'] === credentialID
          ) {
            delete sessionObj['lastUsedCredentialID'];
            await sessionsKV.put(sessionId, JSON.stringify(sessionObj));
            log.info('[WebAuthn Delete] Cleared lastUsedCredentialID from session', { sessionId });
          }
        }
      }
    } catch (e) {
      log.warn('[WebAuthn Delete] Failed to clear session info', {
        message: createSafeErrorMessage(e)
      });
    }

    // [SECURITY] Send security alert email (best-effort, don't block on failure)
    const email = getUserEmail(user);
    if (email) {
      sendSecurityAlertEmail(email, 'passkey_removed').catch((err) => {
        log.error('[WebAuthn Delete] Security alert email failed', { error: String(err) });
      });
    }

    return json({
      success: true,
      message: 'Passkey removed successfully'
    });
  } catch (error) {
    log.error('[WebAuthn Delete] Error', { message: createSafeErrorMessage(error) });
    return json(
      {
        error: 'Failed to delete passkey'
      },
      { status: 500 }
    );
  }
};
