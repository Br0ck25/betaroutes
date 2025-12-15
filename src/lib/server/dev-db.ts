// src/lib/server/dev-db.ts

// This variable lives outside the functions, so it persists!
const globalStore: Record<string, string> = {};

export const devKV = {
    get: async (key: string) => {
        return globalStore[key] || null;
    },
    put: async (key: string, value: string, options?: any) => {
        globalStore[key] = value;
        // console.log(`[DevDB] Wrote ${key}`); // Uncomment to debug writes
    },
    delete: async (key: string) => {
        delete globalStore[key];
    },
    list: async (options?: { prefix?: string }) => {
        const prefix = options?.prefix || '';
        const keys = Object.keys(globalStore)
            .filter(k => k.startsWith(prefix))
            .map(name => ({ name }));
        return { keys };
    }
};