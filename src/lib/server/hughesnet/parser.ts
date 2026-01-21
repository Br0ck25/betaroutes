// src/lib/server/hughesnet/parser.ts
import * as cheerio from 'cheerio';
import type { OrderData } from './types';

export const BASE_URL = 'https://dwayinstalls.hns.com';

function toTitleCase(str: string) {
	if (!str) return '';
	return str.toLowerCase().replace(/\b\w/g, (s) => s.toUpperCase());
}

// [!code changed] Helper to find ALL timestamps for a specific label
function findEventTimestamps($: cheerio.CheerioAPI, eventLabel: string): number[] {
	const foundTs: number[] = [];

	// Regex: 1. \s* handles missing space, 2. Looks for optional seconds
	const tsRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/;

	$('.SearchUtilData').each((_, elem) => {
		const text = $(elem).text().trim();

		if (text.includes(eventLabel)) {
			// Check current cell first (new format)
			let match = text.match(tsRegex) as RegExpMatchArray | null;

			// If not found, check previous cell (legacy format)
			if (!match) {
				const prevCell = $(elem).prev('.SearchUtilData');
				if (prevCell.length) {
					const tsText = prevCell.text().trim();
					match = tsText.match(tsRegex) as RegExpMatchArray | null;
				}
			}

			if (match) {
				const [, month = '1', day = '1', year = '1970', hour = '0', min = '0', sec] =
					match as string[];
				const date = new Date(
					parseInt(year || '1970', 10),
					parseInt(month || '1', 10) - 1,
					parseInt(day || '1', 10),
					parseInt(hour || '0', 10),
					parseInt(min || '0', 10),
					sec ? parseInt(sec, 10) : 0
				);

				if (!isNaN(date.getTime())) {
					foundTs.push(date.getTime());
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
	if (!match || !match[1]) return '';
	return String(match[1]).trim();
}

export function extractIds(html: string): string[] {
	const ids = new Set<string>();
	const clean = html.replace(/&amp;/g, '&');
	let m;
	const re1 = /viewservice\.jsp\?.*?\bid=(\d+)/gi;
	while ((m = re1.exec(clean)) !== null) {
		if (m[1]) ids.add(m[1]);
	}
	const re2 = /[?&]id=(\d{8})\b/gi;
	while ((m = re2.exec(clean)) !== null) {
		if (m[1]) ids.add(m[1]);
	}
	return Array.from(ids);
}

export function extractMenuLinks(html: string): { url: string; text: string }[] {
	const links: { url: string; text: string }[] = [];
	const $ = cheerio.load(html);
	$('a[href]').each((_, el) => {
		const href = $(el).attr('href');
		const text = $(el).text().trim();
		if (
			href &&
			(href.includes('.jsp') || href.includes('SoSearch')) &&
			!href.startsWith('javascript')
		) {
			try {
				links.push({ url: new URL(href, BASE_URL).href, text });
			} catch (err: unknown) {
				void err;
			}
		}
	});
	return links;
}

export function extractNextLink(html: string, currentUrl: string): string | null {
	const $ = cheerio.load(html);
	const nextLink = $('a')
		.filter((_, el) => {
			const t = $(el).text().toLowerCase();
			return t.includes('next') || t.includes('>');
		})
		.first()
		.attr('href');

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
			try {
				sources.push(new URL(src, BASE_URL).href);
			} catch (err: unknown) {
				void err;
			}
		}
	});
	return sources;
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

	const val = (name: string) => `input[name="${name}"]`;
	const getVal = (name: string) => $(val(name)).val() as string;

	// --- Address Parsing ---
	out.address = getVal('FLD_SO_Address1') || getVal('f_address') || getVal('txtAddress') || '';
	if (!out.address) {
		const bodyText = $('body').text();
		const addressMatch = bodyText.match(/Address:\s*(.*?)\s+(?:City|County|State)/i);
		if (addressMatch && addressMatch[1]) out.address = String(addressMatch[1]).trim();
	}
	out.address = toTitleCase(out.address);
	out.city = toTitleCase(getVal('f_city') || scanForward(html, 'City:', />([^<]+)</) || '');
	out.state = getVal('f_state') || scanForward(html, 'State:', />([A-Z]{2})</) || '';
	out.zip = getVal('f_zip') || scanForward(html, 'Zip:', />(\d{5})</) || '';

	// --- Date Parsing ---
	out.confirmScheduleDate =
		getVal('f_sched_date') ||
		scanForward(html, 'Confirm Schedule Date', /(\d{1,2}\/\d{1,2}\/\d{2,4})/) ||
		scanForward(html, 'Date:', /(\d{1,2}\/\d{1,2}\/\d{2,4})/);

	// --- Time Parsing ---
	const cleanText = (text: string) => text.replace(/[\u00A0\s]+/g, ' ').trim();
	let arrivalTime = '';
	let schdBeginTime = '';

	const arrivalLabel = $('td.displaytextlbl').filter((_, el) => {
		const t = $(el).text();
		return t.includes('Arrival Time') || t.includes('Arrival Window');
	});

	if (arrivalLabel.length > 0) {
		const rawArrival = cleanText(arrivalLabel.next('td.displaytext').text());
		const match = rawArrival.match(/(\d{1,2}:\d{2})/) as RegExpMatchArray | null;
		if (match && match[1]) arrivalTime = match[1];
	}

	const beginLabel = $('td.displaytextlbl').filter((_, el) =>
		$(el).text().includes('Schd Est. Begin Time')
	);

	if (beginLabel.length > 0) {
		const rawBegin = cleanText(beginLabel.next('td.displaytext').text());
		const match = rawBegin.match(/(\d{1,2}:\d{2})/) as RegExpMatchArray | null;
		if (match && match[1]) schdBeginTime = match[1];
	}

	out.beginTime =
		getVal('f_begin_time') ||
		arrivalTime ||
		schdBeginTime ||
		scanForward(html, 'Time:', /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);

	// --- Type Parsing ---
	const bodyText = $('body').text();
	const typeLabelMatch = bodyText.match(
		/(?:Order|Service)\s*Type\s*[:.]?\s*(Re-Install|Install|Repair|Upgrade)/i
	);

	if (typeLabelMatch && typeLabelMatch[1]) {
		const found = String(typeLabelMatch[1]).toLowerCase();
		if (found.includes('re-install')) {
			out.type = 'Re-Install';
			out.jobDuration = 90;
		} else if (found.includes('install')) {
			out.type = 'Install';
			out.jobDuration = 90;
		} else if (found.includes('upgrade')) {
			out.type = 'Upgrade';
			out.jobDuration = 60;
		} else {
			out.type = 'Repair';
			out.jobDuration = 60;
		}
	} else if (bodyText.includes('Service Order #')) {
		if (bodyText.match(/Re-Install/i)) {
			out.type = 'Re-Install';
			out.jobDuration = 90;
		} else if (bodyText.match(/Upgrade/i)) {
			out.type = 'Upgrade';
			out.jobDuration = 60;
		} else if (bodyText.match(/Repair/i)) {
			out.type = 'Repair';
			out.jobDuration = 60;
		} else if (bodyText.match(/Install/i)) {
			out.type = 'Install';
			out.jobDuration = 90;
		}
	}

	if (bodyText.includes('CON NON-STD CHARGE NEW POLE')) {
		out.hasPoleMount = true;
	}
	// Detect explicit Wi-Fi task label (legacy)
	if (bodyText.includes('WI-FI INSTALLATION [Task]')) {
		out.hasWifiExtender = true;
	}
	// Heuristic: scan table cells with class SearchUtilData for common shorthand labels
	// Example: <td class="SearchUtilData">MESH WIFI INST L</td>
	$('.SearchUtilData').each((_, el) => {
		const cell = $(el).text().trim();
		const up = cell.toUpperCase();
		// If the cell mentions WIFI (or MESH) and an install/extend indicator, mark wifi extender
		if (
			/\b(WIFI|WI-FI|MESH)\b/.test(up) &&
			/\b(INST|INSTALL|INSTALLATION|EXTEND|EXTENDER|EXT)\b/.test(up)
		) {
			out.hasWifiExtender = true;
		}
	});
	if (bodyText.includes('Install, VOIP Phone [Task]')) {
		out.hasVoip = true;
	}
	// Detect VOIP from image tag: <img src="../images2/icoPhoneVoipMed.gif" ... title="VOIP" alt="VOIP">
	if (
		bodyText.includes('icoPhoneVoipMed.gif') ||
		bodyText.match(/title\s*=\s*["']VOIP["']/i) ||
		bodyText.match(/alt\s*=\s*["']VOIP["']/i)
	) {
		out.hasVoip = true;
	}

	// --- Timestamp & Duration (Updated for Split Visits) ---
	// 1. Get ALL timestamps
	const arrivalTimestamps = findEventTimestamps($, 'Arrival On Site');
	const completeTimestamps = findEventTimestamps($, 'Departure Complete');
	const incompleteTimestamps = findEventTimestamps($, 'Departure Incomplete');

	// 2. Determine Reference Date
	// We sort all activities descending to find the "latest" relevant date (Today)
	const allActivity = [...arrivalTimestamps, ...completeTimestamps, ...incompleteTimestamps].sort(
		(a, b) => b - a
	);
	let referenceDateString = '';

	if (allActivity.length > 0) {
		const d = new Date(allActivity[0] as number);
		referenceDateString = d.toDateString();
	}

	const isSameDate = (ts: number) => new Date(ts).toDateString() === referenceDateString;

	// 3. Select Best Timestamps based on Reference Date
	// Departure Complete: Use the LATEST one on the reference date
	out.departureCompleteTimestamp =
		completeTimestamps.filter(isSameDate).sort((a, b) => b - a)[0] || undefined;

	// Departure Incomplete: Use the LATEST one on the reference date
	out.departureIncompleteTimestamp =
		incompleteTimestamps.filter(isSameDate).sort((a, b) => b - a)[0] || undefined;

	// Arrival: Use the EARLIEST one on the reference date
	// [!code note] This fixes the sorting issue. We ignore the late arrival (after incomplete).
	out.arrivalTimestamp = arrivalTimestamps.filter(isSameDate).sort((a, b) => a - b)[0] || undefined;

	// Fallback if no specific date matched
	if (!out.arrivalTimestamp && arrivalTimestamps.length > 0) {
		out.arrivalTimestamp = arrivalTimestamps[0];
	}

	// 4. Calculate Duration
	// [!code note] Prioritize Departure Incomplete for duration calculation
	const endTimestamp = out.departureIncompleteTimestamp || out.departureCompleteTimestamp;

	if (out.arrivalTimestamp && endTimestamp) {
		const durationMins = Math.round((endTimestamp - out.arrivalTimestamp) / 60000);
		if (durationMins > 10 && durationMins < 600) {
			out.jobDuration = durationMins;
		}
	}

	if (out.departureIncompleteTimestamp) {
		out.departureIncomplete = true;
	}

	return out;
}
