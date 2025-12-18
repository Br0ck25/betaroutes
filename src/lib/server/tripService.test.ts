// src/lib/server/tripService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTripService, type TripRecord } from './tripService';

// --- Mocks ---

// Mock Cloudflare KV
const createMockKV = (data: Record<string, string>) => ({
    get: vi.fn(async (key: string) => data[key] || null),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(async ({ prefix }: { prefix: string }) => {
        const keys = Object.keys(data)
            .filter(k => k.startsWith(prefix))
            .map(name => ({ name }));
        return { keys, list_complete: true, cursor: null };
    }),
});

// Mock Durable Object Stub
const createMockStub = () => {
    let storage: any[] = [];
    let initialized = false;

    // [!code fix] Updated fetch signature to accept 'init' (options)
    return {
        fetch: vi.fn(async (urlOrRequest: string | Request, init?: RequestInit) => {
            const urlStr = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url;
            const url = new URL(urlStr, 'http://internal'); 

            // GET /list
            if (url.pathname === '/list') {
                if (!initialized) return new Response(JSON.stringify({ needsMigration: true }));
                return new Response(JSON.stringify(storage));
            }

            // POST /migrate
            if (url.pathname === '/migrate') {
                if (url.searchParams.get('complete') === 'true') {
                    initialized = true;
                }
                
                // [!code fix] Robustly extract body from init options
                const rawBody = init?.body || (urlOrRequest as any).body;
                const requestBody = rawBody ? JSON.parse(rawBody as string) : [];
                
                storage = [...storage, ...requestBody];
                return new Response('OK');
            }

            return new Response('Not Found', { status: 404 });
        }),
    };
};

describe('TripService Migration Logic', () => {
    let mockKV: any;
    let mockTrashKV: any;
    let mockPlacesKV: any;
    let mockDO: any;
    let mockStub: any;
    let service: any;

    const USER_ID = 'user_123';

    beforeEach(() => {
        // Setup initial KV data: 105 trips to test batching (50+50+5)
        const kvData: Record<string, string> = {};
        for (let i = 1; i <= 105; i++) {
            const trip: TripRecord = {
                id: `trip_${i}`,
                userId: USER_ID,
                createdAt: new Date().toISOString(),
                title: `Trip ${i}`,
                deleted: false
            };
            kvData[`trip:${USER_ID}:trip_${i}`] = JSON.stringify(trip);
        }

        mockKV = createMockKV(kvData);
        mockTrashKV = createMockKV({});
        mockPlacesKV = createMockKV({});
        
        mockStub = createMockStub();
        mockDO = {
            idFromName: vi.fn(() => ({})), 
            get: vi.fn(() => mockStub)     
        };

        service = makeTripService(mockKV, mockTrashKV, mockPlacesKV, mockDO);
    });

    it('should detect when migration is needed', async () => {
        const results = await service.list(USER_ID);
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(105);
    });

    it('should batch migration requests in chunks of 50', async () => {
        await service.list(USER_ID);

        const calls = mockStub.fetch.mock.calls;
        
        const migrateCalls = calls.filter((c: any) => {
             const url = typeof c[0] === 'string' ? c[0] : c[0].url;
             return url.includes('/migrate');
        });

        // 105 items / 50 batch size = 3 calls
        expect(migrateCalls.length).toBe(3);

        // Check Batch 1 (First 50)
        // [!code fix] Access body from second argument (c[1])
        const batch1Body = JSON.parse(migrateCalls[0][1].body);
        expect(batch1Body.length).toBe(50);
        expect(migrateCalls[0][0]).not.toContain('complete=true');

        // Check Batch 2 (Next 50)
        const batch2Body = JSON.parse(migrateCalls[1][1].body);
        expect(batch2Body.length).toBe(50);

        // Check Batch 3 (Final 5)
        const batch3Body = JSON.parse(migrateCalls[2][1].body);
        expect(batch3Body.length).toBe(5);
        expect(migrateCalls[2][0]).toContain('complete=true');
    });

    it('should handle corrupt KV data gracefully', async () => {
        const corruptKey = `trip:${USER_ID}:corrupt_json`;
        mockKV.get = vi.fn(async (key: string) => {
            if (key === corruptKey) return "{ this is not json }";
            return JSON.stringify({ id: 'valid', userId: USER_ID, createdAt: '2025-01-01' });
        });
        
        mockKV.list = vi.fn(async () => ({
            keys: [{ name: corruptKey }, { name: `trip:${USER_ID}:valid` }],
            list_complete: true
        }));

        await service.list(USER_ID);

        const migrateCalls = mockStub.fetch.mock.calls.filter((c: any) => 
            c[0].toString().includes('/migrate')
        );
        
        const body = JSON.parse(migrateCalls[0][1].body);
        expect(body.length).toBe(1);
        expect(body[0].id).toBe('valid');
    });
});