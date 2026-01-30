import { getLogoDataUrl, formatCurrency, formatDuration, formatDate } from './export-utils';
import { SvelteDate } from '$lib/utils/svelte-reactivity';
import type { Trip, Stop } from '$lib/types';

// Lightweight PDF document interface limited to the methods/properties we use here
export interface PdfDocument {
  internal: { pageSize: { getWidth(): number; getHeight(): number }; pages: unknown[] };
  setFillColor(r: number, g: number, b: number): void;
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  addImage(dataUrl: string, format: string, x: number, y: number, w: number, h: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setFontSize(size: number): void;
  setFont(family: string, style?: string): void;
  text(text: string, x: number, y: number, options?: { align?: string }): void;
  roundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    rx: number,
    ry: number,
    style?: string
  ): void;
  save(filename?: string): void;
}

// Re-export other PDF helpers for convenience so the ExportModal can import them from one place
export { generateExpensesPDF, generateTaxBundlePDF } from './export-utils';

export async function generateTripsPDF(trips: Trip[], dateRangeStr: string): Promise<PdfDocument> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
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
  doc.text('Go Route Yourself - Professional Route Tracking', pageWidth / 2, 23, {
    align: 'center'
  });

  // Report metadata
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.text(`Period: ${dateRangeStr}`, 14, 42);
  doc.text(`Generated: ${SvelteDate.now().toLocaleString()}`, 14, 47);
  doc.text(`Total Trips: ${trips.length}`, pageWidth - 14, 42, { align: 'right' });

  // Summary statistics
  const totalMiles = trips.reduce((sum: number, t: Trip) => sum + (t.totalMiles || 0), 0);
  const totalRevenue = trips.reduce(
    (sum: number, t: Trip) =>
      sum + (t.stops?.reduce((s: number, stop: Stop) => s + (stop.earnings || 0), 0) || 0),
    0
  );
  const totalExpenses = trips.reduce(
    (sum: number, t: Trip) =>
      sum + (t.fuelCost || 0) + (t.maintenanceCost || 0) + (t.suppliesCost || 0),
    0
  );
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

  const tableData = trips.map((trip: Trip) => {
    const intermediateStops =
      trip.stops && trip.stops.length > 0
        ? trip.stops.map((s: Stop) => s.address).join('\n')
        : 'None';

    const lastStop =
      trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1] : undefined;
    const endAddr = trip.endAddress || (lastStop && lastStop.address) || trip.startAddress || '';

    const revenue =
      trip.stops?.reduce((sum: number, stop: Stop) => sum + (stop.earnings || 0), 0) || 0;
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
    head: [
      [
        'Date',
        'Start',
        'Stops',
        'End',
        'Miles',
        'Drive Time',
        'Hours',
        'Revenue',
        'Expenses',
        'Profit'
      ]
    ],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: [255, 127, 80],
      textColor: [255, 255, 255],
      fontSize: 9,
      fontStyle: 'bold',
      halign: 'center'
    },
    styles: {
      fontSize: 8,
      cellPadding: 3,
      overflow: 'linebreak',
      lineColor: [229, 231, 235],
      lineWidth: 0.1
    },
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
    didDrawPage: function (data: { pageNumber: number }) {
      const pageCount = doc.internal.pages.length - 1;
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
      doc.text(
        'Go Route Yourself - Professional Route Tracking',
        pageWidth - 14,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'right' }
      );
    }
  });

  return doc;
}
