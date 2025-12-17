// src/lib/server/hughesnet/fetcher.ts
import type { FetcherOptions } from './types';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

const DEFAULT_MAX_REQUESTS = 35;

export class HughesNetFetcher {
    private requestCount = 0;
    private maxRequests: number;
    private userAgent: string;

    constructor(maxRequests: number = DEFAULT_MAX_REQUESTS) {
        this.maxRequests = maxRequests;
        this.userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    }

    resetCount() {
        this.requestCount = 0;
    }

    getRequestCount() {
        return this.requestCount;
    }

    getUserAgent() {
        return this.userAgent;
    }

    async safeFetch(url: string, options: FetcherOptions = {}) {
        if (this.requestCount >= this.maxRequests) {
            throw new Error('REQ_LIMIT');
        }
        
        this.requestCount++;
        
        const headers = {
            'User-Agent': this.userAgent,
            ...options.headers
        };

        return fetch(url, { ...options, headers } as RequestInit);
    }
}
