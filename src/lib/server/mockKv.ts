// src/lib/server/mockKv.ts

// [!code fix] Global store for persistence across function calls
const globalStores = new Map<string, Map<string, any>>();

export function createMockKV(namespace = 'default') {
  // Initialize namespace if missing
  if (!globalStores.has(namespace)) {
    globalStores.set(namespace, new Map());
  }
  const store = globalStores.get(namespace)!;

  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: any) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix }: { prefix?: string } = {}) {
      const keys = [...store.keys()]
        .filter(k => !prefix || k.startsWith(prefix))
        .map(name => ({ name }));
      return { keys };
    }
  };
}