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
