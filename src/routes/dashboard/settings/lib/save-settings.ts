import { get } from 'svelte/store';
import { userSettings } from '$lib/stores/userSettings';
import { csrfFetch } from '$lib/utils/csrf';

export type SaveResult = { ok: true; data: unknown } | { ok: false; error: string };

export async function saveSettings(payload: Partial<Record<string, unknown>>): Promise<SaveResult> {
	// Optimistically update local store
	userSettings.update((s) => ({ ...s, ...payload }));

	try {
		const res = await csrfFetch('/api/settings', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ settings: payload })
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(text || `Save failed: ${res.status}`);
		}

		const json = await res.json().catch(() => ({}));

		// Ensure we have an object before merging to avoid spread errors
		const safeJson = typeof json === 'object' && json ? json : {};
		const current = get(userSettings);
		userSettings.set({ ...current, ...safeJson });

		return { ok: true, data: json };
	} catch (err: unknown) {
		// Revert not implemented (optimistic), but propagate error to caller
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}
