import type { RequestHandler } from './$types';
import { generateRegistrationOptions } from '$lib/server/webauthn';
import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	// [SECURITY] Debug endpoints must not be accessible in production
	if (!dev && process.env['NODE_ENV'] === 'production') {
		return json({ error: 'Not available in production' }, { status: 403 });
	}

	try {
		const mockUser: {
			id: string;
			email: string;
			name?: string;
			authenticators?: Array<{ credentialID?: string; transports?: AuthenticatorTransport[] }>;
		} = {
			id: 'test-user-123',
			email: 'test@example.com',
			name: 'Test User',
			authenticators: []
		};

		const rpID = 'localhost';
		const options = await generateRegistrationOptions(
			mockUser as unknown as Parameters<typeof generateRegistrationOptions>[0],
			String(rpID)
		);

		function fieldInfo(val: unknown) {
			const type = typeof val;
			let ctor: string | undefined;
			let len: number | undefined;
			if (typeof val === 'object' && val !== null) {
				ctor = (val as { constructor?: { name?: string } }).constructor?.name;
				if (
					'byteLength' in (val as object) &&
					typeof (val as { byteLength?: unknown }).byteLength === 'number'
				) {
					len = (val as { byteLength?: number }).byteLength;
				} else if (
					'length' in (val as object) &&
					typeof (val as { length?: unknown }).length === 'number'
				) {
					len = (val as { length?: number }).length;
				}
			}
			return { type, ctor, len };
		}

		return new Response(
			JSON.stringify({
				optionsPreview: {
					challengeInfo: fieldInfo(options.challenge),
					excludeCreds: (options.excludeCredentials || []).map((c: { id?: unknown }) => ({
						idInfo: fieldInfo(c.id)
					}))
				},
				full: options
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (err) {
		return new Response(
			JSON.stringify({
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
