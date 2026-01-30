// src/lib/server/hughesnet/fetcher.ts
import type { FetcherOptions } from './types';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

// Cloudflare Workers limits
const HARD_REQUEST_LIMIT = 35; // Absolute maximum - never exceed
const SOFT_REQUEST_LIMIT = 30; // Trigger batching when reached

export class HughesNetFetcher {
  private requestCount = 0;
  private hardLimit: number;
  private softLimit: number;
  private userAgent: string;

  constructor(hardLimit: number = HARD_REQUEST_LIMIT, softLimit: number = SOFT_REQUEST_LIMIT) {
    this.hardLimit = hardLimit;
    this.softLimit = softLimit;
    this.userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
  }

  resetCount() {
    this.requestCount = 0;
  }

  getRequestCount() {
    return this.requestCount;
  }

  getSoftLimit() {
    return this.softLimit;
  }

  getHardLimit() {
    return this.hardLimit;
  }

  shouldBatch(): boolean {
    return this.requestCount >= this.softLimit;
  }

  isAtHardLimit(): boolean {
    return this.requestCount >= this.hardLimit;
  }

  getUserAgent() {
    return this.userAgent;
  }

  async safeFetch(url: string, options: FetcherOptions = {}) {
    if (this.requestCount >= this.hardLimit) {
      throw new Error('REQ_LIMIT');
    }

    this.requestCount++;

    const headers: Record<string, string> = Object.assign(
      { 'User-Agent': this.userAgent },
      options.headers || {}
    );

    return fetch(url, { ...options, headers } as RequestInit);
  }
}
