import 'fake-indexeddb/auto';

// Minimal indexedDB shim for Vitest (prevents ReferenceError during background hydration)
// This file exists solely for unit tests where persistent storage is irrelevant — it provides
// minimal, no-op implementations of IndexedDB types so the `idb` wrapper does not throw during
// background hydration. See `AI_AGENTS.md` and `SECURITY.md`: tests must not access real storage.
// Keep intentionally tiny and test-only; do NOT use in production or as a model for real DB access.

// Use a single, narrow global accessor for test-only shims
const G = (typeof globalThis !== 'undefined'
  ? globalThis
  : typeof global !== 'undefined'
    ? global
    : undefined) as unknown as Record<string, unknown> | undefined;

if (G && !('indexedDB' in G)) {
  G['indexedDB'] = {
    open: () => {
      // Return an actual IDBOpenDBRequest instance if available so idb recognizes it.
      const Ctor =
        (G['IDBOpenDBRequest'] as unknown as new () => unknown) ||
        (G['IDBRequest'] as unknown as new () => unknown) ||
        (class {} as unknown as new () => unknown);
      const req: unknown = new Ctor();
      if (typeof req === 'object' && req !== null) {
        const r = req as Record<string, unknown>;
        r['onupgradeneeded'] = null;
        r['onsuccess'] = null;
        r['onerror'] = null;
        r['addEventListener'] = () => {};
        r['removeEventListener'] = () => {};
      }
      return req;
    }
  };
}

// Provide minimal IDB request constructor used by the idb wrapper
if (G && !('IDBRequest' in G)) {
  G['IDBRequest'] = class IDBRequest {};
}

// Minimal IDBTransaction stub used by idb's transformation logic
if (G && !('IDBTransaction' in G)) {
  G['IDBTransaction'] = class IDBTransaction {};
}

// Minimal IDBDatabase stub used to avoid runtime checks in idb
if (G && !('IDBDatabase' in G)) {
  G['IDBDatabase'] = class IDBDatabase {};
}

// Provide minimal stubs for common IDB types to silence idb runtime checks
const _idbTypes = [
  'IDBObjectStore',
  'IDBIndex',
  'IDBCursor',
  'IDBCursorWithValue',
  'IDBKeyRange',
  'IDBOpenDBRequest',
  'IDBFactory',
  'IDBVersionChangeEvent'
];

for (const t of _idbTypes) {
  if (G && !(t in G)) {
    G[t] = class {};
  }
  if (typeof globalThis !== 'undefined') {
    const GT = globalThis as unknown as Record<string, unknown>;
    if (!(t in GT)) {
      GT[t] = (G as Record<string, unknown>)[t];
    }
  }
}

// Ensure IDBOpenDBRequest exists and provides addEventListener
if (G && 'IDBRequest' in G) {
  let openCtor = G['IDBOpenDBRequest'] as unknown;
  if (
    !openCtor ||
    (openCtor as unknown) === undefined ||
    !('prototype' in (openCtor as unknown as Record<string, unknown>))
  ) {
    // create a minimal constructor for tests (avoid extending unknown base)
    const newCtor = class IDBOpenDBRequest {};
    G['IDBOpenDBRequest'] = newCtor;
    openCtor = newCtor;
  }
  const openProtoCandidate = openCtor as unknown as Record<string, unknown>;
  const openProto = openProtoCandidate['prototype'] as unknown as
    | Record<string, unknown>
    | undefined;
  if (openProto && !('addEventListener' in openProto)) {
    openProto['addEventListener'] = function () {};
  }
}
if (typeof globalThis !== 'undefined') {
  const GT = globalThis as unknown as Record<string, unknown>;
  let gtOpenCtor = GT['IDBOpenDBRequest'] as unknown;
  if (!gtOpenCtor || !('prototype' in (gtOpenCtor as unknown as Record<string, unknown>))) {
    gtOpenCtor = G ? (G['IDBOpenDBRequest'] as unknown) : class IDBOpenDBRequest {};
    GT['IDBOpenDBRequest'] = gtOpenCtor as unknown;
  }
  const gtOpenProtoCandidate = gtOpenCtor as unknown as Record<string, unknown>;
  const gtOpenProto = gtOpenProtoCandidate['prototype'] as unknown as
    | Record<string, unknown>
    | undefined;
  if (gtOpenProto && !('addEventListener' in gtOpenProto)) {
    gtOpenProto['addEventListener'] = function () {};
  }
}

// Provide a test-only shim so the Svelte client runtime's `mount`/`unmount` APIs are
// available to the test runtime. This ensures `@testing-library/svelte` can detect
// modern Svelte in environments where the package resolver defaults to the server
// entry (Node). This is a best-effort, test-only patch; do NOT rely on it in prod.
(async () => {
  try {
    const SvelteMain = await import('svelte');

    // Try to load the browser/client runtime from the package files directly.
    // This helps when the resolver has already cached the server entry.
    try {
      const clientUrl = new URL('../node_modules/svelte/src/index-client.js', import.meta.url).href;
      // Use dynamic import via file URL to bypass package export restrictions
      // when necessary. Wrap in try/catch because file import may not be allowed
      // in some environments.
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - dynamic import of file URL
        const Client = await import(clientUrl);
        if (Client) {
          (SvelteMain as any).mount = (Client as any).mount || (SvelteMain as any).mount;
          (SvelteMain as any).unmount = (Client as any).unmount || (SvelteMain as any).unmount;
          (SvelteMain as any).flushSync =
            (Client as any).flushSync || (SvelteMain as any).flushSync;
          (SvelteMain as any).tick = (Client as any).tick || (SvelteMain as any).tick;
        }
      } catch {
        // ignore - fallback to legacy shim below
      }
    } catch {
      // ignore
    }

    // If modern mount API is still missing, implement a minimal shim that maps to
    // the legacy component API. This makes tests run in Node where the
    // package resolver selects the server entry.
    if (SvelteMain && typeof (SvelteMain as any).mount !== 'function') {
      // mount(Component, { target?, props? }) -> legacy `new Component({ target, props })`
      (SvelteMain as any).mount = (Component: any, options: any) => {
        const ctor = 'default' in Component ? Component.default : Component;
        // The legacy constructor expects { target, props }
        const instance = new ctor({ target: options.target, props: options.props });
        return instance;
      };

      (SvelteMain as any).unmount = (component: any) => {
        try {
          component.$destroy?.();
        } catch {
          // ignore
        }
      };

      (SvelteMain as any).flushSync = (fn?: () => void) => {
        if (typeof fn === 'function') {
          try {
            fn();
          } catch {
            // ignore
          }
        }
      };

      (SvelteMain as any).tick = () => Promise.resolve();
    }
  } catch {
    // ignore - shim is best-effort for test environments
  }
})();
