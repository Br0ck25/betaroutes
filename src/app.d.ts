// src/app.d.ts
//
// Minimal Cloudflare binding types (no @cloudflare/workers-types) to avoid DOM ↔ Worker collisions.

// Cloudflare KV & DurableObject ambient types (declared in global scope)

declare global {
  type KVValue = string | ArrayBuffer | ReadableStream<Uint8Array>;

  type KVPutOptions = {
    expiration?: number;
    expirationTtl?: number;
    metadata?: unknown;
  };

  type KVListOptions = {
    prefix?: string;
    limit?: number;
    cursor?: string;
  };

  type KVKeyInfo = {
    name: string;
    expiration?: number;
    metadata?: unknown;
  };

  type KVListResult = {
    keys: KVKeyInfo[];
    list_complete: boolean;
    cursor?: string;
  };

  interface KVNamespace<TKey extends string = string> {
    get<T = string | null>(
      key: string,
      options?: 'text' | 'arrayBuffer' | 'stream' | 'json' | { type: 'json' }
    ): Promise<T | null>;

    getWithMetadata<TMetadata = unknown>(key: string): Promise<[string | null, TMetadata | null]>;
    getWithMetadata<T, TMetadata = unknown>(
      key: string,
      options: { type: 'json' }
    ): Promise<[T | null, TMetadata | null]>;
    getWithMetadata<TMetadata = unknown>(
      key: string,
      options: { type: 'arrayBuffer' }
    ): Promise<[ArrayBuffer | null, TMetadata | null]>;
    getWithMetadata<TMetadata = unknown>(
      key: string,
      options: { type: 'stream' }
    ): Promise<[ReadableStream<Uint8Array> | null, TMetadata | null]>;

    put(key: string, value: KVValue, options?: KVPutOptions): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: KVListOptions): Promise<KVListResult>;
  }

  // Opaque DO id type (avoids empty-interface lint errors)
  type DurableObjectId = { readonly __durableObjectId: unique symbol };

  interface DurableObjectStub {
    fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
  }

  interface DurableObjectNamespace {
    idFromName(name: string): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    newUniqueId(): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
  }

  // Minimal DurableObjectState placeholder for type checking
  interface DurableObjectState {
    // Storage API
    storage: {
      get<T = unknown>(key: string): Promise<T | null>;
      put(key: string, value: unknown): Promise<void>;
      delete(key: string): Promise<void>;
      // SQLite-like SQL interface used in DOs
      sql: {
        exec(query: string, ...params: unknown[]): any;
        one?(): any;
      };
    };

    blockConcurrencyWhile<T = unknown>(cb: () => Promise<T>): Promise<T>;
    waitUntil(promise: Promise<unknown>): void;
  }
}

// Opaque DO id type (avoids empty-interface lint errors)
type DurableObjectId = { readonly __durableObjectId: unique symbol };

interface DurableObjectStub {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  newUniqueId(): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

declare global {
  namespace App {
    interface Locals {
      token: string | null;
      // SECURITY: user.id is REQUIRED when user is authenticated (not optional)
      // Per SECURITY.md: "User IDs MUST be unguessable (UUID/ULID)"
      user: {
        id: string; // REQUIRED - never optional
        token: string;
        plan: 'free' | 'premium';
        tripsThisMonth: number;
        maxTrips: number;
        resetDate: string;
        name?: string;
        email?: string;
        stripeCustomerId?: string;
      } | null;
      // CSP nonce for inline scripts (if needed)
      cspNonce?: string;
    }

    interface Env {
      // KV Namespaces (must match wrangler.toml bindings)
      BETA_LOGS_KV: KVNamespace;
      BETA_USERS_KV: KVNamespace;
      BETA_EXPENSES_KV: KVNamespace;
      BETA_USER_SETTINGS_KV: KVNamespace;
      BETA_HUGHESNET_KV: KVNamespace;
      BETA_PLACES_KV: KVNamespace;
      BETA_DIRECTIONS_KV: KVNamespace;
      BETA_SESSIONS_KV: KVNamespace;
      BETA_MILEAGE_KV: KVNamespace; // Added: missing from original

      // Durable Objects (bound via worker script: "trip-index-worker")
      TRIP_INDEX_DO: DurableObjectNamespace;
      PLACES_INDEX_DO: DurableObjectNamespace;

      // Secrets & Config
      HNS_ENCRYPTION_KEY: string;
      PUBLIC_GOOGLE_MAPS_API_KEY: string;
      PRIVATE_GOOGLE_MAPS_API_KEY: string;

      // Index signature for additional bindings (optional)
      // Remove if you want maximum strictness
      [key: string]: unknown;
    }

    interface Platform {
      env: Env;
      context: {
        waitUntil(promise: Promise<unknown>): void;
      };
      caches: CacheStorage & { default: Cache };
    }
  }
}

export {};
