// src/lib/server/hughesnet-parser.ts
import * as cheerio from 'cheerio';

export interface OrderData {
    id: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    confirmScheduleDate: string;
    beginTime: string;
    type: string;
    jobDuration: number;
    hasPoleMount?: boolean;
    departureIncomplete?: boolean;
    [key: string]: any;
}

export function extractIds(html: string | undefined): string[] {
    const ids = new Set<string>();
    const clean = (html || '').replace(/&amp;/g, '&');
    let m: RegExpExecArray | null;
    const re1 = /viewservice\.jsp\?.*?\bid=(\d+)/gi;
    while ((m = re1.exec(clean)) !== null) if (m[1]) ids.add(m[1]);
    const re2 = /[?&]id=(\d{8})\b/gi;
    while ((m = re2.exec(clean)) !== null) if (m[1]) ids.add(m[1]);
    return Array.from(ids);
}

export function extractMenuLinks(html: string, baseUrl: string): { url: string, text: string }[] {
    const links: { url: string, text: string }[] = [];
    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && (href.includes('.jsp') || href.includes('SoSearch')) && !href.startsWith('javascript')) {
            try {
                links.push({ url: new URL(href, baseUrl).href, text });
            } catch {}
        }
    });
    return links;
}

export function parseOrderPage(html: string, id: string): OrderData {
    const $ = cheerio.load(html);
    const out: OrderData = { 
        id, 
        address: '', 
        city: '', 
        state: '', 
        zip: '', 
        confirmScheduleDate: '', 
        beginTime: '', 
        type: 'Repair', 
        jobDuration: 60 
    };
    
    // --- HELPER 1: Scan Forward (Best for "Label: Value" structure) ---
    // Finds the label, then looks at the next 500 characters for a pattern.
    const scanForward = (label: string, regex: RegExp) => {
        const idx = html.indexOf(label);
        if (idx === -1) return '';
        
        // Grab a chunk of text starting from the label
        const chunk = html.slice(idx, idx + 500); 
        const match = chunk.match(regex);
        return (match && match[1]) ? String(match[1]).trim() : ''; 
    };

    // --- HELPER 2: Cheerio Input Value ---
    const val = (name: string) => $(`input[name="${name}"]`).val() as string;

    const bodyText = $('body').text();
    
    // 1. ADDRESS
    out.address = val('FLD_SO_Address1') || val('f_address') || val('txtAddress');
    if (!out.address) {
        // Try regex on the full HTML for robustness
        const match = html.match(/Address:<\/td>\s*<td[^>]*>(.*?)<\/td>/i);
        if (match) out.address = (match[1] || '').replace(/<[^>]*>/g, '').trim();
    }
    if (!out.address) {
        const addressMatch = bodyText.match(/Address:\s*(.*?)\s+(?:City|County|State)/i);
        if (addressMatch && addressMatch[1]) out.address = String(addressMatch[1]).trim();
    }
    out.address = toTitleCase(out.address || '');

    out.city = toTitleCase(val('f_city') || scanForward('City:', />([^<]+)</) || '');
    out.state = val('f_state') || scanForward('State:', />([A-Z]{2})</) || '';
    out.zip = val('f_zip') || scanForward('Zip:', />(\d{5})</) || '';
    
    // 2. DATE 
    // Logic: Look for "Confirm Schedule Date", then find the next date-like string
    out.confirmScheduleDate = val('f_sched_date');
    
    if (!out.confirmScheduleDate) {
        // [!code fix] Scan forward for MM/DD/YYYY or MM/DD/YY
        out.confirmScheduleDate = scanForward('Confirm Schedule Date', /(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    }
    
    if (!out.confirmScheduleDate) {
        // Fallback: Scan forward from "Schedule Date"
        out.confirmScheduleDate = scanForward('Schedule Date', /(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    }

    // Last resort: Look for "Date:"
    if (!out.confirmScheduleDate) {
        out.confirmScheduleDate = scanForward('Date:', /(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    }
    out.confirmScheduleDate = out.confirmScheduleDate || '';

    // 3. TIME
    // Logic: Look for "Arrival Window" or "Time", then find the next time-like string
    out.beginTime = val('f_begin_time');
    
    if (!out.beginTime) {
        // Matches 8:00, 08:00, 8:00 AM, 14:00
        out.beginTime = scanForward('Arrival Window', /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
    }
    
    if (!out.beginTime) {
        out.beginTime = scanForward('Time:', /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
    }
    out.beginTime = out.beginTime || '';

    // 4. TYPE & EXTRAS
    if (bodyText.includes('Service Order #')) {
        if (bodyText.match(/Install/i)) { out.type = 'Install'; out.jobDuration = 90; }
        else if (bodyText.match(/Upgrade/i)) { out.type = 'Upgrade'; out.jobDuration = 60; }
    }

    if (bodyText.includes('CON NON-STD CHARGE NEW POLE')) {
        out.hasPoleMount = true;
    }

    // 5. DEPARTURE CHECK
    const incompleteIdx = bodyText.indexOf('Departure Incomplete');
    const completeIdx = bodyText.lastIndexOf('Departure Complete'); 

    if (incompleteIdx !== -1) {
        if (completeIdx === -1 || completeIdx < incompleteIdx) {
            out.departureIncomplete = true;
        }
    }

    return out;
}

function toTitleCase(str: string) {
    if (!str) return '';
    return str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
}