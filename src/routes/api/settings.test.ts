import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { POST, GET } from './settings/+server';

describe('API: /api/settings', () => {
	let platform: { env: Record<string, unknown> };
	beforeEach(() => {
		const event: { platform: { env: Record<string, unknown> } } = { platform: { env: {} } };
		setupMockKV(event as any);
		platform = event.platform;
	});

	it('saves settings to BETA_USER_SETTINGS_KV for authenticated user', async () => {
		const user = { id: 'testuser' } as any;

		const body = { settings: { defaultMPG: 33.5, expenseCategories: ['fuel', 'parts'] } };
		const request = new Request('https://example.test/api/settings', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		const res = await POST({ request, locals: { user }, platform } as any);
		const json = (await res.json()) as any;
		expect(res.status).toBe(200);
		expect(json.defaultMPG).toBe(33.5);
		expect(json.expenseCategories).toEqual(['fuel', 'parts']);

		// Ensure KV has the entry
		const kv = platform.env['BETA_USER_SETTINGS_KV'] as any;
		const raw = await kv.get(`settings:${user.id}`);
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw);
		expect(parsed.defaultMPG).toBe(33.5);
	});

	it('reads settings from BETA_USER_SETTINGS_KV for authenticated user', async () => {
		const user = { id: 'reader' } as any;
		const kv = platform.env['BETA_USER_SETTINGS_KV'] as any;
		await kv.put(`settings:${user.id}`, JSON.stringify({ defaultGasPrice: 2.99 }));

		const request = new Request('https://example.test/api/settings');
		const res = await GET({ request, locals: { user }, platform } as any);
		const json = (await res.json()) as any;
		expect(json.defaultGasPrice).toBe(2.99);
	});
});
