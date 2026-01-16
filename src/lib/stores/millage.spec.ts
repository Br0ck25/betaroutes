import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDB, clearDatabase } from '$lib/db/indexedDB';
import { millage } from './millage';

describe('Millage store (IndexedDB)', () => {
	beforeEach(async () => {
		await clearDatabase();
	});

	it('creates a millage record without throwing', async () => {
		const userId = 'test-user';
		const data = { startOdometer: 100, endOdometer: 150 };

		const record = await millage.create(data, userId as any);

		expect(record).toHaveProperty('id');
		expect(record.userId).toBe(userId);
		expect(record.miles).toBe(50);

		const db = await getDB();
		const tx = db.transaction('millage', 'readonly');
		const stored = await tx.objectStore('millage').get(record.id);
		await tx.done;

		expect(stored).toBeTruthy();
		expect(stored.userId).toBe(userId);
	});
});
