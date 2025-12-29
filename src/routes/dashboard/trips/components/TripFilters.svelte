<script lang="ts">
	export let searchQuery = '';
	export let startDate = '';
	export let endDate = '';
	export let filterProfit = 'all';
	export let sortBy = 'date';
	export let sortOrder = 'desc';
</script>

<div class="filters-bar sticky-bar">
	<div class="search-box">
		<svg
			class="search-icon"
			width="20"
			height="20"
			viewBox="0 0 20 20"
			fill="none"
			aria-hidden="true"
		>
			<path
				d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path
				d="M19 19L14.65 14.65"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		<input
			type="text"
			placeholder="Search trips..."
			bind:value={searchQuery}
			aria-label="Search trips"
		/>
	</div>

	<div class="filter-group date-group">
		<input type="date" bind:value={startDate} class="date-input" aria-label="Start Date" />
		<span class="date-sep">-</span>
		<input type="date" bind:value={endDate} class="date-input" aria-label="End Date" />
	</div>

	<div class="filter-group">
		<select bind:value={filterProfit} class="filter-select" aria-label="Filter by profit">
			<option value="all">All Trips</option>
			<option value="positive">Profitable</option>
			<option value="negative">Losses</option>
		</select>

		<select bind:value={sortBy} class="filter-select" aria-label="Sort by">
			<option value="date">By Date</option>
			<option value="profit">By Profit</option>
			<option value="miles">By Miles</option>
		</select>

		<button
			class="sort-btn"
			aria-label="Toggle sort order"
			onclick={() => (sortOrder = sortOrder === 'asc' ? 'desc' : 'asc')}
		>
			<svg
				width="20"
				height="20"
				viewBox="0 0 20 20"
				fill="none"
				style="transform: rotate({sortOrder === 'asc' ? '180deg' : '0deg'})"
				aria-hidden="true"
			>
				<path
					d="M10 3V17M10 17L4 11M10 17L16 11"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</div>
</div>

<style>
	.filters-bar {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 20px;
	}
	.sticky-bar {
		position: sticky;
		top: 0;
		z-index: 10;
		background: #f9fafb;
		padding: 10px 12px;
		margin: -12px -12px 10px -12px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
	}
	.search-box {
		position: relative;
		width: 100%;
	}
	.search-icon {
		position: absolute;
		left: 14px;
		top: 50%;
		transform: translateY(-50%);
		color: #9ca3af;
		pointer-events: none;
	}
	.search-box input {
		width: 100%;
		padding: 12px 16px 12px 42px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		font-size: 15px;
		background: white;
		box-sizing: border-box;
	}
	.date-group {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.date-input {
		flex: 1;
		padding: 12px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		font-size: 14px;
		background: white;
		min-width: 0;
	}
	.date-sep {
		color: #9ca3af;
		font-weight: bold;
	}
	.filter-group {
		display: flex;
		flex-direction: row;
		gap: 8px;
		width: 100%;
	}
	.filter-select {
		flex: 1;
		min-width: 0;
		padding: 12px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		font-size: 14px;
		background: white;
		color: #374151;
	}
	.sort-btn {
		flex: 0 0 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: white;
		color: #6b7280;
		cursor: pointer;
	}

	@media (min-width: 640px) {
		.filters-bar {
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
		}
		.search-box {
			max-width: 300px;
		}
		.date-group {
			width: auto;
		}
		.filter-group {
			width: auto;
			flex-wrap: nowrap;
		}
		.filter-select {
			width: 140px;
			flex: none;
		}
	}
	@media (min-width: 1024px) {
		.search-box {
			max-width: 300px;
		}
	}
</style>
