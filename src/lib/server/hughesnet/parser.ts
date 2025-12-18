// src/lib/server/hughesnet/parser.ts
import * as cheerio from 'cheerio';
import type { OrderData } from './types';

export const BASE_URL = 'https://dwayinstalls.hns.com';

function toTitleCase(str: string) {
    if (!str) return '';
    return str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
}

// Hybrid approach: Use Cheerio for structure, regex for parsing
function findEventTimestamp($: cheerio.CheerioAPI, eventLabel: string): number | null {
    let foundTs: number | null = null;
    
    // Regex updated: 
    // 1. \s* instead of \s+ (handles missing space between date/time)
    // 2. Looks for seconds optionally
    const tsRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/;
    
    $('.SearchUtilData').each((i, elem) => {
        const text = $(elem).text().trim();
        
        if (text.includes(eventLabel)) {
            // Check current cell first (new format)
            let match = text.match(tsRegex);

            // If not found, check previous cell (legacy format)
            if (!match) {
                const prevCell = $(elem).prev('.SearchUtilData');
                if (prevCell.length) {
                    const tsText = prevCell.text().trim();
                    match = tsText.match(tsRegex);
                }
            }

            if (match) {
                const [_, month, day, year, hour, min, sec] = match;
                
                const date = new Date(
                    parseInt(year), 
                    parseInt(month) - 1, 
                    parseInt(day), 
                    parseInt(hour), 
                    parseInt(min), 
                    sec ? parseInt(sec) : 0
                );
                
                if (!isNaN(date.getTime())) {
                    foundTs = date.getTime();
                    return false; // Break loop
                }
            }
        }
    });
    
    return foundTs;
}

function scanForward(html: string, label: string, regex: RegExp): string {
    const idx = html.indexOf(label);
    if (idx === -1) return '';
    const chunk = html.slice(idx, idx + 500); 
    const match = chunk.match(regex);
    return match ? match[1].trim() : '';
}

export function extractIds(html: string): string[] {
    const ids = new Set<string>();
    const clean = html.replace(/&amp;/g, '&');
    let m;
    const re1 = /viewservice\.jsp\?.*?\bid=(\d+)/gi;
    while ((m = re1.exec(clean)) !== null) ids.add(m[1]);
    const re2 = /[?&]id=(\d{8})\b/gi;
    while ((m = re2.exec(clean)) !== null) ids.add(m[1]);
    return Array.from(ids);
}

export function extractMenuLinks(html: string): { url: string, text: string }[] {
    const links: { url: string, text: string }[] = [];
    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && (href.includes('.jsp') || href.includes('SoSearch')) && !href.startsWith('javascript')) {
            try {
                links.push({ url: new URL(href, BASE_URL).href, text });
            } catch {}
        }
    });
    return links;
}

export function extractNextLink(html: string, currentUrl: string): string | null {
    const $ = cheerio.load(html);
    const nextLink = $('a').filter((_, el) => {
        const t = $(el).text().toLowerCase();
        return t.includes('next') || t.includes('>');
    }).first().attr('href');

    if (nextLink && !nextLink.startsWith('javascript')) {
        return new URL(nextLink, currentUrl).href;
    }
    return null;
}

export function extractFrameSources(html: string): string[] {
    const sources: string[] = [];
    const $ = cheerio.load(html);
    $('frame, iframe').each((_, el) => {
        const src = $(el).attr('src');
        if (src) {
             try { sources.push(new URL(src, BASE_URL).href); } catch {}
        }
    });
    return sources;
}

export function parseOrderPage(html: string, id: string): OrderData {
    const $ = cheerio.load(html);
    const out: OrderData = { 
        id, address: '', city: '', state: '', zip: '', 
        confirmScheduleDate: '', beginTime: '', 
        type: 'Repair', jobDuration: 60 
    };
    
    const val = (name: string) => `input[name="${name}"]`;
    const getVal = (name: string) => $(val(name)).val() as string;
    
    // --- Address Parsing ---
    out.address = getVal('FLD_SO_Address1') || getVal('f_address') || getVal('txtAddress') || '';
    if (!out.address) {
        const bodyText = $('body').text();
        const addressMatch = bodyText.match(/Address:\s*(.*?)\s+(?:City|County|State)/i);
        if (addressMatch) out.address = addressMatch[1].trim();
    }
    out.address = toTitleCase(out.address);
    out.city = toTitleCase(getVal('f_city') || scanForward(html, 'City:', />([^<]+)</) || '');
    out.state = getVal('f_state') || scanForward(html, 'State:', />([A-Z]{2})</) || '';
    out.zip = getVal('f_zip') || scanForward(html, 'Zip:', />(\d{5})</) || '';

    // --- Date Parsing ---
    out.confirmScheduleDate = getVal('f_sched_date') || scanForward(html, 'Confirm Schedule Date', /(\d{1,2}\/\d{1,2}\/\d{2,4})/) || scanForward(html, 'Date:', /(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    
    // --- Time Parsing (Updated) ---
    // Helper to clean text (removes &nbsp; and trims)
    const cleanText = (text: string) => text.replace(/[\u00A0\s]+/g, ' ').trim();

    let arrivalTime = '';
    let schdBeginTime = '';

    // 1. Try to find "Arrival Time" or "Arrival Window"
    // We look for the label, then get the text of the NEXT sibling cell
    const arrivalLabel = $('td.displaytextlbl').filter((_, el) => {
        const t = $(el).text();
        return t.includes('Arrival Time') || t.includes('Arrival Window');
    });

    if (arrivalLabel.length > 0) {
        const rawArrival = cleanText(arrivalLabel.next('td.displaytext').text());
        // Extract HH:MM, ignore (24hr) or AM/PM for now, just grab the digits
        const match = rawArrival.match(/(\d{1,2}:\d{2})/);
        if (match) arrivalTime = match[1];
    }

    // 2. Try to find "Schd Est. Begin Time" (Fallback)
    const beginLabel = $('td.displaytextlbl').filter((_, el) => $(el).text().includes('Schd Est. Begin Time'));
    
    if (beginLabel.length > 0) {
        const rawBegin = cleanText(beginLabel.next('td.displaytext').text());
        // Matches "11:00" from "11:00 (24hr)"
        const match = rawBegin.match(/(\d{1,2}:\d{2})/);
        if (match) schdBeginTime = match[1];
    }

    // Priority: Form Input -> Arrival Time -> Schd Est. Begin Time -> Legacy Scan
    out.beginTime = getVal('f_begin_time') || 
                    arrivalTime || 
                    schdBeginTime || 
                    scanForward(html, 'Time:', /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);

    // --- Type Parsing (Prioritize Repair/Upgrade) ---
    const bodyText = $('body').text();
    
    // [!code ++] Updated regex to capture Re-Install
    const typeLabelMatch = bodyText.match(/(?:Order|Service)\s*Type\s*[:\.]?\s*(Re-Install|Install|Repair|Upgrade)/i);
    
    if (typeLabelMatch) {
        const found = typeLabelMatch[1].toLowerCase();
        if (found.includes('re-install')) { out.type = 'Re-Install'; out.jobDuration = 90; } // [!code ++]
        else if (found.includes('install')) { out.type = 'Install'; out.jobDuration = 90; }
        else if (found.includes('upgrade')) { out.type = 'Upgrade'; out.jobDuration = 60; }
        else { out.type = 'Repair'; out.jobDuration = 60; }
    } 
    else if (bodyText.includes('Service Order #')) {
        // [!code ++] Add Re-Install check
        if (bodyText.match(/Re-Install/i)) { out.type = 'Re-Install'; out.jobDuration = 90; }
        else if (bodyText.match(/Upgrade/i)) { out.type = 'Upgrade'; out.jobDuration = 60; }
        else if (bodyText.match(/Repair/i)) { out.type = 'Repair'; out.jobDuration = 60; }
        else if (bodyText.match(/Install/i)) { out.type = 'Install'; out.jobDuration = 90; }
    }

    if (bodyText.includes('CON NON-STD CHARGE NEW POLE')) {
        out.hasPoleMount = true;
    }

    // Check for WI-FI INSTALLATION task
    if (bodyText.includes('WI-FI INSTALLATION [Task]')) {
        out.hasWifiExtender = true;
    }

    // Check for VOIP Phone task
    if (bodyText.includes('Install, VOIP Phone [Task]')) {
        out.hasVoip = true;
    }

    // --- Timestamp & Duration ---
    out.arrivalTimestamp = findEventTimestamp($, 'Arrival On Site');
    out.departureCompleteTimestamp = findEventTimestamp($, 'Departure Complete');
    out.departureIncompleteTimestamp = findEventTimestamp($, 'Departure Incomplete');

    // Prioritize Departure Incomplete for duration calculation
    const endTimestamp = out.departureIncompleteTimestamp || out.departureCompleteTimestamp;

    // Calculate duration only if we have valid timestamps
    if (out.arrivalTimestamp && endTimestamp) {
        const durationMins = Math.round((endTimestamp - out.arrivalTimestamp) / 60000);
        // Sanity check: duration between 10 mins and 10 hours
        if (durationMins > 10 && durationMins < 600) {
            out.jobDuration = durationMins;
        }
    }

    if (out.departureIncompleteTimestamp) {
        out.departureIncomplete = true;
    }

    return out;
}