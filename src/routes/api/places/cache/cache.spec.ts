import { describe, it, expect } from 'vitest';

import { parseCachedPlaceArray } from '$lib/server/placesCache';

describe('parseCachedPlaceArray', () => {
  it('returns [] for null', () => {
    expect(parseCachedPlaceArray(null)).toEqual([]);
  });

  it('returns [] for invalid JSON', () => {
    expect(parseCachedPlaceArray('not valid json')).toEqual([]);
  });

  it('returns [] for non-array JSON', () => {
    expect(parseCachedPlaceArray(JSON.stringify({ a: 1 }))).toEqual([]);
  });

  it('parses valid cached place entries with defaults and types', () => {
    const arr = [
      {
        formatted_address: '123 Main St',
        name: 'Main',
        secondary_text: 'Near the park',
        place_id: 'p1',
        geometry: { lat: 1, lng: 2 },
        source: 'autocomplete',
        cachedAt: '2020-01-01T00:00:00Z',
        contributedBy: 'user-1'
      }
    ];

    const raw = JSON.stringify(arr);
    const parsed = parseCachedPlaceArray(raw);
    expect(parsed.length).toBe(1);
    const first = parsed[0]!;
    expect(first.formatted_address).toBe('123 Main St');
    expect(first.name).toBe('Main');
    expect(first.place_id).toBe('p1');
    expect(first.geometry).toEqual({ lat: 1, lng: 2 });
    expect(first.source).toBe('autocomplete');
    expect(first.cachedAt).toBe('2020-01-01T00:00:00Z');
    expect(first.contributedBy).toBe('user-1');
  });

  it('handles malformed item shapes gracefully', () => {
    const raw = JSON.stringify([{ unexpected: true }, null]);
    const parsed = parseCachedPlaceArray(raw);
    expect(parsed.length).toBe(1);
    const first = parsed[0]!;
    expect(first.formatted_address).toBe('');
  });
});
