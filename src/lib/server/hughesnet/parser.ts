// src/lib/server/hughesnet/parser.ts
import * as cheerio from 'cheerio';
import type { OrderData } from './types';

export const BASE_URL = 'https://dwayinstalls.hns.com';

function toTitleCase(str: string) {
    if (!str) return '';
    return str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
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
    
    const val = (name: string) => $(`input[name="${name}"]`).val() as string;
    
    out.address = val('FLD_SO_Address1') || val('f_address') || val('txtAddress') || '';
    if (!out.address) {
        const bodyText = $('body').text();
        const addressMatch = bodyText.match(/Address:\s*(.*?)\s+(?:City|County|State)/i);
        if (addressMatch) out.address = addressMatch[1].trim();
    }
    out.address = toTitleCase(out.address);
    out.city = toTitleCase(val('f_city') || '');
    out.state = val('f_state') || '';
    out.zip = val('f_zip') || '';
    out.confirmScheduleDate = val('f_sched_date') || '';
    out.beginTime = val('f_begin_time') || '';

    const pageText = $('body').text();
    if (pageText.includes('Service Order #')) {
        if (pageText.match(/Install/i)) { out.type = 'Install'; out.jobDuration = 90; }
        else if (pageText.match(/Upgrade/i)) { out.type = 'Upgrade'; out.jobDuration = 60; }
    }

    if (pageText.includes('CON NON-STD CHARGE NEW POLE')) {
        out.hasPoleMount = true;
    }

    const incompleteIdx = pageText.indexOf('Departure Incomplete');
    const completeIdx = pageText.lastIndexOf('Departure Complete'); 

    if (incompleteIdx !== -1) {
        if (completeIdx === -1 || completeIdx < incompleteIdx) {
            out.departureIncomplete = true;
        }
    }

    return out;
}