<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	export let selectedCount = 0;
	export let isPro = false;

	const dispatch = createEventDispatcher();
</script>

<div class="action-bar-container">
	<div class="action-bar">
		<div class="action-bar-left">
			<div class="selection-indicator">
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<polyline points="20 6 9 17 4 12"></polyline>
				</svg>
				<span class="selected-count"
					>{selectedCount} {selectedCount === 1 ? 'trip' : 'trips'} selected</span
				>
			</div>
		</div>

		<div class="action-bar-right">
			<button class="action-pill secondary" onclick={() => dispatch('cancel')}>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
				<span class="action-text">Cancel</span>
			</button>

			<button class="action-pill export" onclick={() => dispatch('export')}>
				{#if !isPro}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
						<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
					</svg>
				{:else}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
						<polyline points="7 10 12 15 17 10"></polyline>
						<line x1="12" y1="15" x2="12" y2="3"></line>
					</svg>
				{/if}
				<span class="action-text">Export</span>
			</button>

			<button class="action-pill danger" onclick={() => dispatch('delete')}>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<polyline points="3 6 5 6 21 6"></polyline>
					<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
					></path>
				</svg>
				<span class="action-text">Delete</span>
			</button>
		</div>
	</div>
</div>

<style>
	.action-bar-container {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		justify-content: center;
		z-index: 1000;
		padding: 0;
		animation: slideUpFade 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		pointer-events: none;
	}
	.action-bar {
		background: white;
		padding: 12px 16px;
		border-radius: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
		max-width: 100%;
		width: 100%;
		pointer-events: auto;
		border-top: 1px solid #e5e7eb;
	}
	.action-bar-left {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.selection-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #ff7f50;
		font-weight: 700;
		font-size: 13px;
		padding: 6px 12px;
		background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
		border-radius: 10px;
		border: 1px solid #fed7aa;
	}
	.selection-indicator svg {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
	}
	.selected-count {
		color: #c2410c;
		white-space: nowrap;
	}
	.action-bar-right {
		display: flex;
		gap: 6px;
		justify-content: center;
	}
	.action-pill {
		border: 2px solid transparent;
		padding: 10px 12px;
		border-radius: 10px;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		font-family: inherit;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}
	.action-pill svg {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
	}
	.action-text {
		display: none;
	}
	.action-pill.secondary {
		background: white;
		color: #6b7280;
		border-color: #e5e7eb;
	}
	.action-pill.export {
		background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
		color: #c2410c;
		border-color: #fed7aa;
	}
	.action-pill.danger {
		background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
		color: #dc2626;
		border-color: #fca5a5;
	}
	.action-pill:active {
		transform: scale(0.95);
	}

	@media (hover: hover) {
		.action-pill.secondary:hover {
			background: #f9fafb;
			border-color: #d1d5db;
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		}
		.action-pill.export:hover {
			background: linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%);
			border-color: #fdba74;
			box-shadow: 0 2px 4px rgba(251, 146, 60, 0.15);
		}
		.action-pill.danger:hover {
			background: linear-gradient(135deg, #fecaca 0%, #fca5a5 100%);
			border-color: #f87171;
			box-shadow: 0 2px 4px rgba(220, 38, 38, 0.15);
		}
	}

	@keyframes slideUpFade {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@media (min-width: 380px) {
		.action-text {
			display: inline;
		}
		.action-pill {
			padding: 10px 14px;
		}
	}
	@media (min-width: 640px) {
		.action-bar-container {
			bottom: 30px;
			padding: 0 16px;
		}
		.action-bar {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			padding: 14px 20px;
			max-width: 700px;
			gap: 16px;
			border-radius: 16px;
			border: 1px solid #e5e7eb;
			box-shadow:
				0 0 0 1px rgba(0, 0, 0, 0.05),
				0 10px 25px -5px rgba(0, 0, 0, 0.1),
				0 8px 10px -6px rgba(0, 0, 0, 0.1);
		}
		.action-bar-left {
			justify-content: flex-start;
		}
		.selection-indicator {
			font-size: 14px;
			padding: 8px 14px;
		}
		.action-bar-right {
			gap: 8px;
		}
		.action-pill {
			flex: 0 0 auto;
			min-width: auto;
			padding: 10px 18px;
			font-size: 14px;
		}
		.action-text {
			display: inline;
		}
	}
	@media (min-width: 1024px) {
		.action-bar {
			max-width: 800px;
			padding: 16px 24px;
		}
		.selection-indicator {
			font-size: 15px;
			padding: 8px 16px;
		}
		.action-pill {
			padding: 12px 24px;
			font-size: 15px;
		}
	}
</style>
