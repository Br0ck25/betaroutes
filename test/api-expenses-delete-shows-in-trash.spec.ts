import { setupMockKV } from '$lib/server/dev-mock-db';
import { DELETE as deleteExpense } from '$routes/api/expenses/[id]/+server';
import { GET as listTrash } from '$routes/api/trash/+server';

describe('Expense delete should appear in cloud trash', () => {
	it('DELETE /api/expenses/:id writes tombstone visible via /api/trash', async () => {
		const event: any = {
			platform: {},
			locals: { user: { name: 'test_user' } },
			params: { id: 'exp-1' }
		};
		setupMockKV(event);

		// Put an initial expense in the expenses KV so svc.get can find it
		const kv = event.platform.env['BETA_EXPENSES_KV'] as any;
		const expense = {
			id: 'exp-1',
			userId: 'test_user',
			amount: 12.34,
			category: 'food',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
		await kv.put(`expense:test_user:exp-1`, JSON.stringify(expense));

		// Delete via API
		const res = await deleteExpense(event as any);
		expect(res.status).toBe(200);

		// Now list trash
		const listEvent: any = {
			platform: event.platform,
			locals: { user: { name: 'test_user' } },
			url: new URL('https://example.test/api/trash?type=expenses')
		};
		const listRes = await listTrash(listEvent as any);
		const body = JSON.parse(await listRes.text());
		expect(Array.isArray(body)).toBe(true);
		expect(body.some((i: any) => i.id === 'exp-1')).toBe(true);
	});
});
