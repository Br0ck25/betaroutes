<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { user } from '$lib/stores/auth';
	import { expenses } from '$lib/stores/expenses';
	import { toasts } from '$lib/stores/toast';
	import { userSettings } from '$lib/stores/userSettings';
	import { onMount } from 'svelte';

	const expenseId = $page.params.id;

	import SettingsModal from '../../../trips/components/SettingsModal.svelte';

	// Category options derived from user settings (grouped)
	$: maintenanceOptions =
		$userSettings.maintenanceCategories?.length > 0
			? $userSettings.maintenanceCategories
			: ['Oil Change', 'Tire Rotation', 'Brake Service', 'Filter Replacement'];
	$: suppliesOptions =
		$userSettings.supplyCategories?.length > 0
			? $userSettings.supplyCategories
			: ['Concrete', 'Poles', 'Wire', 'Tools', 'Equipment Rental'];
	$: expenseOptions =
		$userSettings.expenseCategories?.length > 0
			? $userSettings.expenseCategories
			: ['maintenance', 'insurance', 'supplies', 'other'];

	let selectedMaintenance = '';
	let selectedSupply = '';
	let selectedExpense = '';

	let isManageCategoriesOpen = false;
	let activeCategoryType: 'maintenance' | 'supplies' | 'expenses' = 'maintenance';
	let settingsInitialTab: 'defaults' | 'categories' = 'defaults';

	// Reset the initial tab when modal closes
	$: if (!isManageCategoriesOpen) settingsInitialTab = 'defaults';

	// Keep selected values in sync with form data
	$: if (formData.category) {
		if (maintenanceOptions.includes(formData.category)) {
			selectedMaintenance = formData.category;
			selectedSupply = '';
			selectedExpense = '';
		} else if (suppliesOptions.includes(formData.category)) {
			selectedSupply = formData.category;
			selectedMaintenance = '';
			selectedExpense = '';
		} else if (expenseOptions.includes(formData.category)) {
			selectedExpense = formData.category;
			selectedMaintenance = '';
			selectedSupply = '';
		} else {
			selectedMaintenance = '';
			selectedSupply = '';
			selectedExpense = '';
		}
	}

	function openSettings(type: 'maintenance' | 'supplies' | 'expenses') {
		activeCategoryType = type;
		// Ask the modal to open on the 'categories' tab
		settingsInitialTab = 'categories';
		isManageCategoriesOpen = true;
	}

	function selectMaintenance() {
		if (!selectedMaintenance) return;
		formData.category = selectedMaintenance;
		selectedSupply = '';
		selectedExpense = '';
	}

	function selectSupply() {
		if (!selectedSupply) return;
		formData.category = selectedSupply;
		selectedMaintenance = '';
		selectedExpense = '';
	}

	function selectExpense() {
		if (!selectedExpense) return;
		formData.category = selectedExpense;
		selectedMaintenance = '';
		selectedSupply = '';
	}

	let formData = {
		date: '',
		category: '',
		amount: '',
		description: '',
		taxDeductible: false
	};

	onMount(() => {
		// Find expense in store
		const expense = $expenses.find((e) => e.id === expenseId);
		if (expense) {
			formData = {
				date: expense.date,
				category: expense.category,
				amount: expense.amount.toString(),
				description: expense.description || '',
				taxDeductible: !!expense.taxDeductible
			};
		} else {
			toasts.error('Expense not found.');
			goto(resolve('/dashboard/expenses'));
		}
	});

	async function saveExpense() {
		if (!formData.amount || !formData.date || !formData.category) {
			toasts.error('Please fill in required fields.');
			return;
		}

		const currentUser = ($page.data as any)['user'] || $user;
		const userId = (currentUser as any)?.id || localStorage.getItem('offline_user_id');
		if (!userId) {
			toasts.error('User not identified. Cannot save.');
			return;
		}

		try {
			const payload = {
				...formData,
				amount: parseFloat(formData.amount)
			};

			await expenses.updateExpense(String(expenseId), payload, String(userId));
			toasts.success('Expense updated');
			goto(resolve('/dashboard/expenses'));
		} catch (err) {
			console.error(err);
			toasts.error('Failed to update expense');
		}
	}
</script>

<div class="expense-form-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Edit Expense</h1>
			<p class="page-subtitle">Update cost details</p>
		</div>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- using local resolve() helper (base-aware) -->
		<a href={resolve('/dashboard/expenses')} class="btn-back">
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
						<button
							type="button"
							class="btn-icon gear"
							on:click={() => openSettings('maintenance')}
							title="Manage Options"
							aria-expanded={isManageCategoriesOpen}
						>
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
							id="maintenance-select"
							name="maintenance"
							bind:value={selectedMaintenance}
							on:change={selectMaintenance}
							class="select-input"
							aria-label="Maintenance type"
							disabled={!!formData.category && !maintenanceOptions.includes(formData.category)}
						>
							<option value="" disabled selected>Select Item...</option>
							{#each maintenanceOptions as option (option)}
								<option value={option}>{option}</option>
							{/each}
						</select>
						{#if maintenanceOptions.includes(formData.category)}
							<button
								class="btn-small neutral"
								on:click={() => {
									formData.category = '';
									selectedMaintenance = '';
								}}>Clear</button
							>
						{:else}
							<button
								class="btn-small primary"
								on:click={() => (formData.category = selectedMaintenance)}
								disabled={!selectedMaintenance}>Choose</button
							>
						{/if}
					</div>
				</div>

				<div class="section-group">
					<div class="section-top">
						<h3>Supplies</h3>
						<button
							type="button"
							class="btn-icon gear"
							on:click={() => openSettings('supplies')}
							title="Manage Options"
							aria-expanded={isManageCategoriesOpen}
						>
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
							bind:value={selectedSupply}
							on:change={selectSupply}
							class="select-input"
							aria-label="Supply type"
							disabled={!!formData.category && !suppliesOptions.includes(formData.category)}
						>
							<option value="" disabled selected>Select Item...</option>
							{#each suppliesOptions as option (option)}
								<option value={option}>{option}</option>
							{/each}
						</select>
						{#if suppliesOptions.includes(formData.category)}
							<button
								class="btn-small neutral"
								on:click={() => {
									formData.category = '';
									selectedSupply = '';
								}}>Clear</button
							>
						{:else}
							<button
								class="btn-small primary"
								on:click={() => (formData.category = selectedSupply)}
								disabled={!selectedSupply}>Choose</button
							>
						{/if}
					</div>
				</div>

				<div class="section-group">
					<div class="section-top">
						<h3>Expenses</h3>
						<button
							type="button"
							class="btn-icon gear"
							on:click={() => openSettings('expenses')}
							title="Manage Options"
							aria-expanded={isManageCategoriesOpen}
						>
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
							bind:value={selectedExpense}
							on:change={selectExpense}
							class="select-input"
							aria-label="Expense category"
							disabled={!!formData.category && !expenseOptions.includes(formData.category)}
						>
							<option value="" disabled selected>Select Item...</option>
							{#each expenseOptions as option (option)}
								<option value={option}>{option}</option>
							{/each}
						</select>
						{#if expenseOptions.includes(formData.category)}
							<button
								class="btn-small neutral"
								on:click={() => {
									formData.category = '';
									selectedExpense = '';
								}}>Clear</button
							>
						{:else}
							<button
								class="btn-small primary"
								on:click={() => (formData.category = selectedExpense)}
								disabled={!selectedExpense}>Choose</button
							>
						{/if}
					</div>
				</div>

				<div class="form-group">
					<label for="amount">Amount</label>
					<div class="input-money-wrapper">
						<span class="symbol">$</span>
						<input
							id="amount"
							name="amount"
							type="number"
							step="0.01"
							bind:value={formData.amount}
							placeholder="0.00"
						/>
					</div>
				</div>
			</div>

			<div class="form-group">
				<label for="description">Description</label>
				<textarea
					id="description"
					name="description"
					bind:value={formData.description}
					rows="3"
					placeholder="e.g., Oil Change at Jiffy Lube"
				></textarea>
			</div>

			<div class="form-group checkbox-group">
				<label for="tax-deductible" class="inline-label">
					<input
						id="tax-deductible"
						name="taxDeductible"
						type="checkbox"
						bind:checked={formData.taxDeductible}
					/>
					<span>Tax deductible</span>
				</label>
			</div>
		</div>

		<!-- Settings modal (manage maintenance/supplies/expenses categories) -->
		<SettingsModal
			bind:open={isManageCategoriesOpen}
			bind:activeCategoryType
			initialTab={settingsInitialTab}
		/>

		<div class="form-actions">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- using local resolve() helper (base-aware) -->
			<a href={resolve('/dashboard/expenses')} class="btn-secondary">Cancel</a>
			<button class="btn-primary" on:click={saveExpense}>Save Changes</button>
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

	@media (max-width: 640px) {
		.expense-form-page {
			padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1px);
		}
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

	.input-money-wrapper {
		position: relative;
		width: 100%;
	}
	.input-money-wrapper .symbol {
		position: absolute;
		left: 16px;
		top: 50%;
		transform: translateY(-50%);
		color: #6b7280;
		font-weight: 600;
		font-size: 18px;
	}
	.input-money-wrapper input {
		padding-left: 36px;
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
	.btn-small.primary {
		padding: 8px 12px;
		background: linear-gradient(135deg, #ff7f50 0%, #ff6a3d 100%);
		color: white;
		border-radius: 8px;
		border: none;
		font-weight: 600;
	}
	.btn-small.neutral {
		padding: 8px 12px;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		color: #374151;
		font-weight: 600;
	}

	.form-group.checkbox-group .inline-label {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		font-weight: 600;
		color: #374151;
	}
	.form-group.checkbox-group input[type='checkbox'] {
		width: 18px;
		height: 18px;
		accent-color: #ff7f50;
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
