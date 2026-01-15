<script lang="ts">
	import { millage } from '$lib/stores/millage';
	import { user } from '$lib/stores/auth';
	import { toasts } from '$lib/stores/toast';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	let id = '';
	let form: any = { date: '', startOdometer: '', endOdometer: '', miles: '', notes: '' };

	onMount(async () => {
		const pid = $page.params.id;
		if (!pid) {
			toasts.error('Invalid ID');
			goto('/dashboard/millage');
			return;
		}
		id = String(pid);
		const currentUser = $page.data['user'] || $user;
		const userId =
			currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
		if (!userId) return;
		const rec = await millage.get(id, userId);
		if (!rec) {
			toasts.error('Record not found');
			goto('/dashboard/millage');
			return;
		}
		form = { ...rec };
	});

	function computeMiles() {
		if (form.startOdometer !== '' && form.endOdometer !== '') {
			form.miles = Number(form.endOdometer) - Number(form.startOdometer);
		}
	}

	async function save() {
		const currentUser = $page.data['user'] || $user;
		const userId =
			currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
		if (!userId) return;
		try {
			await millage.updateMillage(
				id,
				{
					date: form.date,
					startOdometer: Number(form.startOdometer),
					endOdometer: Number(form.endOdometer),
					miles: Number(form.miles),
					notes: form.notes
				},
				userId
			);
			toasts.success('Saved');
			goto('/dashboard/millage');
		} catch (err) {
			console.error(err);
			toasts.error('Failed to save');
		}
	}

	async function remove() {
		if (!confirm('Move this log to trash?')) return;
		const currentUser = $page.data['user'] || $user;
		const userId =
			currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
		if (!userId) return;
		await millage.deleteMillage(id, userId);
		toasts.success('Moved to trash');
		goto('/dashboard/millage');
	}
</script>

<div class="expense-form-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Edit Millage Log</h1>
			<p class="page-subtitle">Update odometer readings</p>
		</div>
		<a href="/dashboard/millage" class="btn-back">Back</a>
	</div>

	<div class="form-card">
		<div class="card-header">
			<h2 class="card-title">Details</h2>
		</div>

		<div class="form-grid">
			<div class="form-group">
				<label for="millage-date">Date</label>
				<input id="millage-date" type="date" bind:value={form.date} />
			</div>

			<div class="form-group">
				<label for="start-odo">Start Odometer</label>
				<input
					id="start-odo"
					type="number"
					bind:value={form.startOdometer}
					oninput={computeMiles}
				/>
			</div>

			<div class="form-group">
				<label for="end-odo">End Odometer</label>
				<input id="end-odo" type="number" bind:value={form.endOdometer} oninput={computeMiles} />
			</div>

			<div class="form-group">
				<label for="miles">Miles</label>
				<input id="miles" type="number" bind:value={form.miles} />
				<small>You can edit calculated miles</small>
			</div>

			<div class="form-group">
				<label for="notes">Notes</label>
				<input id="notes" type="text" bind:value={form.notes} />
			</div>
		</div>

		<div class="form-actions">
			<a href="/dashboard/millage" class="btn-secondary">Cancel</a>
			<button class="btn-neutral" onclick={remove}>Delete</button>
			<button class="btn-primary" onclick={save}>Save Log</button>
		</div>
	</div>
</div>
