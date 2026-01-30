/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

/**
 * @deprecated LEGACY FILE - DO NOT USE
 *
 * This file is a legacy Cloudflare Worker from before the SvelteKit migration.
 * It is NOT used in production. The active worker is built from SvelteKit at:
 *   .svelte-kit/cloudflare (see wrangler.toml pages_build_output_dir)
 *
 * SECURITY WARNINGS:
 * 1. Uses timing-unsafe password comparison (line ~101)
 * 2. Uses simple SHA-256 instead of PBKDF2 with salt
 * 3. No rate limiting on authentication endpoints
 *
 * This file is kept for historical reference only. Consider deleting.
 *
 * @see src/worker-entry.ts for the current secure implementation
 */

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
  // Prefer session mapping in SESSIONS_KV if available
  const sessionsKV = env.SESSIONS_KV || env.BETA_SESSIONS_KV;
  if (sessionsKV) {
    const s = await sessionsKV.get(token);
    if (s) {
      try {
        const session = JSON.parse(s);
        if (session.name) return session.name;
        if (session.email) return session.email;
        if (session.id) return session.id; // fallback to id-like identifier
      } catch {
        // continue to fallback
      }
    }
  }

  // Do NOT search users KV for legacy tokens — session tokens are stored in SESSIONS_KV.
  // Return null when no session mapping found.
  return null;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;

      if (request.method === 'OPTIONS') {
        return withCors(new Response(null, { status: 204 }), request);
      }

      const json = async () => await request.json().catch(() => ({}));
      const getUserKey = (username) => `user:${username}`;

      if (pathname === '/api/signup' && request.method === 'POST') {
        const { username, password } = await json();
        const userKey = getUserKey(username);
        if (await env.LOGS_KV.get(userKey)) {
          return withCors(
            Response.json(
              { error: 'That username is already taken. Please choose another.' },
              { status: 400 }
            ),
            request
          );
        }

        const token = crypto.randomUUID();
        const resetKey = crypto.randomUUID();
        const hashedPassword = await hashPassword(password);
        await env.LOGS_KV.put(
          userKey,
          JSON.stringify({
            password: hashedPassword,
            token,
            resetKey,
            createdAt: new Date().toISOString()
          })
        );

        // Do NOT expose session tokens in legacy signup response
        return withCors(Response.json({ resetKey }), request);
      }

      if (pathname === '/api/login' && request.method === 'POST') {
        const { username, password } = await json();
        const userKey = getUserKey(username);
        const data = await env.LOGS_KV.get(userKey);
        if (!data) {
          return withCors(new Response('User not found', { status: 404 }), request);
        }

        const user = JSON.parse(data);
        const hashedPassword = await hashPassword(password);

        // Auto-upgrade from plaintext if needed
        if (user.password === password) {
          user.password = hashedPassword;
          await env.LOGS_KV.put(userKey, JSON.stringify(user));
        }

        if (user.password !== hashedPassword) {
          return withCors(new Response('Invalid password', { status: 403 }), request);
        }

        // Do NOT expose session tokens in legacy login response
        return withCors(Response.json({ success: true }), request);
      }

      if (pathname === '/api/change-password' && request.method === 'POST') {
        const { username, currentPassword, newPassword } = await json();
        const userKey = getUserKey(username);
        const data = await env.LOGS_KV.get(userKey);
        if (!data) {
          return withCors(new Response('User not found', { status: 404 }), request);
        }

        const user = JSON.parse(data);
        const token = request.headers.get('Authorization');
        const hashedCurrent = await hashPassword(currentPassword);
        const usernameFromToken = token ? await getUsernameFromToken(env, token) : null;

        if (
          usernameFromToken !== username ||
          (user.password !== currentPassword && user.password !== hashedCurrent)
        ) {
          return withCors(new Response('Unauthorized', { status: 403 }), request);
        }

        user.password = await hashPassword(newPassword);
        await env.LOGS_KV.put(userKey, JSON.stringify(user));
        return withCors(new Response('Password changed'), request);
      }

      if (pathname === '/api/reset-password' && request.method === 'POST') {
        const { username, resetKey, newPassword } = await json();
        const userKey = getUserKey(username);
        const data = await env.LOGS_KV.get(userKey);
        if (!data) return withCors(new Response('User not found', { status: 404 }), request);
        const user = JSON.parse(data);
        if (user.resetKey !== resetKey)
          return withCors(new Response('Invalid reset key', { status: 403 }), request);
        user.password = await hashPassword(newPassword);
        await env.LOGS_KV.put(userKey, JSON.stringify(user));
        return withCors(new Response('Password reset'), request);
      }

      if (pathname === '/api/delete-account' && request.method === 'POST') {
        const { username, password } = await json();
        const userKey = getUserKey(username);
        const data = await env.LOGS_KV.get(userKey);
        if (!data) return withCors(new Response('User not found', { status: 404 }), request);
        const user = JSON.parse(data);
        const token = request.headers.get('Authorization');
        const usernameFromToken = token ? await getUsernameFromToken(env, token) : null;
        const hashedPassword = await hashPassword(password);

        if (usernameFromToken !== username || user.password !== hashedPassword) {
          return withCors(new Response('Unauthorized', { status: 403 }), request);
        }

        await env.LOGS_KV.delete(userKey);
        // Remove per-user logs keyed by username (do not use token as storage key)
        await env.LOGS_KV.delete(`logs:${username}`);
        return withCors(new Response('Account deleted'), request);
      }

      // Get subscription status - FIXED SYNTAX
      if (pathname === '/api/subscription' && request.method === 'GET') {
        const token = request.headers.get('Authorization');
        if (!token) return withCors(new Response('Missing token', { status: 401 }), request);

        // Get username from token
        const username = await getUsernameFromToken(env, token);

        // Check if this is James (Pro user for testing)
        if (username && (username.toLowerCase() === 'james' || username.toLowerCase() === 'jam')) {
          return withCors(
            Response.json({
              plan: 'pro',
              status: 'active',
              tripsThisMonth: 50,
              maxTrips: -1, // unlimited
              features: ['export', 'analytics', 'cloud-sync', 'enhanced-analytics']
            }),
            request
          );
        }

        // Get user data to check subscription - key by username (do not rely on token as a storage key)
        const userData = username ? await env.LOGS_KV.get(`subscription:${username}`) : null;
        if (!userData) {
          // Default to free plan if no subscription data
          return withCors(
            Response.json({
              plan: 'free',
              status: 'active',
              tripsThisMonth: 0,
              maxTrips: 10,
              features: []
            }),
            request
          );
        }

        const subscription = JSON.parse(userData);
        return withCors(Response.json(subscription), request);
      }

      if (pathname === '/logs' && request.method === 'GET') {
        const token = request.headers.get('Authorization');
        if (!token) return withCors(new Response('Missing token', { status: 401 }), request);
        const username = await getUsernameFromToken(env, token);
        if (!username) return withCors(new Response('Unauthorized', { status: 401 }), request);
        const logs = await env.LOGS_KV.get(`logs:${username}`);
        return withCors(
          new Response(logs || '[]', {
            headers: { 'Content-Type': 'application/json' }
          }),
          request
        );
      }

      if (pathname === '/logs' && request.method === 'POST') {
        const token = request.headers.get('Authorization');
        if (!token) return withCors(new Response('Missing token', { status: 401 }), request);
        const username = await getUsernameFromToken(env, token);
        if (!username) return withCors(new Response('Unauthorized', { status: 401 }), request);
        const body = await request.text();
        await env.LOGS_KV.put(`logs:${username}`, body);
        return withCors(new Response('Logs saved'), request);
      }

      if (pathname === '/categories' && request.method === 'GET') {
        const token = request.headers.get('Authorization');
        if (!token) return withCors(new Response('Missing token', { status: 401 }), request);
        const username = await getUsernameFromToken(env, token);
        if (!username) return withCors(new Response('Unauthorized', { status: 401 }), request);
        const categories = await env.LOGS_KV.get(`categories:${username}`);
        return withCors(
          new Response(categories || '{"maintenance":[],"supplies":[]}', {
            headers: { 'Content-Type': 'application/json' }
          }),
          request
        );
      }

      if (pathname === '/categories' && request.method === 'POST') {
        const token = request.headers.get('Authorization');
        if (!token) return withCors(new Response('Missing token', { status: 401 }), request);
        const username = await getUsernameFromToken(env, token);
        if (!username) return withCors(new Response('Unauthorized', { status: 401 }), request);
        const body = await request.text();
        await env.LOGS_KV.put(`categories:${username}`, body);
        return withCors(new Response('Categories saved'), request);
      }

      if (pathname === '/' || pathname === '/index.html') {
        const html = await env.ASSETS.get('index.html');
        if (!html) return new Response('index.html not found', { status: 404 });

        const resp = new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });

        resp.headers.delete('Cross-Origin-Opener-Policy');
        resp.headers.delete('Cross-Origin-Embedder-Policy');

        return withCors(resp, request);
      }

      if (pathname === '/admin/users' && request.method === 'GET') {
        if (url.searchParams.get('adminToken') !== env.ADMIN_TOKEN) {
          return new Response('Unauthorized', { status: 403 });
        }
        const list = await env.LOGS_KV.list({ prefix: 'user:' });
        const users = list.keys.map((k) => k.name.replace(/^user:/, ''));

        const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Admin Panel - Go Route Yourself</title>
    <style>
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background-color: #f4f6f9;
    margin: 0;
    padding: 20px;
    box-sizing: border-box;
  }

  h1 {
    text-align: center;
    color: #333;
    margin-bottom: 20px;
    font-size: 22px;
  }

  .table-wrapper {
    max-width: 600px;
    margin: 0 auto;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    box-shadow: 0 2px 10px rgba(0,0,0,0.05);
    border-radius: 8px;
    overflow: hidden;
    min-width: 400px;
  }

  th, td {
    padding: 12px 14px;
    text-align: left;
    white-space: nowrap;
  }

  th {
    background-color: #007bff;
    color: white;
    font-weight: 600;
  }

  tr:nth-child(even) {
    background-color: #f9f9f9;
  }

  td button {
    margin: 4px 4px 4px 0;
    padding: 6px 10px;
    font-size: 14px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    color: white;
    display: inline-block;
  }

  button.danger {
    background-color: #dc3545;
  }

  button.danger:hover {
    background-color: #a71d2a;
  }

  button.reset {
    background-color: #17a2b8;
  }

  button.reset:hover {
    background-color: #117a8b;
  }

  footer {
    text-align: center;
    margin-top: 40px;
    font-size: 14px;
    color: #666;
  }
</style>
  </head>
  <body>
    <h1>⚙ Admin Panel – Registered Users</h1>
    <div class="table-wrapper">
      <table>
        <tr><th>Username</th><th>Actions</th></tr>
        ${users
          .map(
            (user) => `
          <tr>
            <td>${user}</td>
            <td>
              <button class="danger" onclick="deleteUser('${user}')">Delete</button>
              <button class="reset" onclick="resetUser('${user}')">Reset Password</button>
            </td>
          </tr>
        `
          )
          .join('')}
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
</html>
`;

        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (pathname === '/admin/users' && request.method === 'POST') {
        if (url.searchParams.get('adminToken') !== env.ADMIN_TOKEN) {
          return new Response('Unauthorized', { status: 403 });
        }

        const { action, username, tempPassword } = await json();
        const userKey = `user:${username}`;
        const userData = await env.LOGS_KV.get(userKey);
        if (!userData) return new Response('User not found', { status: 404 });

        const user = JSON.parse(userData);

        if (action === 'delete') {
          await env.LOGS_KV.delete(userKey);
          // Delete per-user logs keyed by username (do not use token as storage key)
          await env.LOGS_KV.delete(`logs:${username}`);
          return new Response('✓ User deleted');
        }

        if (action === 'reset-password' && tempPassword) {
          user.password = await hashPassword(tempPassword);
          await env.LOGS_KV.put(userKey, JSON.stringify(user));
          return new Response('✓ Password reset');
        }

        return new Response('✗ Invalid action', { status: 400 });
      }

      if (pathname === '/favicon.ico') {
        const favicon = await env.ASSETS.get('180x75.avif', { type: 'stream' });
        if (!favicon) return new Response('favicon not found', { status: 404 });

        const resp = new Response(favicon.body, favicon);
        resp.headers.set('Content-Type', 'image/avif');
      }

      // Generic static asset handler
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
          xml: 'application/xml'
        };

        const resp = new Response(asset.body, {
          headers: {
            'Content-Type': contentTypes[ext] || 'application/octet-stream'
          }
        });
        return withCors(resp, request);
      }

      return withCors(new Response('Not found', { status: 404 }), request);
    } catch (err) {
      console.error('Worker error:', err);
      return withCors(
        Response.json({ error: 'Internal Server Error', details: err.message }, { status: 500 }),
        request
      );
    }
  }
};
