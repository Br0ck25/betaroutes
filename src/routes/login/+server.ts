import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { setSessionCookie } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
const { identifier, password } = await request.json();

```
if (!identifier || !password) {
	return new Response(JSON.stringify({ message: 'Missing fields' }), { status: 400 });
}

// Check user by username OR email
const user = await authenticateUser(identifier, password);

if (!user) {
	return new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 });
}

// Set session cookie
setSessionCookie(cookies, user);

return new Response(JSON.stringify({ user }), { status: 200 });
```

};
