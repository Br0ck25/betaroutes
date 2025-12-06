export function createMockKV() {
  const store = new Map();

  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix }) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix));
      return {
        keys: keys.map(name => ({ name }))
      };
    }
  };
}
