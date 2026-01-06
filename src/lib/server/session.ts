import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'session';

export function setSessionCookie(cookies: Cookies, user: any) {
	cookies.set(COOKIE_NAME, JSON.stringify(user), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: false, // set true in production
		maxAge: 60 * 60 * 24 * 30 // 30 days
	});
}

export function clearSessionCookie(cookies: Cookies) {
	cookies.delete(COOKIE_NAME, { path: '/' });
}

export function getUserFromCookies(cookies: Cookies) {
	const raw = cookies.get(COOKIE_NAME);
	if (!raw) return null;

	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
