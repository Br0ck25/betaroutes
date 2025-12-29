// src/routes/dashboard/+layout.ts
export const prerender = false;
export const ssr = true;
// Enforce trailing slashes to prevent Cloudflare redirect loops
export const trailingSlash = 'always';
