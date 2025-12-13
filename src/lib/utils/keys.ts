// src/lib/utils/keys.ts

export function normalizeSearchString(str: string): string {
    if (!str) return '';
    return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function generatePrefixKey(query: string): string {
    const normalized = normalizeSearchString(query);
    // Bucket by the first 10 characters for autocomplete lists
    const length = Math.min(10, normalized.length);
    const prefix = normalized.substring(0, length);
    return `prefix:${prefix}`;
}

// [!code ++] New: Secure, uniform key generation for Place Details
export async function generatePlaceKey(address: string): Promise<string> {
    const normalized = normalizeSearchString(address);
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `place:${hashHex}`;
}