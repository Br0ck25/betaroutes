<script lang="ts">
	import { millage } from '$lib/stores/millage';
	import { user } from '$lib/stores/auth';
	import { userSettings } from '$lib/stores/userSettings';
	import { toasts } from '$lib/stores/toast';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	// derived helper for vehicles
	$: vehicles = ($userSettings as any).vehicles || [];

	function getLocalDate() {
		const now = new Date();
		return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
	}

	let form = {
		date: getLocalDate(),
		startOdometer: '',
		endOdometer: '',
		miles: '',
		notes: '',
		vehicleId: ''
	};

	function computeMiles() {
		if (form.startOdometer !== '' && form.endOdometer !== '') {
			const s = Number(form.startOdometer);
			const e = Number(form.endOdometer);
			form.miles = String(Math.max(0, e - s));
		}
	}

	async function save() {
		if (!form.date) {
			toasts.error('Please choose a date');
			return;
		}

		// Require either both odometer readings, or an explicit miles value
		if (
			(form.startOdometer === '' || form.endOdometer === '') &&
			(form.miles === '' || Number(form.miles) <= 0)
		) {
			toasts.error('Please provide start and end odometer readings or enter miles directly');
			return;
		}

		const currentUser = $page.data['user'] || $user;
		const userId =
			currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
		if (!userId) {
			toasts.error('User missing');
			return;
		}

		try {
			let vehicleSnapshot: any = {};
			if (form.vehicleId) {
				const v = vehicles.find((x: any) => x.id === form.vehicleId);
				if (v) {
					vehicleSnapshot = {
						vehicleId: v.id,
						vehicleMake: v.make,
						vehicleModel: v.model,
						vehicleYear: v.year
					};
				}
			}

			const payload = {
				date: form.date,
				startOdometer: Number(form.startOdometer),
				endOdometer: Number(form.endOdometer),
				miles: Number(form.miles) || undefined,
				notes: form.notes,
				...vehicleSnapshot
			};
			await millage.create(payload, userId);
			toasts.success('Millage log created');
			goto('/dashboard/millage');
		} catch (err) {
			console.error(err);
			toasts.error('Failed to save');
		}
	}
</script>

<div class="expense-form-page">
	<div class="page-container">
		<div class="page-header">
			<div>
				<h1 class="page-title">New Millage Log</h1>
				<p class="page-subtitle">Record your odometer readings</p>
			</div>
			<a href="/dashboard/millage" class="btn-back">
				<svg width="24" height="24" viewBox="0 0 20 20" fill="none">
					<path
						d="M12 4L6 10L12 16"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				Back
			</a>
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
					<label for="vehicle-select">Vehicle</label>
					<div class="vehicle-select-row">
						<select id="vehicle-select" class="select-input" bind:value={form.vehicleId}>
							<option value="">(None)</option>
							{#each vehicles as v}
								<option value={v.id}>{v.make} {v.model} {v.year}</option>
							{/each}
						</select>
						<a href="/dashboard/millage" class="btn-small neutral" title="Manage vehicles">Manage</a
						>
					</div>
				</div>

				<div class="form-row">
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
						<input
							id="end-odo"
							type="number"
							bind:value={form.endOdometer}
							oninput={computeMiles}
						/>
					</div>
				</div>

				<div class="form-group">
					<label for="miles">Miles</label>
					<input id="miles" type="number" bind:value={form.miles} />
					<small class="text-sm text-gray-400"
						>Calculated from start/end odometers when provided — you can edit this value directly.</small
					>
				</div>

				<div class="form-group">
					<label for="notes">Notes</label>
					<textarea
						id="notes"
						bind:value={form.notes}
						rows="3"
						placeholder="Optional notes (e.g., trip purpose)"
					></textarea>
				</div>
				<div class="form-actions">
					<a href="/dashboard/millage" class="btn-secondary">Cancel</a>
					<button class="btn-primary" onclick={save}>Save Log</button>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.form-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 18px;
		padding: 16px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}
	.card-header {
		margin-bottom: 26px;
	}
	.card-title {
		font-size: 22px;
		font-weight: 700;
		color: #111827;
		margin: 0;
	}

	/* Page container (match Expenses) */
	.page-container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 16px;
		padding-bottom: 80px;
		overflow-x: hidden;
	}

	/* Header: match Expenses new page */
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
	}
	.page-title {
		font-size: 28px;
		font-weight: 800;
		color: #111827;
		margin: 0;
	}
	.page-subtitle {
		font-size: 14px;
		color: #6b7280;
		margin: 0;
	}
	.btn-back {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: #6b7280;
		text-decoration: none;
		font-size: 14px;
	}

	.form-grid {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	label {
		font-size: 16px;
		font-weight: 600;
		color: #374151;
	}

	input,
	textarea,
	select {
		width: 100%;
		padding: 16px;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		font-size: 18px;
		background: white;
		box-sizing: border-box;
	}
	input:focus,
	textarea:focus,
	select:focus {
		outline: none;
		border-color: #ff7f50;
	}

	.vehicle-select-row {
		display: flex;
		gap: 12px;
		align-items: center;
	}

	.select-input {
		flex: 1;
		padding: 12px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		font-size: 16px;
		background: white;
		color: #374151;
	}

	.btn-small.neutral {
		padding: 8px 12px;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		color: #374151;
		font-weight: 600;
	}

	.form-actions {
		display: flex;
		gap: 18px;
		margin-top: 36px;
		padding-top: 26px;
		border-top: 1px solid #e5e7eb;
	}
	.btn-primary,
	.btn-secondary {
		flex: 1;
		padding: 18px;
		border-radius: 12px;
		font-weight: 600;
		font-size: 18px;
		cursor: pointer;
		border: none;
		text-align: center;
		text-decoration: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.btn-primary {
		background: linear-gradient(135deg, #ff7f50 0%, #ff6a3d 100%);
		color: white;
	}
	.btn-secondary {
		background: white;
		border: 1px solid #e5e7eb;
		color: #374151;
	}

	@media (min-width: 768px) {
		.page-subtitle {
			display: block;
		}
		.form-card {
			padding: 48px;
		}
		.form-actions {
			justify-content: flex-end;
		}
		.btn-primary,
		.btn-secondary {
			flex: 0 0 auto;
			width: auto;
			min-width: 160px;
		}
	}
</style>
