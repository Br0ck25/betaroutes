import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Helper functions
export function formatCurrency(amount: number): string {
    return `$${amount.toFixed(2)}`;
}

export function formatDuration(minutes: number): string {
    if (!minutes) return '0m';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString();
}

export async function getLogoDataUrl(): Promise<string | null> {
    try {
        const response = await fetch('/logo.png');
        if (!response.ok) return null;
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("Could not load logo for PDF", e);
        return null;
    }
}

// Export Functions
export function generateTripsCSV(trips: any[], includeSummary: boolean = true): string | null {
    if (trips.length === 0) return null;

    const headers = [
        'Date', 'Start Address', 'Intermediate Stops', 'End Address',
        'Total Miles', 'Drive Time', 'Hours Worked', 'Hourly Pay ($/hr)',
        'Total Revenue', 'Fuel Cost', 
        'Maintenance Cost', 'Maintenance Items',
        'Supply Cost', 'Supply Items',
        'Total Expenses', 'Net Profit', 'Notes'
    ];

    const rows = trips.map(trip => {
        const date = trip.date ? new Date(trip.date).toLocaleDateString() : '';
        const start = `"${(trip.startAddress || '').replace(/"/g, '""')}"`;
        
        const intermediateStops = trip.stops && trip.stops.length > 0
            ? trip.stops.map((s: any) => `${s.address} ($${(s.earnings || 0).toFixed(2)})`).join(' | ')
            : '';
        const stopsStr = `"${intermediateStops.replace(/"/g, '""')}"`;

        const rawEnd = trip.endAddress || 
                       (trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1].address : '') ||
                       trip.startAddress;
        const end = `"${(rawEnd || '').replace(/"/g, '""')}"`;

        const miles = (trip.totalMiles || 0).toFixed(1);
        const driveTime = `"${formatDuration(trip.estimatedTime || 0)}"`;
        const hoursWorked = (trip.hoursWorked || 0).toFixed(1);

        const revenue = trip.stops?.reduce((sum: number, stop: any) => sum + (stop.earnings || 0), 0) || 0;
        const fuel = trip.fuelCost || 0;
        
        const maint = trip.maintenanceCost || 0;
        const maintItemsStr = trip.maintenanceItems 
            ? `"${trip.maintenanceItems.map((i: any) => `${i.type}:${i.cost}`).join(' | ')}"` 
            : '""';

        const supplies = trip.suppliesCost || 0;
        const sItems = trip.suppliesItems || trip.supplyItems;
        const supplyItemsStr = sItems
            ? `"${sItems.map((i: any) => `${i.type}:${i.cost}`).join(' | ')}"`
            : '""';
            
        const totalExpenses = fuel + maint + supplies;
        const netProfit = revenue - totalExpenses;
        const hourlyPay = trip.hoursWorked > 0 ? (netProfit / trip.hoursWorked) : 0;
        const notes = `"${(trip.notes || '').replace(/"/g, '""')}"`;

        return [
            date, start, stopsStr, end, miles, driveTime, hoursWorked, 
            hourlyPay.toFixed(2), revenue.toFixed(2), fuel.toFixed(2), 
            maint.toFixed(2), maintItemsStr, 
            supplies.toFixed(2), supplyItemsStr, 
            totalExpenses.toFixed(2), netProfit.toFixed(2), notes
        ].join(',');
    });

    if (includeSummary) {
        const totalMiles = trips.reduce((sum, t) => sum + (t.totalMiles || 0), 0);
        const totalRevenue = trips.reduce((sum, t) => 
            sum + (t.stops?.reduce((s: number, stop: any) => s + (stop.earnings || 0), 0) || 0), 0);
        const totalExpenses = trips.reduce((sum, t) => 
            sum + (t.fuelCost || 0) + (t.maintenanceCost || 0) + (t.suppliesCost || 0), 0);
        const netProfit = totalRevenue - totalExpenses;

        rows.push('');
        rows.push([
            'TOTALS', '', '', '', totalMiles.toFixed(1), '', '', '', 
            totalRevenue.toFixed(2), '', '', '', '', '', 
            totalExpenses.toFixed(2), netProfit.toFixed(2), ''
        ].join(','));
    }

    return [headers.join(','), ...rows].join('\n');
}

export function generateExpensesCSV(expenses: any[], trips: any[], includeSummary: boolean = true): string | null {
    const allExpenses: Array<{
        date: string;
        category: string;
        amount: number;
        description: string;
    }> = [];

    // 1. Add expenses from expense store
    expenses.forEach(expense => {
        allExpenses.push({
            date: expense.date,
            category: expense.category,
            amount: expense.amount,
            description: expense.description || ''
        });
    });

    // 2. Add trip-level expenses
    trips.forEach(trip => {
        if (trip.fuelCost && trip.fuelCost > 0) {
            allExpenses.push({ date: trip.date || '', category: 'Fuel', amount: trip.fuelCost, description: 'From trip' });
        }
        // Maintenance
        if (trip.maintenanceItems?.length > 0) {
            trip.maintenanceItems.forEach((item: any) => {
                allExpenses.push({ date: trip.date || '', category: 'Maintenance', amount: item.cost, description: item.type });
            });
        } else if (trip.maintenanceCost > 0) {
            allExpenses.push({ date: trip.date || '', category: 'Maintenance', amount: trip.maintenanceCost, description: 'From trip' });
        }
        // Supplies
        const sItems = trip.suppliesItems || trip.supplyItems;
        if (sItems?.length > 0) {
            sItems.forEach((item: any) => {
                allExpenses.push({ date: trip.date || '', category: 'Supplies', amount: item.cost, description: item.type });
            });
        } else if (trip.suppliesCost > 0) {
            allExpenses.push({ date: trip.date || '', category: 'Supplies', amount: trip.suppliesCost, description: 'From trip' });
        }
    });

    if (allExpenses.length === 0) return null;

    allExpenses.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const expensesByDate: Record<string, Record<string, number>> = {};
    const categories = new Set<string>();
    
    allExpenses.forEach(exp => {
        const dateKey = exp.date ? formatDate(exp.date) : 'Unknown';
        expensesByDate[dateKey] = expensesByDate[dateKey] ?? {};
        categories.add(exp.category);
        expensesByDate[dateKey][exp.category] = (expensesByDate[dateKey][exp.category] || 0) + exp.amount;
    });

    const categoryList = Array.from(categories).sort();
    let csv = 'Date,' + categoryList.join(',') + ',Daily Total\n';
    
    const categoryTotals: Record<string, number> = {};
    categoryList.forEach(cat => categoryTotals[cat] = 0);
    let grandTotal = 0;

    Object.entries(expensesByDate).forEach(([date, cats]) => {
        const row: string[] = [date];
        let dailyTotal = 0;
        categoryList.forEach(category => {
            const amount = (cats[category] ?? 0);
            row.push(amount.toFixed(2));
            categoryTotals[category] = (categoryTotals[category] || 0) + amount;
            dailyTotal += amount;
        });
        row.push(dailyTotal.toFixed(2));
        grandTotal += dailyTotal;
        csv += row.join(',') + '\n';
    });

    if (includeSummary) {
        csv += '\n';
        const totalRow = [
            'TOTALS',
            ...categoryList.map(cat => (categoryTotals[cat] || 0).toFixed(2)),
            grandTotal.toFixed(2)
        ];
        csv += totalRow.join(',') + '\n';
    }

    return csv;
}

export async function generateTripsPDF(trips: any[], dateRangeStr: string) {
    const doc = new jsPDF();
    const logoData = await getLogoDataUrl();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header
    doc.setFillColor(255, 127, 80); // Orange
    doc.rect(0, 0, pageWidth, 35, 'F');

    if (logoData) {
        doc.addImage(logoData, 'PNG', 10, 5, 25, 25);
    }
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('Trip Report', pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Go Route Yourself - Professional Route Tracking', pageWidth / 2, 23, { align: 'center' });
    
    // Report metadata
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.text(`Period: ${dateRangeStr}`, 14, 42);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 47);
    doc.text(`Total Trips: ${trips.length}`, pageWidth - 14, 42, { align: 'right' });
    
    // Summary statistics
    const totalMiles = trips.reduce((sum, t) => sum + (t.totalMiles || 0), 0);
    const totalRevenue = trips.reduce((sum, t) => 
        sum + (t.stops?.reduce((s: number, stop: any) => s + (stop.earnings || 0), 0) || 0), 0);
    const totalExpenses = trips.reduce((sum, t) => 
        sum + (t.fuelCost || 0) + (t.maintenanceCost || 0) + (t.suppliesCost || 0), 0);
    const netProfit = totalRevenue - totalExpenses;
    
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 52, pageWidth - 28, 28, 3, 3, 'FD');
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    const statY = 60;
    const colWidth = (pageWidth - 28) / 4;
    
    doc.text('Total Miles', 14 + colWidth * 0.5, statY, { align: 'center' });
    doc.text('Total Revenue', 14 + colWidth * 1.5, statY, { align: 'center' });
    doc.text('Total Expenses', 14 + colWidth * 2.5, statY, { align: 'center' });
    doc.text('Net Profit', 14 + colWidth * 3.5, statY, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setTextColor(255, 127, 80);
    doc.text(totalMiles.toFixed(1), 14 + colWidth * 0.5, statY + 10, { align: 'center' });
    doc.setTextColor(34, 197, 94);
    doc.text(formatCurrency(totalRevenue), 14 + colWidth * 1.5, statY + 10, { align: 'center' });
    doc.setTextColor(239, 68, 68);
    doc.text(formatCurrency(totalExpenses), 14 + colWidth * 2.5, statY + 10, { align: 'center' });
    doc.setTextColor(netProfit >= 0 ? 34 : 239, netProfit >= 0 ? 197 : 68, netProfit >= 0 ? 94 : 68);
    doc.text(formatCurrency(netProfit), 14 + colWidth * 3.5, statY + 10, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    
    const tableData = trips.map(trip => {
        const intermediateStops = trip.stops && trip.stops.length > 0
            ? trip.stops.map((s: any) => s.address).join('\n')
            : 'None';
        
        const endAddr = trip.endAddress || 
                        (trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1].address : '') ||
                        trip.startAddress || '';
        
        const revenue = trip.stops?.reduce((sum: number, stop: any) => sum + (stop.earnings || 0), 0) || 0;
        const expenses = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
        const profit = revenue - expenses;
        
        return [
            formatDate(trip.date || ''),
            trip.startAddress || '',
            intermediateStops,
            endAddr,
            (trip.totalMiles || 0).toFixed(1) + ' mi',
            formatDuration(trip.estimatedTime || 0),
            (trip.hoursWorked || 0).toFixed(1) + ' hr',
            formatCurrency(revenue),
            formatCurrency(expenses),
            formatCurrency(profit)
        ];
    });

    autoTable(doc, {
        startY: 85,
        head: [['Date', 'Start', 'Stops', 'End', 'Miles', 'Drive Time', 'Hours', 'Revenue', 'Expenses', 'Profit']],
        body: tableData,
        theme: 'striped',
        headStyles: { 
            fillColor: [255, 127, 80],
            textColor: [255, 255, 255],
            fontSize: 9,
            fontStyle: 'bold',
            halign: 'center'
        },
        styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak', lineColor: [229, 231, 235], lineWidth: 0.1 },
        columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 30 },
            2: { cellWidth: 30 },
            3: { cellWidth: 30 },
            4: { halign: 'right', cellWidth: 15 },
            5: { halign: 'center', cellWidth: 18 },
            6: { halign: 'right', cellWidth: 15 },
            7: { halign: 'right', cellWidth: 20, textColor: [34, 197, 94] },
            8: { halign: 'right', cellWidth: 20, textColor: [239, 68, 68] },
            9: { halign: 'right', cellWidth: 20, fontStyle: 'bold' }
        },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: 14, right: 14 },
        didDrawPage: function(data: any) {
            const pageCount = doc.internal.pages.length - 1;
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(`Page ${data.pageNumber} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
            doc.text('Go Route Yourself - Professional Route Tracking', pageWidth - 14, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
        }
    });

    return doc;
}

export async function generateExpensesPDF(expenses: any[], trips: any[], dateRangeStr: string) {
    const doc = new jsPDF();
    const logoData = await getLogoDataUrl();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    const allExpenses: Array<any> = [];
    expenses.forEach(exp => allExpenses.push({
        date: exp.date, category: exp.category, amount: exp.amount, description: exp.description || '', source: 'Expense Log'
    }));
    
    trips.forEach(trip => {
        if (trip.fuelCost > 0) allExpenses.push({ date: trip.date, category: 'Fuel', amount: trip.fuelCost, description: 'From trip', source: 'Trip' });
        if (trip.maintenanceItems?.length > 0) {
            trip.maintenanceItems.forEach((item: any) => allExpenses.push({ date: trip.date, category: 'Maintenance', amount: item.cost, description: item.type, source: 'Trip' }));
        } else if (trip.maintenanceCost > 0) {
            allExpenses.push({ date: trip.date, category: 'Maintenance', amount: trip.maintenanceCost, description: 'From trip', source: 'Trip' });
        }
        const sItems = trip.suppliesItems || trip.supplyItems;
        if (sItems?.length > 0) {
            sItems.forEach((item: any) => allExpenses.push({ date: trip.date, category: 'Supplies', amount: item.cost, description: item.type, source: 'Trip' }));
        } else if (trip.suppliesCost > 0) {
            allExpenses.push({ date: trip.date, category: 'Supplies', amount: trip.suppliesCost, description: 'From trip', source: 'Trip' });
        }
    });

    allExpenses.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    doc.setFillColor(255, 127, 80);
    doc.rect(0, 0, pageWidth, 35, 'F');
    if (logoData) doc.addImage(logoData, 'PNG', 10, 5, 25, 25);
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('Expense Report', pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Go Route Yourself - Professional Route Tracking', pageWidth / 2, 23, { align: 'center' });

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.text(`Period: ${dateRangeStr}`, 14, 42);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 47);
    doc.text(`Total Expenses: ${allExpenses.length}`, pageWidth - 14, 42, { align: 'right' });

    const categoryTotals: Record<string, number> = {};
    let grandTotal = 0;
    allExpenses.forEach(exp => {
        if (!categoryTotals[exp.category]) categoryTotals[exp.category] = 0;
        categoryTotals[exp.category] += exp.amount;
        grandTotal += exp.amount;
    });

    doc.setFillColor(248, 250, 252);
    const categoryCount = Object.keys(categoryTotals).length;
    const boxHeight = 12 + (categoryCount * 6) + 8;
    doc.roundedRect(14, 52, pageWidth - 28, boxHeight, 3, 3, 'FD');
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Summary by Category', 20, 60);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    let yPos = 68;
    Object.entries(categoryTotals).forEach(([category, total]) => {
        doc.text(category, 20, yPos);
        doc.text(formatCurrency(total), pageWidth - 20, yPos, { align: 'right' });
        yPos += 6;
    });

    doc.setDrawColor(229, 231, 235);
    doc.line(20, yPos, pageWidth - 20, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Total Expenses', 20, yPos);
    doc.setTextColor(239, 68, 68);
    doc.text(formatCurrency(grandTotal), pageWidth - 20, yPos, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    const tableData = allExpenses.map(exp => [
        formatDate(exp.date),
        exp.description ? `${exp.category} - ${exp.description}` : exp.category,
        formatCurrency(exp.amount),
        exp.source
    ]);

    autoTable(doc, {
        startY: 52 + boxHeight + 8,
        head: [['Date', 'Expense', 'Amount', 'Source']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [255, 127, 80], textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold', halign: 'center' },
        styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak', lineColor: [229, 231, 235], lineWidth: 0.1 },
        columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 90 },
            2: { halign: 'right', cellWidth: 30, textColor: [239, 68, 68], fontStyle: 'bold' },
            3: { halign: 'center', cellWidth: 30 }
        },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: 14, right: 14 },
        didDrawPage: function(data: any) {
            const pageCount = doc.internal.pages.length - 1;
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(`Page ${data.pageNumber} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
        }
    });

    return doc;
}