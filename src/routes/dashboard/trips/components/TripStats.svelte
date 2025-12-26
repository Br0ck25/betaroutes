<script lang="ts">
    import { formatCurrency, calculateNetProfit, calculateHourlyPay } from '$lib/utils/trip-helpers';

    export let trips: any[] = [];
</script>

<div class="stats-summary">
    <div class="summary-card">
        <div class="summary-label">Total Trips</div>
        <div class="summary-value">{trips.length}</div>
    </div>

    <div class="summary-card">
        <div class="summary-label">Total Miles</div>
        <div class="summary-value">
            {trips.reduce((sum, trip) => sum + (trip.totalMiles || 0), 0).toFixed(1)}
        </div>
    </div>
    <div class="summary-card">
        <div class="summary-label">Total Profit</div>
        <div class="summary-value">
            {formatCurrency(trips.reduce((sum, trip) => sum + calculateNetProfit(trip), 0))}
        </div>
    </div>
    <div class="summary-card">
        <div class="summary-label">Avg $/Hour</div>
        <div class="summary-value">
            {(() => {
                const tripsWithHours = trips.filter(t => t.hoursWorked > 0);
                if (tripsWithHours.length === 0) return 'N/A';
                const totalHourlyPay = tripsWithHours.reduce((sum, trip) => sum + calculateHourlyPay(trip), 0);
                return formatCurrency(totalHourlyPay / tripsWithHours.length) + '/hr';
            })()}
        </div>
    </div>
</div>

<style>
    .stats-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
    .summary-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; text-align: center; }
    .summary-label { font-size: 12px; color: #6B7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .summary-value { font-size: 20px; font-weight: 800; color: #111827; }

    @media (min-width: 640px) {
        .stats-summary { grid-template-columns: repeat(2, 1fr); }
    }
    @media (min-width: 1024px) {
        .stats-summary { grid-template-columns: repeat(4, 1fr); }
    }
</style>