// src/lib/server/hughesnet/utils.ts
import { RESYNC_WINDOW_MS } from './constants';
import type { SyncConfig, OrderData } from './types';

// --- Date Helpers ---

/**
 * Robust date parser that handles:
 * 1. MM/DD/YYYY (HughesNet format)
 * 2. YYYY-MM-DD (Internal System format)
 */
export function parseAnyDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Try YYYY-MM-DD first (ISO format used in internal keys)
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        const [, yy = '1970', mm = '1', dd = '1'] = isoMatch as string[];
        return new Date(parseInt(yy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
    }

    // Try MM/DD/YYYY (HughesNet slash format)
    const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (slashMatch) {
        let y = slashMatch[3] || '1970';
        if (y.length === 2) y = '20' + y;
        return new Date(parseInt(y, 10), parseInt(slashMatch[1] || '1', 10) - 1, parseInt(slashMatch[2] || '1', 10));
    }

    return null;
}

export function parseDateOnly(dateStr: string): Date | null {
    return parseAnyDate(dateStr);
}

export function toIsoDate(dateStr: string): string | null {
    const d = parseDateOnly(dateStr);
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function extractDateFromTs(ts: number): string | null {
    if (!ts) return null;
    const d = new Date(ts);
    return toIsoDate(`${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`);
}

export function parseTime(timeStr: string): number {
    if (!timeStr) return 0;
    const match = timeStr.match(/\b(\d{1,2}:\d{2})/);
    const matched = match?.[1] || '0:00';
    const parts = matched.split(':').map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
    if (!isFinite(minutes) || isNaN(minutes)) return '12:00 PM';
    if (minutes < 0) minutes += 1440;
    let h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${suffix}`;
}

export function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return minutesToTime(d.getHours() * 60 + d.getMinutes());
}

/**
 * Checks if a date string is within the last X days relative to today.
 * Returns true if date is today, in the future, or within the lookback window.
 */
export function isWithinDays(dateStr: string, days: number): boolean {
    const d = parseAnyDate(dateStr);
    if (!d) return false;
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    
    const diffTime = now.getTime() - target.getTime();
    const diffDays = diffTime / (1000 * 3600 * 24);
    
    // Within window if difference is less than or equal to 'days' 
    // (Future dates result in negative diffDays, which are also included)
    return diffDays <= days; 
}

// --- Validation & Business Logic Helpers ---

export function validateSyncConfig(config: SyncConfig): void {
    const { installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge, wifiExtenderPay, voipPay, driveTimeBonus } = config;
    if (!isFinite(installPay) || installPay < 0) throw new Error('Install pay must be a positive finite number');
    if (!isFinite(repairPay) || repairPay < 0) throw new Error('Repair pay must be a positive finite number');
    if (!isFinite(upgradePay) || upgradePay < 0) throw new Error('Upgrade pay must be a positive finite number');
    if (!isFinite(poleCost) || poleCost < 0) throw new Error('Pole cost must be a positive finite number');
    if (!isFinite(concreteCost) || concreteCost < 0) throw new Error('Concrete cost must be a positive finite number');
    if (!isFinite(poleCharge) || poleCharge < 0) throw new Error('Pole charge must be a positive finite number');
    if (!isFinite(wifiExtenderPay) || wifiExtenderPay < 0) throw new Error('WiFi Extender pay must be a positive finite number');
    if (!isFinite(voipPay) || voipPay < 0) throw new Error('Phone pay must be a positive finite number');
    if (!isFinite(driveTimeBonus) || driveTimeBonus < 0) throw new Error('Drive Time Bonus must be a positive finite number');
}

export function isValidAddress(order: OrderData): boolean {
    const trimmedAddress = order.address?.trim();
    const trimmedCity = order.city?.trim();
    const trimmedState = order.state?.trim();
    return !!(trimmedAddress || (trimmedCity && trimmedState));
}

export function buildAddress(o: OrderData): string {
    const parts = [o.address, o.city, o.state, o.zip]
        .filter(Boolean)
        .map(s => s.trim())
        .filter(s => s.length > 0);
    if (parts.length === 0) return '';
    return parts.join(', ');
}

export function determineOrderSyncStatus(order: OrderData): { syncStatus: 'complete' | 'incomplete' | 'future'; needsResync: boolean; } {
    const now = Date.now();
    if (order.departureCompleteTimestamp) return { syncStatus: 'complete', needsResync: false };
    if (order.departureIncompleteTimestamp) {
        const withinWindow = !!order.lastSyncTimestamp && (now - (order.lastSyncTimestamp as number)) < RESYNC_WINDOW_MS;
        return { syncStatus: 'incomplete', needsResync: withinWindow };
    }
    return { syncStatus: 'future', needsResync: true };
}

export function checkIncompleteToComplete(oldOrder: OrderData | undefined, newOrder: OrderData): boolean {
    if (!oldOrder) return false;
    if (oldOrder.syncStatus !== 'incomplete') return false;
    if (!newOrder.departureCompleteTimestamp) return false;
    if (!oldOrder.departureIncompleteTimestamp) return false;
    if (!oldOrder.lastSyncTimestamp) return false;
    const daysSinceSync = (Date.now() - oldOrder.lastSyncTimestamp) / (1000 * 60 * 60 * 24);
    if (daysSinceSync > 7) return false; 
    return true;
}

export function shouldMarkAsRemoved(order: OrderData): boolean {
    return !!(order.arrivalTimestamp && order.departureIncompleteTimestamp);
}