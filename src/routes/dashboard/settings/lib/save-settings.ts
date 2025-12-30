import { get } from 'svelte/store';
import { userSettings } from '$lib/stores/userSettings';

export type SaveResult = { ok: true; data: any } | { ok: false; error: string };

export async function saveSettings(payload: Partial<Record<string, any>>): Promise<SaveResult> {
	// Optimistically update local store
	userSettings.update((s) => ({ ...s, ...payload }));

	try {
		const res = await fetch('/api/settings', {
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
	} catch (err: any) {
		// Revert not implemented (optimistic), but propagate error to caller
		return { ok: false, error: err?.message || String(err) };
	}
}
