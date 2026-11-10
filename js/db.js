// IndexedDB storage. All data lives only in this browser on this computer.
const DB_NAME = 'laolao-memoir';
const STORES = ['kv', 'sessions', 'turns', 'audio', 'timeline', 'chapters'];
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const db = {
  async all(name) { return wrap((await store(name)).getAll()); },
  async get(name, id) { return wrap((await store(name)).get(id)); },
  async put(name, value) { return wrap((await store(name, 'readwrite')).put(value)); },
  async del(name, id) { return wrap((await store(name, 'readwrite')).delete(id)); },
  async clear(name) { return wrap((await store(name, 'readwrite')).clear()); },
  async getKV(key, fallback = null) { return (await this.get('kv', key))?.value ?? fallback; },
  async setKV(key, value) { return this.put('kv', { key, value }); },
  /** Ask the browser not to evict our data under storage pressure. */
  async persist() {
    try { return await navigator.storage?.persist?.(); } catch { return false; }
  },
};

export { STORES };
