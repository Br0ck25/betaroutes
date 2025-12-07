// src/routes/login/+page.server.ts
import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) {
		throw redirect(303, '/dashboard');
	}
	return {};
};

// Helper to save user to KV (Mock or Real)
async function saveUserToKV(platform: App.Platform | undefined, token: string, username: string) {
	const usersKV = platform?.env?.BETA_USERS_KV;

	if (usersKV) {
		const userPayload = {
			token,
			name: username,
			email: username.includes('@') ? username : '',
			plan: 'free',
			tripsThisMonth: 0,
			maxTrips: 10,
			resetDate: new Date().toISOString(),
			createdAt: new Date().toISOString()
		};

		await usersKV.put(token, JSON.stringify(userPayload));
		console.log(`[AUTH] Saved user ${username} to KV`);
	} else {
		console.warn('[AUTH] Warning: BETA_USERS_KV not available');
	}
}

export const actions: Actions = {
	login: async ({ request, cookies, fetch, platform }) => {
		const data = await request.formData();
		const username = data.get('username')?.toString();
		const password = data.get('password')?.toString();

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required' });
		}

		try {
			const response = await fetch('https://logs.gorouteyourself.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});

			if (!response.ok) {
				let errorMessage = 'Invalid username or password';
				try {
					const errorData = await response.json();
					errorMessage = errorData.error || errorData.message || errorMessage;
				} catch (e) {
					/* empty */
				}
				return fail(response.status, { error: errorMessage });
			}

			const result = await response.json();
			const token = result.token;

			if (!token) return fail(500, { error: 'No token received from server' });

			// 1. Save to KV so it persists in your local DB
			await saveUserToKV(platform, token, username);

			// 2. Set cookie
			cookies.set('token', token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 30
			});

			throw redirect(303, '/dashboard');
		} catch (error: any) {
			if (error?.status === 303) throw error;
			console.error('Login error:', error);
			return fail(500, { error: error.message || 'Login failed.' });
		}
	},

	signup: async ({ request, cookies, fetch, platform }) => {
		const data = await request.formData();
		const username = data.get('username')?.toString();
		const password = data.get('password')?.toString();
		const confirmPassword = data.get('confirmPassword')?.toString();

		if (!username || !password || !confirmPassword) {
			return fail(400, { error: 'All fields are required' });
		}

		if (password !== confirmPassword) {
			return fail(400, { error: 'Passwords do not match' });
		}

		if (password.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters' });
		}

		try {
			const response = await fetch('https://logs.gorouteyourself.com/api/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});

			if (!response.ok) {
				let errorMessage = 'Signup failed';
				try {
					const errorData = await response.json();
					errorMessage = errorData.error || errorData.message || errorMessage;
				} catch (e) {
					errorMessage = response.statusText || errorMessage;
				}
				return fail(response.status, { error: errorMessage });
			}

			const result = await response.json();
			const token = result.token;

			if (!token) return fail(500, { error: 'No token received from server' });

			// 1. Save to KV
			await saveUserToKV(platform, token, username);

			// 2. Set cookie
			cookies.set('token', token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 30
			});

			throw redirect(303, '/dashboard');
		} catch (error: any) {
			if (error?.status === 303) throw error;
			console.error('Signup error:', error);
			return fail(500, { error: error.message || 'Signup failed.' });
		}
	}
};
