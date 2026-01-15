<script lang="ts">
	import { millage } from '$lib/stores/millage';
	import { user } from '$lib/stores/auth';
	import { userSettings } from '$lib/stores/userSettings';
	import { toasts } from '$lib/stores/toast';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	const expenseId = $page.params.id;

	// Settings modal removed for Millage edit page

	// Category options are not applicable for Millage edit

	// Category selection state removed for Millage edit

	// Category sync removed for Millage edit

	// Category helper functions removed for Millage edit

	let formData = {
		date: '',
		startOdometer: '',
		endOdometer: '',
		miles: '',
		vehicle: '',
		millageRate: '',
		notes: '',
		category: ''
	};

	let milesManual = false;

	// default millageRate from settings if editing and none present
	$: if ($userSettings && formData.millageRate === '' && $userSettings.millageRate != null) {
		formData.millageRate = String($userSettings.millageRate);
	}

	onMount(() => {
		// Find millage record in store
		const rec = $millage.find((e) => e.id === expenseId);
		if (rec) {
			const r: any = rec as any;
			formData = {
				date: r.date || '',
				startOdometer: String(r.startOdometer || ''),
				endOdometer: String(r.endOdometer || ''),
				miles: typeof r.miles === 'number' ? String(r.miles) : '',
				vehicle: r.vehicle || '',
				millageRate: typeof r.millageRate === 'number' ? String(r.millageRate) : '',
				notes: r.notes || '',
				category: r.category || ''
			};
		} else {
			toasts.error('Millage log not found.');
			goto('/dashboard/millage');
		}
	});

	// Auto-calc miles from odometer readings unless the user has manually edited miles
	$: if (!milesManual) {
		if (formData.startOdometer !== '' && formData.endOdometer !== '') {
			const s = Number(formData.startOdometer) || 0;
			const e = Number(formData.endOdometer) || 0;
			formData.miles = Number(Math.max(0, e - s).toFixed(2)).toString();
		}
	}

	async function saveExpense() {
		if (
			formData.startOdometer === '' || formData.endOdometer === ''
				? formData.miles !== ''
				: !formData.date
		) {
			// Ensure either start & end are present or miles is provided
			if (
				!formData.date ||
				((formData.startOdometer === '' || formData.endOdometer === '') && formData.miles === '')
			) {
				toasts.error('Please fill in required fields (either start & end odometer or miles).');
				return;
			}
		}

		const currentUser = ($page.data as any)['user'] || $user;
		const userId =
			(currentUser as any)?.name ||
			(currentUser as any)?.token ||
			localStorage.getItem('offline_user_id');

		if (!userId) {
			toasts.error('User not identified. Cannot save.');
			return;
		}

		try {
			const start = Number(formData.startOdometer) || 0;
			const end = Number(formData.endOdometer) || 0;
			let miles =
				formData.miles !== '' && !isNaN(Number(formData.miles))
					? Number(formData.miles)
					: Math.max(0, end - start);
			miles = Number(miles.toFixed(2));

			const payload = {
				...formData,
				startOdometer: start,
				endOdometer: end,
				miles,
				millageRate: formData.millageRate !== '' ? Number(formData.millageRate) : undefined,
				vehicle: formData.vehicle || undefined
			};

			await millage.updateMillage(String(expenseId), payload as any, String(userId));
			toasts.success('Millage log updated');
			goto('/dashboard/millage');
		} catch (err) {
			console.error(err);
			toasts.error('Failed to update millage log');
		}
	}
</script>

<div class="expense-form-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Edit Millage Log</h1>
			<p class="page-subtitle">Update odometer readings and miles</p>
		</div>
		<a href="/dashboard/millage" class="btn-back">
			<svg width="24" height="24" viewBox="0 0 20 20" fill="none"
				><path
					d="M12 4L6 10L12 16"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/></svg
			> Back
		</a>
	</div>

	<div class="form-card">
		<div class="card-header">
			<h2 class="card-title">Expense Details</h2>
		</div>

		<div class="form-grid">
			<div class="form-group">
				<label for="expense-date">Date</label>
				<input id="expense-date" type="date" bind:value={formData.date} required />
			</div>

			<div class="form-row">
				<div class="section-group">
					<div class="section-top">
						<h3>Maintenance</h3>
						<button class="btn-icon gear" title="Manage Options">
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><circle cx="12" cy="12" r="3"></circle><path
									d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
								></path></svg
							>
						</button>
					</div>

					<div class="add-row">
						<select
							id="maintenance-select-removed"
							name="removed"
							class="select-input"
							aria-label="Maintenance type"
							disabled
						>
							<option value="" disabled selected>Select Item...</option>
							{#each [] as option}
								<option value={option}>{option}</option>
							{/each}
						</select>
						<!-- maintenance actions removed -->
					</div>
				</div>

				<div class="section-group">
					<div class="section-top">
						<h3>Supplies</h3>
						<button class="btn-icon gear" title="Manage Options">
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><circle cx="12" cy="12" r="3"></circle><path
									d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
								></path></svg
							>
						</button>
					</div>

					<div class="add-row">
						<select
							id="supplies-select"
							name="supplies"
							class="select-input"
							aria-label="Supply type"
							disabled
						>
							<option value="" disabled selected>Select Item...</option>
							{#each [] as option}
								<option value={option}>{option}</option>
							{/each}
						</select>
						<button class="btn-small neutral" disabled>Choose</button>
					</div>
				</div>

				<div class="section-group">
					<div class="section-top">
						<h3>Expenses</h3>
						<button class="btn-icon gear" title="Manage Options">
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><circle cx="12" cy="12" r="3"></circle><path
									d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
								></path></svg
							>
						</button>
					</div>

					<div class="add-row">
						<select
							id="expense-select"
							name="expenseCategory"
							class="select-input"
							aria-label="Expense category"
							disabled
						>
							<option value="" disabled selected>Select Item...</option>
							{#each [] as option}
								<option value={option}>{option}</option>
							{/each}
						</select>
						<button class="btn-small neutral" disabled>Choose</button>
					</div>
				</div>

				<div class="form-group grid-3">
					<div>
						<label for="start-odo">Start Odometer</label>
						<input
							id="start-odo"
							type="number"
							inputmode="decimal"
							bind:value={formData.startOdometer}
							placeholder="0"
						/>
					</div>
					<div>
						<label for="end-odo">End Odometer</label>
						<input
							id="end-odo"
							type="number"
							inputmode="decimal"
							bind:value={formData.endOdometer}
							placeholder="0"
						/>
					</div>
					<div>
						<label for="miles">Miles</label>
						<input
							id="miles"
							type="number"
							step="0.01"
							inputmode="decimal"
							bind:value={formData.miles}
							on:input={(e) => (milesManual = (e.target as HTMLInputElement).value !== '')}
							placeholder="0.0"
						/>
					</div>
				</div>
			</div>

			<div class="form-group">
				<label for="notes">Notes</label>
				<textarea
					id="notes"
					name="notes"
					bind:value={formData.notes}
					rows="3"
					placeholder="e.g., Trip to client site"
				></textarea>

				<!-- tax deductible removed -->
			</div>

			<!-- Settings modal removed for Millage edit -->

			<div class="form-row">
				<div class="form-group">
					<label for="vehicle">Vehicle</label>
					<select id="vehicle" bind:value={formData.vehicle} class="p-2 border rounded-lg">
						{#if $userSettings.vehicles && $userSettings.vehicles.length > 0}
							{#each $userSettings.vehicles as v}
								<option value={v.id || v.name}>{v.name}</option>
							{/each}
						{:else}
							<option value="">No vehicles (open Millage Settings)</option>
						{/if}
					</select>
				</div>
				<div class="form-group">
					<label for="millage-rate">Millage Rate (per mile)</label>
					<input
						id="millage-rate"
						type="number"
						step="0.001"
						bind:value={formData.millageRate}
						placeholder="0.655"
					/>
				</div>
			</div>

			<div class="form-actions">
				<a href="/dashboard/millage" class="btn-secondary">Cancel</a>
				<button class="btn-primary" on:click={saveExpense}>Save Changes</button>
			</div>
		</div>
	</div>
</div>

<style>
	/* MATCHING STYLES FROM TRIPS/NEW */
	.expense-form-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 4px;
		padding-bottom: 90px;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 26px;
		padding: 0 8px;
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
		display: none;
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
	/* Make the start/end/miles group span the full width (match Date input) */
	.form-row .grid-3 {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}
	@media (max-width: 767px) {
		.form-row .grid-3 {
			grid-template-columns: 1fr;
		}
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

	.section-group {
		margin-bottom: 24px;
	}
	.section-top {
		display: flex;
		justify-content: space-between;
		margin-bottom: 12px;
		align-items: center;
	}
	.section-top h3 {
		font-size: 16px;
		font-weight: 700;
		margin: 0;
	}
	.add-row {
		display: flex;
		gap: 12px;
		margin-bottom: 12px;
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
	.btn-icon.gear {
		background: none;
		border: none;
		cursor: pointer;
		padding: 6px;
		color: #6b7280;
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
