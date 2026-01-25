// Minimal indexedDB shim for Vitest (prevents ReferenceError during background hydration)
// This file exists solely for unit tests where persistent storage is irrelevant — it provides
// minimal, no-op implementations of IndexedDB types so the `idb` wrapper does not throw during
// background hydration. See `AI_AGENTS.md` and `SECURITY.md`: tests must not access real storage.
// Keep intentionally tiny and test-only; do NOT use in production or as a model for real DB access.

if (typeof global !== 'undefined' && !(global as any).indexedDB) {
	// @ts-ignore - intentional global shim for tests
	(global as any).indexedDB = {
		open: () => {
			// Return an actual IDBOpenDBRequest instance if available so idb recognizes it.
			const Ctor = (global as any).IDBOpenDBRequest || (global as any).IDBRequest || class {};
			const req: any = new Ctor();
			req.onupgradeneeded = null;
			req.onsuccess = null;
			req.onerror = null;
			req.addEventListener = () => {};
			req.removeEventListener = () => {};
			return req;
		}
	};
}

// Provide minimal IDB request constructor used by the idb wrapper
if (typeof global !== 'undefined' && !(global as any).IDBRequest) {
	// @ts-ignore - intentional global shim for tests
	(global as any).IDBRequest = class IDBRequest {};
}

// Minimal IDBTransaction stub used by idb's transformation logic
if (typeof global !== 'undefined' && !(global as any).IDBTransaction) {
	// @ts-ignore - intentional global shim for tests
	(global as any).IDBTransaction = class IDBTransaction {};
}

// Minimal IDBDatabase stub used to avoid runtime checks in idb
if (typeof global !== 'undefined' && !(global as any).IDBDatabase) {
	// @ts-ignore - intentional global shim for tests
	(global as any).IDBDatabase = class IDBDatabase {};
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
	if (typeof global !== 'undefined' && !(global as any)[t]) {
		// @ts-ignore - intentional global shim for tests
		(global as any)[t] = class {};
	}
	if (typeof globalThis !== 'undefined' && !(globalThis as any)[t]) {
		// @ts-ignore
		(globalThis as any)[t] = (global as any)[t];
	}
}

// Ensure IDBOpenDBRequest inherits from IDBRequest so `instanceof IDBRequest` checks work
if (typeof global !== 'undefined') {
	const g: any = global as any;
	if (
		g.IDBRequest &&
		(!g.IDBOpenDBRequest || !(g.IDBOpenDBRequest.prototype instanceof g.IDBRequest))
	) {
		// @ts-ignore - create proper subclass for tests
		g.IDBOpenDBRequest = class IDBOpenDBRequest extends g.IDBRequest {};
		if (!g.IDBOpenDBRequest.prototype.addEventListener) {
			// @ts-ignore
			g.IDBOpenDBRequest.prototype.addEventListener = function () {};
		}
	}
}
if (typeof globalThis !== 'undefined') {
	const gt: any = globalThis as any;
	if (
		gt.IDBRequest &&
		(!gt.IDBOpenDBRequest || !(gt.IDBOpenDBRequest.prototype instanceof gt.IDBRequest))
	) {
		// @ts-ignore
		gt.IDBOpenDBRequest = class IDBOpenDBRequest extends gt.IDBRequest {};
		if (!gt.IDBOpenDBRequest.prototype.addEventListener) {
			// @ts-ignore
			gt.IDBOpenDBRequest.prototype.addEventListener = function () {};
		}
	}
}

// Also guard globalThis for environments that reference it directly
if (typeof globalThis !== 'undefined' && !(globalThis as any).indexedDB) {
	// @ts-ignore
	(globalThis as any).indexedDB = (global as any).indexedDB;
	// @ts-ignore
	(globalThis as any).IDBRequest = (global as any).IDBRequest;
}
