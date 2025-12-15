// src/lib/utils/dashboardLogic.ts

export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

export function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(date);
}

export function calculateDashboardStats(allTrips: any[]) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    // Setup 30-day window
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    // Pre-fill map to ensure empty days show up in chart
    const dailyDataMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
        const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
        dailyDataMap.set(d.toISOString().split('T')[0], 0);
    }

    // Accumulators
    let totalProfit = 0;
    let totalMiles = 0;
    let fuel = 0;
    let maintenance = 0;
    let supplies = 0;
    let currentMonthProfit = 0;
    let lastMonthProfit = 0;

    // --- ONE LOOP TO RULE THEM ALL ---
    for (let i = 0; i < allTrips.length; i++) {
        const trip = allTrips[i];

        // 1. Basic Stats
        const earnings = trip.stops?.reduce((s: number, stop: any) => s + (Number(stop.earnings) || 0), 0) || 0;
        const tCosts = (Number(trip.fuelCost) || 0) + (Number(trip.maintenanceCost) || 0) + (Number(trip.suppliesCost) || 0);
        const profit = earnings - tCosts;

        totalProfit += profit;
        totalMiles += (Number(trip.totalMiles) || 0);
        fuel += (Number(trip.fuelCost) || 0);
        maintenance += (Number(trip.maintenanceCost) || 0);
        supplies += (Number(trip.suppliesCost) || 0);

        // 2. Date-based Stats
        if (trip.date) {
            const d = new Date(trip.date);
            const tripTime = d.getTime();

            // Chart Data (Last 30 Days)
            if (tripTime >= thirtyDaysAgo.getTime() && tripTime <= now.getTime()) {
                const key = d.toISOString().split('T')[0];
                const currentVal = dailyDataMap.get(key) || 0;
                dailyDataMap.set(key, currentVal + profit);
            }

            // Month Comparison
            const tMonth = d.getMonth();
            const tYear = d.getFullYear();

            if (tMonth === currentMonth && tYear === currentYear) {
                currentMonthProfit += profit;
            } else if (tMonth === lastMonth && tYear === lastMonthYear) {
                lastMonthProfit += profit;
            }
        }
    }

    // --- Final Data Shaping ---

    // Chart Array
    const last30DaysData = Array.from(dailyDataMap.entries()).map(([date, profit]) => ({ date, profit }));

    // Cost Breakdown
    const totalCost = fuel + maintenance + supplies;
    const costBreakdown = {
        fuel: { amount: fuel, percentage: totalCost > 0 ? (fuel / totalCost) * 100 : 0, color: '#FF7F50' },
        maintenance: { amount: maintenance, percentage: totalCost > 0 ? (maintenance / totalCost) * 100 : 0, color: '#29ABE2' },
        supplies: { amount: supplies, percentage: totalCost > 0 ? (supplies / totalCost) * 100 : 0, color: '#8DC63F' }
    };

    // Month Comparison
    const change = lastMonthProfit > 0 ? ((currentMonthProfit - lastMonthProfit) / lastMonthProfit) * 100 : 0;
    const monthComparison = {
        current: currentMonthProfit,
        last: lastMonthProfit,
        change: change,
        isPositive: change >= 0
    };

    return {
        recentTrips: allTrips.slice(0, 5),
        totalTrips: allTrips.length,
        totalProfit,
        totalMiles,
        avgProfitPerTrip: allTrips.length > 0 ? totalProfit / allTrips.length : 0,
        last30DaysData,
        costBreakdown,
        monthComparison
    };
}