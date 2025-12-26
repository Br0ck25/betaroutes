import type { RequestHandler } from './$types';
import { generateRegistrationOptions } from '$lib/server/webauthn';

export const GET: RequestHandler = async () => {
  try {
    const mockUser = {
      id: 'test-user-123',
      email: 'test@example.com',
      name: 'Test User',
      authenticators: []
    };

    const rpID = 'localhost';
    const options = await generateRegistrationOptions(mockUser as any, rpID as any);

    function fieldInfo(val: any) {
      return {
        type: typeof val,
        ctor: val && (val.constructor ? val.constructor.name : undefined),
        len: val && (val.byteLength || val.length)
      };
    }

    return new Response(JSON.stringify({ optionsPreview: { challengeInfo: fieldInfo(options.challenge), excludeCreds: (options.excludeCredentials || []).map((c: any) => ({ idInfo: fieldInfo(c.id) })) }, full: options }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};