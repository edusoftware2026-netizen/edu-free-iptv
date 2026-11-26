/* Persistencia de catalogos en IndexedDB.
   localStorage no sirve para listas de miles de elementos.
*/

const DB_NAME = 'freeiptv_db';
const DB_VERSION = 1;
const STORE = 'catalogs';

let dbPromise = null;
const memory = new Map();

function hasIdb() {
  try { return !!window.indexedDB; } catch (_) { return false; }
}

function open() {
  if (!hasIdb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB error'));
  }).catch((err) => {
    console.warn('DB: IndexedDB no disponible, usando memoria', err);
    return null;
  });
  return dbPromise;
}

function keyOf(profileId, kind) {
  return `${profileId}:${kind}`;
}

async function request(mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(STORE, mode);
    } catch (err) {
      reject(err);
      return;
    }
    const store = tx.objectStore(STORE);
    let req;
    try {
      req = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(req?.result ?? null);
    tx.onerror = () => reject(tx.error || new Error('DB transaction error'));
    tx.onabort = () => reject(tx.error || new Error('DB transaction aborted'));
  });
}

export const DB = {
  async getCatalog(profileId, kind = 'all') {
    const key = keyOf(profileId, kind);
    try {
      const row = await request('readonly', (s) => s.get(key));
      if (row && row.data) return row;
    } catch (err) {
      console.warn('DB get', err);
    }
    return memory.get(key) || null;
  },

  async putCatalog(profileId, kind, data) {
    const row = {
      key: keyOf(profileId, kind),
      profileId,
      kind,
      data,
      updatedAt: Date.now(),
    };
    memory.set(row.key, row);
    try {
      await request('readwrite', (s) => s.put(row));
    } catch (err) {
      console.warn('DB put', err);
    }
    return row;
  },

  async deleteProfile(profileId) {
    const kinds = ['all', 'live', 'movies', 'series', 'epg'];
    for (const kind of kinds) {
      const key = keyOf(profileId, kind);
      memory.delete(key);
      try {
        await request('readwrite', (s) => s.delete(key));
      } catch (_) {}
    }
  },

  async clearAll() {
    memory.clear();
    try {
      await request('readwrite', (s) => s.clear());
    } catch (_) {}
  },

  async usage() {
    try {
      if (navigator.storage?.estimate) return await navigator.storage.estimate();
    } catch (_) {}
    return null;
  },

  async persist() {
    try {
      if (navigator.storage?.persist) return await navigator.storage.persist();
    } catch (_) {}
    return false;
  },
};

export default DB;
