import { CATALOG_KEY, defaultCatalog } from "../src/feed-store";

export interface KvPut {
  key: string;
  value: string;
  options?: { expirationTtl?: number };
}

export const memoryKv = (articles: Record<string, string | null> = {}) => {
  const store = new Map<string, string>();
  store.set(CATALOG_KEY, JSON.stringify(defaultCatalog()));
  for (const [key, value] of Object.entries(articles)) {
    if (value !== null) {
      store.set(key, value);
    }
  }
  const puts: KvPut[] = [];
  const kv = {
    get: async (key: string | string[]) => {
      if (Array.isArray(key)) {
        return new Map(
          key.map((item) => {
            return [item, store.get(item) ?? null] as const;
          }),
        );
      }
      return store.get(key) ?? null;
    },
    put: async (
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ) => {
      puts.push({ key, value, options });
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
  return { store, puts, kv };
};
