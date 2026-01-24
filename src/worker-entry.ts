// src/worker-entry.ts

// [!code fix] Export the correct class names defined in wrangler.toml
import type { KVNamespace } from '@cloudflare/workers-types';
export { TripIndexSQL, PlacesIndexSQL } from './do-worker';

/**
 * [!code fix] UPGRADED SECURITY:
 * Using PBKDF2 with high iterations to prevent rainbow table attacks,
 * matching the security standard in src/lib/server/auth.ts
 */
async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
	const PBKDF2_ITERATIONS = 100000;
	const SALT_SIZE = 16;
	const HASH_ALGO = 'SHA-256';
	const enc = new TextEncoder();

	const usedSalt = salt || crypto.getRandomValues(new Uint8Array(SALT_SIZE));

	const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
		'deriveBits'
	]);

	const saltBuf = (usedSalt as Uint8Array).buffer as ArrayBuffer;
	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: saltBuf,
			iterations: PBKDF2_ITERATIONS,
			hash: HASH_ALGO
		},

		keyMaterial,
		256
	);

	const bufferToHex = (arr: Uint8Array) =>
		[...arr].map((b) => b.toString(16).padStart(2, '0')).join('');

	return `v1:${PBKDF2_ITERATIONS}:${bufferToHex(usedSalt)}:${bufferToHex(new Uint8Array(derivedBits as ArrayBuffer))}`;
}

/**
 * Constant-time comparison to prevent timing attacks
 */
function safeCompare(stored: string, provided: string): boolean {
	if (stored.length !== provided.length) return false;
	let result = 0;
	for (let i = 0; i < stored.length; i++) {
		result |= stored.charCodeAt(i) ^ provided.charCodeAt(i);
	}
	return result === 0;
}

function withCors(resp: Response, req: Request) {
	const allowedOrigins = [
		'https://gorouteyourself.com',
		'https://beta.gorouteyourself.com',
		'https://betaroute.brocksville.com',
		'https://logs.gorouteyourself.com'
	];
	const origin = req.headers.get('Origin');

	if (origin && allowedOrigins.includes(origin)) {
		resp.headers.set('Access-Control-Allow-Origin', origin);
	}
	resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	resp.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	resp.headers.set('Access-Control-Max-Age', '86400');
	return resp;
}

export default {
	async fetch(request: Request, env: Record<string, unknown>, _ctx: unknown) {
		void _ctx;
		try {
			const url = new URL(request.url);
			const { pathname } = url;
			const platformEnv = env as Record<string, unknown>;
			const LOGS_KV = platformEnv['BETA_LOGS_KV'] as unknown as KVNamespace; //

			if (request.method === 'OPTIONS') {
				return withCors(new Response(null, { status: 204 }), request);
			}

			const json = async () => await request.json().catch(() => ({}));
			const getUserKey = (username: string) => `user:${username}`;

			if (pathname === '/api/signup' && request.method === 'POST') {
				const body = (await json()) as Record<string, unknown>;
				const username = String(body['username'] ?? '');
				const password = String(body['password'] ?? '');
				const userKey = getUserKey(username);
				if (await LOGS_KV.get(userKey)) {
					return withCors(Response.json({ error: 'Username taken.' }, { status: 400 }), request);
				}

				const token = crypto.randomUUID();
				const hashedPassword = await hashPassword(password);
				await LOGS_KV.put(
					userKey,
					JSON.stringify({
						password: hashedPassword,
						token,
						createdAt: new Date().toISOString()
					})
				);

				// Do NOT return session tokens from legacy login/signup endpoints
				return withCors(Response.json({ success: true }), request);
			}

			if (pathname === '/api/login' && request.method === 'POST') {
				const body = (await json()) as Record<string, unknown>;
				const username = String(body['username'] ?? '');
				const password = String(body['password'] ?? '');
				const userKey = getUserKey(username);
				const data = await LOGS_KV.get(userKey);
				if (!data) return withCors(new Response('Not found', { status: 404 }), request);

				const user = JSON.parse(data);

				// [!code fix] Verification using PBKDF2 logic
				const parts = user.password.split(':');
				let matches = false;

				if (parts[0] === 'v1') {
					const salt = new Uint8Array(
						(parts[2] as string).match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
					);
					const challengeHash = await hashPassword(password, salt);
					matches = safeCompare(user.password, challengeHash);
				} else if (user.password === password) {
					// Auto-migration for legacy plaintext
					user.password = await hashPassword(password);
					await LOGS_KV.put(userKey, JSON.stringify(user));
					matches = true;
				}

				if (!matches) return withCors(new Response('Invalid', { status: 403 }), request);
				// Do NOT expose session token from legacy login endpoint
				return withCors(Response.json({ success: true }), request);
			}

			// ... (Rest of your endpoint logic using same verification patterns)

			return withCors(new Response('Not found', { status: 404 }), request);
		} catch (err) {
			console.error('worker error', err);
			return withCors(Response.json({ error: 'Server Error' }, { status: 500 }), request);
		}
	}
};
