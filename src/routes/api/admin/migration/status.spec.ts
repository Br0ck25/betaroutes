import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockUsersKV: any;
let mockLogsKV: any;
let mockExpensesKV: any;
let mockMileageKV: any;
let mockTrashKV: any;
let mockMigrationsKV: any;

vi.mock('$lib/server/env', () => ({
	getEnv: () => ({}),
	safeKV: (_env: any, name: string) => {
		void _env;
		if (name === 'BETA_USERS_KV') return mockUsersKV;
		if (name === 'BETA_LOGS_KV') return mockLogsKV;
		if (name === 'BETA_EXPENSES_KV') return mockExpensesKV;
		if (name === 'BETA_MILLAGE_KV') return mockMileageKV;
		if (name === 'BETA_TRASH_KV') return mockTrashKV;
		if (name === 'BETA_MIGRATIONS_KV') return mockMigrationsKV;
		return undefined;
	}
}));

vi.mock('$lib/server/userService', () => ({
	findUserByUsername: async (_kv: any, username: string) => {
		if (username === 'exists') return { id: 'user-1234', username: 'exists' };
		return null;
	}
}));

describe('POST /api/admin/migration/status', () => {
	beforeEach(() => {
		mockUsersKV = {
			get: vi.fn(async (k: string) => {
				if (k === 'a' || k === 'user:a')
					return JSON.stringify({ id: 'a', username: 'admin', role: 'admin' });
				return null;
			})
		};
		mockLogsKV = {
			list: vi.fn(async ({ prefix }: any) => {
				if (prefix === 'trip:exists:')
					return { keys: [{ name: 'trip:exists:1' }], list_complete: true };
				return { keys: [], list_complete: true };
			})
		};
		mockExpensesKV = { list: vi.fn(async () => ({ keys: [], list_complete: true })) };
		mockMileageKV = { list: vi.fn(async () => ({ keys: [], list_complete: true })) };
		mockTrashKV = {
			list: vi.fn(async () => ({ keys: [{ name: 'trash:1' }], list_complete: true })),
			get: vi.fn(async (_name: string) => {
				void _name;
				return JSON.stringify({ userId: 'exists' });
			})
		};
		mockMigrationsKV = { get: vi.fn(async () => null) };
	});

	it('returns 403 when not admin', async () => {
		const event: any = {
			request: { json: async () => ({ users: ['exists'] }) },
			locals: {},
			platform: {}
		};

		// dynamic import
		const { POST } = await import('./status/+server');
		const res = await POST(event as any);
		expect(res.status).toBe(403);
	});

	it('returns 400 when no users', async () => {
		const event: any = {
			request: { json: async () => ({}) },
			locals: { user: { id: 'a', role: 'admin' } },
			platform: {}
		};

		// dynamic import
		const { POST } = await import('./status/+server');
		const res = await POST(event as any);
		expect(res.status).toBe(400);
	});

	it('resolves username and returns counts + migration state', async () => {
		const body = { users: ['exists'] };
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'a', role: 'admin' } },
			platform: {}
		};

		// dynamic import
		const { POST } = await import('./status/+server');
		const res = await POST(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.success).toBe(true);
		expect(json.results.exists).toHaveProperty('trip_legacy');
		expect(json.results.exists).toHaveProperty('trash_legacy');
	});

	it('accepts UUID and returns cursor/migration state when present', async () => {
		const uuid = '11111111-1111-4111-8111-111111111111';
		mockMigrationsKV.get = vi.fn(async (k: string) => {
			if (k === `migration:${uuid}:state`) return JSON.stringify({ lastRun: 'now' });
			return null;
		});

		const body = { users: [uuid] };
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'a', role: 'admin' } },
			platform: {}
		};

		// dynamic import
		const { POST } = await import('./status/+server');
		const res = await POST(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.success).toBe(true);
		expect(json.results[uuid]).toHaveProperty('migrationState');
	});
});
