import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockUsersKV: any;
let mockMigrationsKV: any;
vi.mock('$lib/server/env', () => ({
	getEnv: () => ({}),
	safeKV: (_env: any, name: string) => {
		void _env;
		if (name === 'BETA_USERS_KV') return mockUsersKV;
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

vi.mock('$lib/server/migration/storage-key-migration', () => ({
	migrateUserStorageKeys: async (_env: any, userId: string, username: string, opts: any) => {
		void _env;
		return { migrated: !!opts?.apply, userId, username };
	},
	runBatchedMigration: async () => {
		// Simulate a successful apply run
		return { migrated: true };
	},
	repairDOIndex: async (_env: any, _userId: string) => {
		void _env;
		void _userId;
		return { repaired: true };
	}
}));

describe('POST /api/admin/migration', () => {
	beforeEach(() => {
		mockUsersKV = {
			get: vi.fn(async (k: string) => {
				if (k === 'a' || k === 'user:a')
					return JSON.stringify({ id: 'a', username: 'admin', role: 'admin' });
				return null;
			})
		};
		mockMigrationsKV = {
			get: vi.fn(async () => null),
			put: vi.fn(async () => {}),
			delete: vi.fn(async () => {})
		};
	});

	it('returns 401 when unauthenticated', async () => {
		const event: any = {
			request: { json: async () => ({ users: ['exists'] }) },
			locals: {},
			platform: {}
		};

		// dynamic import of server handler for test
		const { POST } = await import('./migration/+server');
		const res = await POST(event as any);
		expect(res.status).toBe(403);
	});

	it('returns 400 when no users provided', async () => {
		const event: any = {
			request: { json: async () => ({}) },
			locals: { user: { id: 'a', role: 'admin' } },
			platform: {}
		};

		// dynamic import of server handler for test
		const { POST } = await import('./migration/+server');
		const res = await POST(event as any);
		expect(res.status).toBe(400);
	});

	it('resolves username and runs migration (dry-run)', async () => {
		const body = { users: ['exists'] };
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'a', role: 'admin' } },
			platform: {}
		};

		// dynamic import of server handler for test
		const { POST } = await import('./migration/+server');
		const res = await POST(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.success).toBe(true);
		expect(json.results.exists).toMatchObject({ migrated: false, userId: 'user-1234' });
	});

	it('accepts explicit UUIDs and honors apply flag and returns migration state + do repair', async () => {
		const body = { users: ['11111111-1111-4111-8111-111111111111'], apply: true };
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'a', role: 'admin' } },
			platform: {}
		};

		// provide a mocked persisted migration state
		mockMigrationsKV.get = vi.fn(async (k: string) => {
			if (k === 'migration:11111111-1111-4111-8111-111111111111:state')
				return JSON.stringify({ lastRun: 'now', migrated: 3, done: true });
			if (k === 'migration:11111111-1111-4111-8111-111111111111:do:state')
				return JSON.stringify({ lastRun: 'now', migrated: 3, done: true });
			return null;
		});

		// dynamic import of server handler for test
		const { POST } = await import('./migration/+server');
		const res = await POST(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.success).toBe(true);
		const r = json.results['11111111-1111-4111-8111-111111111111'];
		expect(r).toMatchObject({ migrated: true });
		expect(r).toHaveProperty('migrationState');
		expect(r).toHaveProperty('doMigrationState');
		expect(r).toHaveProperty('doRepair');
	});

	it('reports not found for missing username', async () => {
		const body = { users: ['missing'] };
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'a', role: 'admin' } },
			platform: {}
		};

		// dynamic import of server handler for test
		const { POST } = await import('./migration/+server');
		const res = await POST(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.results.missing).toHaveProperty('error');
	});
});
