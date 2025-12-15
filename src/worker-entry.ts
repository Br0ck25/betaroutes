// src/worker-entry.ts

// [!code fix] Export the Durable Object class so Cloudflare can find it
export { TripIndexDO } from '$lib/server/TripIndexDO';

function withCors(resp, req) {
    const allowedOrigins = [
        'https://gorouteyourself.com', 
        'https://beta.gorouteyourself.com',
        'https://betaroute.brocksville.com', 
        'https://logs.gorouteyourself.com'
    ];
    const origin = req.headers.get('Origin');

    if (allowedOrigins.includes(origin)) {
        resp.headers.set('Access-Control-Allow-Origin', origin);
    }

    resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    resp.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    resp.headers.set('Access-Control-Max-Age', '86400');

    return resp;
}

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Helper function to get username from token
async function getUsernameFromToken(env, token) {
    // [!code fix] Updated to BETA_LOGS_KV
    const list = await env.BETA_LOGS_KV.list({ prefix: 'user:' });
    for (const key of list.keys) {
        const userData = await env.BETA_LOGS_KV.get(key.name);
        if (userData) {
            const user = JSON.parse(userData);
            if (user.token === token) {
                return key.name.replace('user:', '');
            }
        }
    }
    return null;
}

export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            const { pathname } = url;
            
            // [!code fix] Ensure we use the correct KV binding from wrangler.toml
            const LOGS_KV = env.BETA_LOGS_KV;

            if (request.method === 'OPTIONS') {
                return withCors(new Response(null, { status: 204 }), request);
            }

            const json = async () => await request.json().catch(() => ({}));
            const getUserKey = (username) => `user:${username}`;
            const getLogsKey = (token) => `logs:${token}`;

            if (pathname === '/api/signup' && request.method === 'POST') {
                const { username, password } = await json();
                const userKey = getUserKey(username);
                if (await LOGS_KV.get(userKey)) {
                    return withCors(Response.json({ error: 'That username is already taken. Please choose another.' }, { status: 400 }), request);
                }

                const token = crypto.randomUUID();
                const resetKey = crypto.randomUUID();
                const hashedPassword = await hashPassword(password);
                await LOGS_KV.put(
                    userKey,
                    JSON.stringify({
                        password: hashedPassword,
                        token,
                        resetKey,
                        createdAt: new Date().toISOString(),
                    })
                );

                return withCors(Response.json({ token, resetKey }), request);
            }

            if (pathname === '/api/login' && request.method === 'POST') {
                const { username, password } = await json();
                const userKey = getUserKey(username);
                const data = await LOGS_KV.get(userKey);
                if (!data) {
                    return withCors(new Response('User not found', { status: 404 }), request);
                }

                const user = JSON.parse(data);
                const hashedPassword = await hashPassword(password);

                // Auto-upgrade from plaintext if needed
                if (user.password === password) {
                    user.password = hashedPassword;
                    await LOGS_KV.put(userKey, JSON.stringify(user));
                }

                if (user.password !== hashedPassword) {
                    return withCors(new Response('Invalid password', { status: 403 }), request);
                }

                return withCors(Response.json({ token: user.token }), request);
            }

            if (pathname === '/api/change-password' && request.method === 'POST') {
                const { username, currentPassword, newPassword } = await json();
                const userKey = getUserKey(username);
                const data = await LOGS_KV.get(userKey);
                if (!data) {
                    return withCors(new Response('User not found', { status: 404 }), request);
                }

                const user = JSON.parse(data);
                const token = request.headers.get('Authorization');
                const hashedCurrent = await hashPassword(currentPassword);

                if (user.token !== token || (user.password !== currentPassword && user.password !== hashedCurrent)) {
                    return withCors(new Response('Unauthorized', { status: 403 }), request);
                }

                user.password = await hashPassword(newPassword);
                await LOGS_KV.put(userKey, JSON.stringify(user));
                return withCors(new Response('Password changed'), request);
            }

            if (pathname === '/api/reset-password' && request.method === 'POST') {
                const { username, resetKey, newPassword } = await json();
                const userKey = getUserKey(username);
                const data = await LOGS_KV.get(userKey);
                if (!data) return withCors(new Response('User not found', { status: 404 }), request);
                const user = JSON.parse(data);
                if (user.resetKey !== resetKey) return withCors(new Response('Invalid reset key', { status: 403 }), request);
                user.password = await hashPassword(newPassword);
                await LOGS_KV.put(userKey, JSON.stringify(user));
                return withCors(new Response('Password reset'), request);
            }

            if (pathname === '/api/delete-account' && request.method === 'POST') {
                const { username, password } = await json();
                const userKey = getUserKey(username);
                const data = await LOGS_KV.get(userKey);
                if (!data) return withCors(new Response('User not found', { status: 404 }), request);
                const user = JSON.parse(data);
                const token = request.headers.get('Authorization');
                const hashedPassword = await hashPassword(password);

                if (user.token !== token || user.password !== hashedPassword) {
                    return withCors(new Response('Unauthorized', { status: 403 }), request);
                }

                await LOGS_KV.delete(userKey);
                await LOGS_KV.delete(getLogsKey(user.token));
                return withCors(new Response('Account deleted'), request);
            }

            // Get subscription status
            if (pathname === '/api/subscription' && request.method === 'GET') {
                const token = request.headers.get('Authorization');
                if (!token) return withCors(new Response('Missing token', { status: 401 }), request);

                const username = await getUsernameFromToken(env, token);
                
                if (username && (username.toLowerCase() === 'james' || username.toLowerCase() === 'jam')) {
                    return withCors(Response.json({
                        plan: 'pro',
                        status: 'active',
                        tripsThisMonth: 50,
                        maxTrips: -1, 
                        features: ['export', 'analytics', 'cloud-sync', 'enhanced-analytics']
                    }), request);
                }

                const userData = await LOGS_KV.get(`subscription:${token}`);
                if (!userData) {
                    return withCors(Response.json({
                        plan: 'free',
                        status: 'active',
                        tripsThisMonth: 0,
                        maxTrips: 10,
                        features: []
                    }), request);
                }

                const subscription = JSON.parse(userData);
                return withCors(Response.json(subscription), request);
            }

            if (pathname === '/logs' && request.method === 'GET') {
                const token = request.headers.get('Authorization');
                if (!token) return withCors(new Response('Missing token', { status: 401 }), request);
                const logs = await LOGS_KV.get(getLogsKey(token));
                return withCors(
                    new Response(logs || '[]', {
                        headers: { 'Content-Type': 'application/json' },
                    }),
                    request
                );
            }

            if (pathname === '/logs' && request.method === 'POST') {
                const token = request.headers.get('Authorization');
                if (!token) return withCors(new Response('Missing token', { status: 401 }), request);
                const body = await request.text();
                await LOGS_KV.put(getLogsKey(token), body);
                return withCors(new Response('Logs saved'), request);
            }

            if (pathname === '/categories' && request.method === 'GET') {
                const token = request.headers.get('Authorization');
                if (!token) return withCors(new Response('Missing token', { status: 401 }), request);
                const categories = await LOGS_KV.get(`categories:${token}`);
                return withCors(
                    new Response(categories || '{"maintenance":[],"supplies":[]}', {
                        headers: { 'Content-Type': 'application/json' },
                    }),
                    request
                );
            }

            if (pathname === '/categories' && request.method === 'POST') {
                const token = request.headers.get('Authorization');
                if (!token) return withCors(new Response('Missing token', { status: 401 }), request);
                const body = await request.text();
                await LOGS_KV.put(`categories:${token}`, body);
                return withCors(new Response('Categories saved'), request);
            }

            if (pathname === '/' || pathname === '/index.html') {
                const html = await env.ASSETS.get('index.html');
                if (!html) return new Response('index.html not found', { status: 404 });

                const resp = new Response(html, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                });

                resp.headers.delete('Cross-Origin-Opener-Policy');
                resp.headers.delete('Cross-Origin-Embedder-Policy');

                return withCors(resp, request);
            }

            if (pathname === '/admin/users' && request.method === 'GET') {
                if (url.searchParams.get('adminToken') !== env.ADMIN_TOKEN) {
                    return new Response('Unauthorized', { status: 403 });
                }
                const list = await LOGS_KV.list({ prefix: 'user:' });
                const users = list.keys.map((k) => k.name.replace(/^user:/, ''));

                const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Admin Panel - Go Route Yourself</title>
    </head>
  <body>
    <h1>⚙ Admin Panel – Registered Users</h1>
    <div class="table-wrapper">
      <table>
        <tr><th>Username</th><th>Actions</th></tr>
        ${users.map(user => `
          <tr>
            <td>${user}</td>
            <td>
              <button class="danger" onclick="deleteUser('${user}')">Delete</button>
              <button class="reset" onclick="resetUser('${user}')">Reset Password</button>
            </td>
          </tr>
        `).join('')}
      </table>
      <footer>Go Route Yourself Admin © ${new Date().getFullYear()}</footer>
    </div>
    <script>
      async function deleteUser(username) {
        if (!confirm("Delete user " + username + "?")) return;
        const res = await fetch("/admin/users?adminToken=${url.searchParams.get('adminToken')}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", username })
        });
        alert(await res.text());
        location.reload();
      }

      async function resetUser(username) {
        const tempPassword = prompt("Enter a temporary password for " + username);
        if (!tempPassword) return;
        const res = await fetch("/admin/users?adminToken=${url.searchParams.get('adminToken')}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reset-password", username, tempPassword })
        });
        alert(await res.text());
      }
    </script>
  </body>
</html>`;
                return new Response(html, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                });
            }

            if (pathname === '/admin/users' && request.method === 'POST') {
                if (url.searchParams.get('adminToken') !== env.ADMIN_TOKEN) {
                    return new Response('Unauthorized', { status: 403 });
                }

                const { action, username, tempPassword } = await json();
                const userKey = `user:${username}`;
                const userData = await LOGS_KV.get(userKey);
                if (!userData) return new Response('User not found', { status: 404 });

                const user = JSON.parse(userData);

                if (action === 'delete') {
                    await LOGS_KV.delete(userKey);
                    await LOGS_KV.delete(`logs:${user.token}`);
                    return new Response('✓ User deleted');
                }

                if (action === 'reset-password' && tempPassword) {
                    user.password = await hashPassword(tempPassword);
                    await LOGS_KV.put(userKey, JSON.stringify(user));
                    return new Response('✓ Password reset');
                }

                return new Response('✗ Invalid action', { status: 400 });
            }

            if (pathname === '/favicon.ico') {
                const favicon = await env.ASSETS.get('logo512.png', { type: 'stream' });
                if (!favicon) return new Response('favicon not found', { status: 404 });

                const resp = new Response(favicon.body, favicon);
                resp.headers.set('Content-Type', 'image/png');
                return withCors(resp, request);
            }

            const assetPath = pathname.slice(1);
            const asset = await env.ASSETS.get(assetPath, { type: 'stream' });

            if (asset) {
                const ext = assetPath.split('.').pop().toLowerCase();
                const contentTypes = {
                    html: 'text/html',
                    json: 'application/json',
                    js: 'application/javascript',
                    css: 'text/css',
                    png: 'image/png',
                    jpg: 'image/jpeg',
                    jpeg: 'image/jpeg',
                    ico: 'image/x-icon',
                    svg: 'image/svg+xml',
                    webmanifest: 'application/manifest+json',
                    xml: 'application/xml',
                };

                const resp = new Response(asset.body, {
                    headers: {
                        'Content-Type': contentTypes[ext] || 'application/octet-stream',
                    },
                });
                return withCors(resp, request);
            }

            return withCors(new Response('Not found', { status: 404 }), request);
        } catch (err) {
            console.error('Worker error:', err);
            return withCors(Response.json({ error: 'Internal Server Error', details: err.message }, { status: 500 }), request);
        }
    },
};