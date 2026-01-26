// src/lib/server/PlacesIndexDO.ts

import { log } from '$lib/server/log';

export class PlacesIndexDO {
	state: DurableObjectState;
	env: { BETA_PLACES_KV?: KVNamespace };

	constructor(state: DurableObjectState, env: { BETA_PLACES_KV?: KVNamespace }) {
		this.state = state;
		this.env = env;

		// 1. Initialize SQLite Schema
		this.state.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS places (
                address TEXT PRIMARY KEY,
                created_at INTEGER
            );
        `);

		// 2. Migration Logic (Legacy KV List -> SQLite)
		// Ensures we don't lose data during the deployment transition
		this.state.blockConcurrencyWhile(async () => {
			const list = await this.state.storage.get<string[]>('list');
			if (list && Array.isArray(list) && list.length > 0) {
				// Insert each item directly (avoid using .prepare which may not exist on SqlStorage)
				// Preserve existing order by assigning incremental timestamps
				const baseTime = Date.now() - list.length * 1000;
				for (let i = 0; i < list.length; i++) {
					this.state.storage.sql.exec(
						'INSERT OR IGNORE INTO places (address, created_at) VALUES (?, ?)',
						list[i],
						baseTime + i * 1000
					);
				}

				// Cleanup legacy storage
				await this.state.storage.delete('list');
			}
		});
		// Helper moved to class method (kept here during refactor)
	}

	private async recordAddressInternal(addr: string) {
		try {
			this.state.storage.sql.exec(
				'INSERT OR REPLACE INTO places (address, created_at) VALUES (?, ?)',
				addr,
				Date.now()
			);
			const countRes = this.state.storage.sql.exec('SELECT COUNT(*) as total FROM places');
			const result = countRes.one() as { total: number };
			if (result.total > 50) {
				const toDelete = result.total - 50;
				this.state.storage.sql.exec(
					`
					DELETE FROM places 
					WHERE address IN (
						SELECT address FROM places ORDER BY created_at ASC LIMIT ?
					)
					`,
					toDelete
				);
			}
		} catch (e) {
			log.warn('[PlacesIndexDO] recordAddressInternal failed', e);
		}
	}

	async fetch(request: Request) {
		const url = new URL(request.url);

		// Atomic Add Operation
		if (request.method === 'POST' && url.pathname === '/add') {
			try {
				const { address } = (await request.json()) as { address?: string };
				if (!address) return new Response('Missing address', { status: 400 });

				// Check if address already exists (Read optimized)
				const existing = this.state.storage.sql
					.exec('SELECT 1 FROM places WHERE address = ?', address)
					.toArray();

				// Only proceed if it's a new address
				if (existing.length === 0) {
					// 1. Insert new address with current timestamp
					this.state.storage.sql.exec(
						'INSERT INTO places (address, created_at) VALUES (?, ?)',
						address,
						Date.now()
					);

					// 2. Prune if list exceeds 50 items (FIFO)
					const countRes = this.state.storage.sql.exec('SELECT COUNT(*) as total FROM places');
					const result = countRes.one() as { total: number };

					if (result.total > 50) {
						const toDelete = result.total - 50;
						// Delete the oldest records
						this.state.storage.sql.exec(
							`
							DELETE FROM places 
							WHERE address IN (
								SELECT address FROM places ORDER BY created_at ASC LIMIT ?
							)
							`,
							toDelete
						);
					}

					// 3. Write-Through to KV for fast reads
					// Fetch the updated list (ordered by creation time to match array behavior)
					const cursor = this.state.storage.sql.exec(
						'SELECT address FROM places ORDER BY created_at ASC'
					);
					const list: string[] = [];
					for (const row of cursor) {
						list.push(((row as Record<string, unknown>)['address'] as string) ?? '');
					}

					const kv = this.env.BETA_PLACES_KV as KVNamespace;
					const key = url.searchParams.get('key');
					if (kv && key) {
						await kv.put(key, JSON.stringify(list));
					}
				}

				return new Response('OK');
			} catch (err) {
				log.error('[PlacesIndexDO] Error:', err);
				return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
			}
		}

		// POST /record - record an address into DO (recent list)
		if (request.method === 'POST' && url.pathname === '/record') {
			try {
				const { address } = (await request.json()) as { address?: string };
				if (!address) return new Response('Missing address', { status: 400 });
				await this.recordAddressInternal(address);
				return new Response('OK');
			} catch (err) {
				log.error('[PlacesIndexDO] /record failed', err);
				return new Response('Error', { status: 500 });
			}
		}

		// Geocode cache: GET /geocode?address=... and POST /geocode body { address, lat, lon, formattedAddress }
		if (url.pathname === '/geocode') {
			const kv = this.env.BETA_PLACES_KV;

			if (request.method === 'GET') {
				try {
					const addr = url.searchParams.get('address') || '';
					if (!addr) return new Response('Missing address', { status: 400 });
					const key = `geo:${addr
						.toLowerCase()
						.trim()
						.replace(/[^a-z0-9]/g, '_')}`;
					// Check Places KV first, then fallback to Directions KV
					const placesKV = this.env.BETA_PLACES_KV as KVNamespace | undefined;
					const directionsKV = (this.env as unknown as Record<string, unknown>)[
						'BETA_DIRECTIONS_KV'
					] as KVNamespace | undefined;
					let raw: string | null = null;
					if (placesKV) raw = await placesKV.get(key);
					if (!raw && directionsKV) raw = await directionsKV.get(key);
					if (!raw) return new Response('Not Found', { status: 404 });
					return new Response(raw, {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				} catch (e) {
					log.warn('[PlacesIndexDO] geocode GET failed', e);
					return new Response('Error', { status: 500 });
				}
			}
			if (request.method === 'POST') {
				try {
					const body = (await request.json()) as {
						address?: string;
						lat?: number;
						lon?: number;
						formattedAddress?: string;
					};
					if (!body || !body.address || body.lat == null || body.lon == null)
						return new Response('Invalid body', { status: 400 });

					const key = `geo:${body.address
						.toLowerCase()
						.trim()
						.replace(/[^a-z0-9]/g, '_')}`;
					if (kv) {
						await kv.put(
							key,
							JSON.stringify({
								lat: body.lat,
								lon: body.lon,
								formattedAddress: body.formattedAddress
							})
						);
					}

					return new Response('OK');
				} catch (e) {
					log.warn('[PlacesIndexDO] geocode POST failed', e);
					return new Response('Error', { status: 500 });
				}
			}
		}

		// GET /list - Returns the recent list maintained by the DO (for debugging)
		if (request.method === 'GET' && url.pathname === '/list') {
			try {
				const cursor = this.state.storage.sql.exec(
					'SELECT address FROM places ORDER BY created_at ASC'
				);
				const list: string[] = [];
				for (const row of cursor) {
					list.push(((row as Record<string, unknown>)['address'] as string) ?? '');
				}
				return new Response(JSON.stringify(list), {
					headers: { 'Content-Type': 'application/json' }
				});
			} catch (e) {
				log.warn('[PlacesIndexDO] list failed', e);
				return new Response('Error', { status: 500 });
			}
		}

		return new Response('Not Found', { status: 404 });
	}
}
