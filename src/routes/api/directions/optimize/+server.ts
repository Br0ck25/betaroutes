// src/routes/api/directions/optimize/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

import {
  checkRateLimitEnhanced,
  createRateLimitHeaders,
  getClientIdentifier
} from '$lib/server/rateLimit';

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null;
}

/**
 * Helper: Server geocoding is handled via Google (geocode helper) — Photon removed.
 */

/**
 * Helper: Generate a unique key for the set of stops to cache the optimization result
 */
function generateOptimizationKey(start: string, end: string, stops: string[]): string {
  // Sort stops to ensure A,B,C generates same key as C,B,A if the set is the same
  // (Though technically order matters for the INPUT, usually we want to cache the RESULT for this specific request)
  // Actually, for optimization, the input order matters less than the SET of addresses.
  // However, to be safe, let's hash the specific input request.
  const combined = [start, end, ...stops]
    .filter(Boolean)
    .join('|')
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, '');
  // Simple hash to keep key short
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `opt:${hash}`;
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  // 1. Security Check
  if (!locals.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  // [!code fix] SECURITY: Rate limit expensive route optimization (10/min per user)
  const { getEnv, safeKV } = await import('$lib/server/env');
  const env = getEnv(platform);
  const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
  if (sessionsKV) {
    const identifier = getClientIdentifier(request, locals);
    const rateLimitResult = await checkRateLimitEnhanced(
      sessionsKV,
      identifier,
      'directions_optimize',
      10, // 10 requests per minute (expensive operation)
      60000
    );

    const headers = createRateLimitHeaders(rateLimitResult);

    if (!rateLimitResult.allowed) {
      log.warn('[DirectionsOptimize] Rate limit exceeded', { identifier });
      return json(
        {
          error: 'Too many optimization requests. Please try again later.',
          resetAt: rateLimitResult.resetAt
        },
        { status: 429, headers }
      );
    }
  }

  const body: unknown = await request.json();
  if (!isRecord(body)) return json({ error: 'Invalid request' }, { status: 400 });
  const startAddress = typeof body['startAddress'] === 'string' ? body['startAddress'] : '';
  const endAddress = typeof body['endAddress'] === 'string' ? body['endAddress'] : undefined;
  const rawStops = Array.isArray(body['stops']) ? body['stops'] : [];
  // Validate stops and cap length (Google limits waypoints; cap conservatively)
  const MAX_STOPS = 20;
  const stops: string[] = rawStops
    .map((s) => (isRecord(s) && typeof s['address'] === 'string' ? s['address'].trim() : undefined))
    .filter(Boolean)
    .slice(0, MAX_STOPS) as string[];

  if (!startAddress || stops.length < 2) {
    return json({ error: 'Not enough data to optimize' }, { status: 400 });
  }

  const kv = safeKV(env, 'BETA_DIRECTIONS_KV');
  const apiKey =
    typeof env['PRIVATE_GOOGLE_MAPS_API_KEY'] === 'string'
      ? env['PRIVATE_GOOGLE_MAPS_API_KEY']
      : undefined;
  const userId =
    isRecord(locals.user) && typeof locals.user['id'] === 'string' ? locals.user['id'] : undefined;
  if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
  const cacheKey = `user:${userId}:${generateOptimizationKey(startAddress, endAddress || '', stops)}`;

  // 3. Check KV Cache
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (typeof cached === 'string') {
      try {
        const parsed = JSON.parse(cached);
        if (isRecord(parsed)) return json(parsed);
      } catch {
        // ignore corrupt
      }
    }
  }

  // Prepare Addresses
  const stopAddresses = stops;
  const allAddresses = [startAddress, ...stopAddresses];
  if (endAddress) allAddresses.push(endAddress);

  // 4. OSRM removed: Use Google Directions 'optimize:true' (Server-side) with KV caching.
  // The Google fallback below handles optimization and caching.

  // 5. Google Fallback (Server-Side)
  if (!apiKey) {
    return json({ error: 'Optimization service unavailable' }, { status: 500 });
  }

  try {
    const origin = startAddress;
    let destination = endAddress;
    // Make a copy of stops to modify if needed
    const waypointsList = [...stopAddresses];

    // Google requires a destination. If none provided, the last stop becomes the destination.
    // We replicate the logic used in the client: pop the last stop.
    if (!destination && waypointsList.length > 0) {
      destination = waypointsList.pop();
    }

    const waypointsStr = waypointsList.map((w: string) => encodeURIComponent(w)).join('|');
    const gUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination || '')}&waypoints=optimize:true|${waypointsStr}&key=${apiKey}`;

    const gRes = await fetch(gUrl);
    const gData: unknown = await gRes.json();

    if (
      isRecord(gData) &&
      gData['status'] === 'OK' &&
      Array.isArray(gData['routes']) &&
      gData['routes'].length > 0 &&
      isRecord(gData['routes'][0])
    ) {
      const route = gData['routes'][0] as Record<string, unknown>;
      const optimizedOrder = Array.isArray(route['waypoint_order'])
        ? (route['waypoint_order'] as unknown[])
            .filter((n) => typeof n === 'number')
            .map((n) => Number(n))
        : undefined;
      const legs = Array.isArray(route['legs']) ? (route['legs'] as unknown[]) : undefined;

      if (!Array.isArray(optimizedOrder) || !Array.isArray(legs)) {
        return json({ error: 'Invalid response from Google' }, { status: 502 });
      }

      const result = {
        source: 'google',
        optimizedOrder: optimizedOrder as number[],
        legs: legs
      };

      if (kv) await kv.put(cacheKey, JSON.stringify(result));
      return json(result);
    }

    return json(
      {
        error:
          isRecord(gData) && typeof gData['status'] === 'string' ? gData['status'] : 'Bad response'
      },
      { status: 400 }
    );
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log.error('Google Optimization Error', { message: errMsg });
    return json({ error: 'Optimization failed' }, { status: 500 });
  }
};
