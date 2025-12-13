// src/lib/utils/keys.ts

export function normalizeSearchString(str: string): string {
    if (!str) return '';
    return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function generatePrefixKey(query: string): string {
    const normalized = normalizeSearchString(query);
    // Consistent logic: bucket by the first 10 characters
    // This bucket size strikes a balance between partition size and lookup speed
    const length = Math.min(10, normalized.length);
    const prefix = normalized.substring(0, length);
    return `prefix:${prefix}`;
}