// src/lib/utils/dashboardLogic.ts

export type TimeRange = '30d' | '60d' | '90d' | '1y' | 'all';

export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

export function formatDate(dateString: string): string {
    // Handle 'YYYY-MM' format (Month grouping)
    if (/^\d{4}-\d{2}$/.test(dateString)) {
        const [y, m] = dateString.split('-').map(Number);
        const date = new Date(y, m - 1, 1);
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            year: 'numeric'
        }).format(date);
    }
    
    // Handle 'YYYY-MM-DD' format
    // Append T00:00:00 to force local time interpretation
    const date = new Date(dateString.includes('T') ? dateString : dateString + 'T00:00:00');
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric'
    }).format(date);
}

export function calculateDashboardStats(allTrips: any[], range: TimeRange = '30d') {
    const now = new Date();
    // Set to end of today to include all trips from today
    now.setHours(23, 59, 59, 999);
    
    const currentYear = now.getFullYear();
    
    // 1. Determine Date Ranges & Grouping Strategy
    let startDate: Date;
    let prevStartDate: Date; 
    let groupBy: 'day' | 'month' = 'day';

    switch (range) {
        case '30d':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(startDate.getDate() - 30);
            break;
        case '60d':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 60);
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(startDate.getDate() - 60);
            break;
        case '90d':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 90);
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(startDate.getDate() - 90);
            break;
        case '1y':
            // Current Year (Year to Date)
            startDate = new Date(currentYear, 0, 1); // Jan 1st of current year
            prevStartDate = new Date(currentYear - 1, 0, 1); // Jan 1st of last year
            groupBy = 'month';
            break;
        case 'all':
            startDate = new Date(0); // 1970
            prevStartDate = new Date(0);
            groupBy = 'month'; // Group by month for all time to avoid crowding
            break;
        default:
             startDate = new Date(now);
             startDate.setDate(now.getDate() - 30);
             prevStartDate = new Date(startDate);
             prevStartDate.setDate(startDate.getDate() - 30);
    }

    // 2. Initialize Chart Data (Map of Date Key -> Profit)
    const chartDataMap = new Map<string, number>();
    
    // Fill empty buckets if range is fixed (not 'all')
    if (range !== 'all') {
        const d = new Date(startDate);
        // Loop until d is past 'now'
        while (d <= now) {
            let key: string;
            
            if (groupBy === 'month') {
                // Key: YYYY-MM
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                // Advance 1 month
                d.setMonth(d.getMonth() + 1);
            } else {
                // Key: YYYY-MM-DD
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                // Advance 1 day
                d.setDate(d.getDate() + 1);
            }
            
            // Set initial 0 if not exists
            if (!chartDataMap.has(key)) {
                chartDataMap.set(key, 0);
            }
        }
    }

    // 3. Process Trips
    const currentTrips: any[] = [];
    let totalProfit = 0;
    let totalMiles = 0;
    let fuel = 0;
    let maintenance = 0;
    let supplies = 0;
    let prevTotalProfit = 0;

    for (const trip of allTrips) {
        if (!trip.date) continue;
        
        // Force local time interpretation for trip date to match our buckets
        const d = new Date(trip.date.includes('T') ? trip.date : trip.date + 'T00:00:00');
        const tTime = d.getTime();
        
        // Calc Profit
        const earnings = trip.stops?.reduce((s: number, stop: any) => s + (Number(stop.earnings) || 0), 0) || 0;
        const costs = (Number(trip.fuelCost) || 0) + (Number(trip.maintenanceCost) || 0) + (Number(trip.suppliesCost) || 0);
        const tripProfit = earnings - costs;

        // Current Range Logic
        if (tTime >= startDate.getTime() && tTime <= now.getTime()) {
            currentTrips.push(trip);
            
            totalProfit += tripProfit;
            totalMiles += (Number(trip.totalMiles) || 0);
            
            fuel += (Number(trip.fuelCost) || 0);
            maintenance += (Number(trip.maintenanceCost) || 0);
            supplies += (Number(trip.suppliesCost) || 0);

            // Add to Chart Map
            let key: string;
            if (groupBy === 'month') {
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            } else {
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
            
            // For 'all' range, we might encounter keys not pre-filled
            const currentVal = chartDataMap.get(key) || 0;
            chartDataMap.set(key, currentVal + tripProfit);
        }
        
        // Previous Range Logic (for comparison)
        if (range !== 'all' && tTime >= prevStartDate.getTime() && tTime < startDate.getTime()) {
            prevTotalProfit += tripProfit;
        }
    }

    // 4. Final Shaping
    
    // Convert Map to Sorted Array
    const chartData = Array.from(chartDataMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, profit]) => ({ date, profit }));

    // Cost Breakdown
    const totalCost = fuel + maintenance + supplies;
    const costBreakdown = {
        fuel: { amount: fuel, percentage: totalCost > 0 ? (fuel / totalCost) * 100 : 0, color: '#FF7F50' },
        maintenance: { amount: maintenance, percentage: totalCost > 0 ? (maintenance / totalCost) * 100 : 0, color: '#29ABE2' },
        supplies: { amount: supplies, percentage: totalCost > 0 ? (supplies / totalCost) * 100 : 0, color: '#8DC63F' }
    };

    // Comparison Stats
    let change = 0;
    if (range !== 'all') {
        if (prevTotalProfit !== 0) {
            change = ((totalProfit - prevTotalProfit) / Math.abs(prevTotalProfit)) * 100;
        } else if (totalProfit > 0) {
            change = 100;
        }
    }

    const periodComparison = {
        current: totalProfit,
        last: prevTotalProfit,
        change: change,
        isPositive: change >= 0
    };
    
    // Sort recent trips (newest first)
    const sortedCurrentTrips = [...currentTrips].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return {
        recentTrips: sortedCurrentTrips.slice(0, 5),
        totalTrips: currentTrips.length,
        totalProfit,
        totalMiles,
        avgProfitPerTrip: currentTrips.length > 0 ? totalProfit / currentTrips.length : 0,
        chartData,
        costBreakdown,
        periodComparison
    };
}