import { describe, it, expect } from 'vitest';
import { generateRegistrationOptions } from '../src/lib/server/webauthn';

describe('webauthn option generation', () => {
	it('returns a challenge and proper types', async () => {
		const user: { id: string; email: string; name: string; authenticators: unknown[] } = {
			id: 'test-user',
			email: 't@example.com',
			name: 'Test',
			authenticators: []
		};
		const rpID = 'localhost';

		const opts = await generateRegistrationOptions(user, rpID);

		expect(opts).toBeDefined();
		expect(opts.challenge).toBeDefined();

		const challengeType = typeof opts.challenge;
		const ctor =
			opts.challenge && opts.challenge.constructor ? opts.challenge.constructor.name : undefined;

		console.log('challenge type:', challengeType, 'ctor:', ctor);

		// Accept either string or Buffer/ArrayBuffer – we will convert to base64url server-side
		expect(
			challengeType === 'string' ||
				ctor === 'Uint8Array' ||
				ctor === 'ArrayBuffer' ||
				ctor === 'Buffer'
		).toBe(true);
	});
});
