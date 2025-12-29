/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { generateRegistrationOptions } from './webauthn';
import { log } from '$lib/server/log';

describe('webauthn option generation (server)', () => {
	it('returns a challenge and proper types', async () => {
		const user = {
			id: 'test-user',
			email: 't@example.com',
			name: 'Test',
			authenticators: []
		} as any;
		const rpID = 'localhost';

		const opts = await generateRegistrationOptions(user, rpID);

		expect(opts).toBeDefined();
		expect(opts.challenge).toBeDefined();

		const challengeType = typeof opts.challenge;
		const ctor =
			opts.challenge && opts.challenge.constructor ? opts.challenge.constructor.name : undefined;

		log.debug('challenge type:', challengeType, 'ctor:', ctor);

		// Accept either string or Buffer/ArrayBuffer/Uint8Array
		expect(['string', 'object'].includes(challengeType)).toBe(true);
		expect(
			ctor === 'Uint8Array' ||
				ctor === 'ArrayBuffer' ||
				ctor === 'Buffer' ||
				typeof opts.challenge === 'string'
		).toBe(true);
	});
});
