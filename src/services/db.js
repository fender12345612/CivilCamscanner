import { openDB } from 'idb';

const DB_NAME = 'CivilCamscannerDB';
const DB_VERSION = 1;
const PAGES_STORE = 'pages';
const META_STORE = 'metadata';

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(PAGES_STORE)) {
        const store = db.createObjectStore(PAGES_STORE, { keyPath: 'id' });
        store.createIndex('order', 'order', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    },
  });
}

export async function getAllPages() {
  const db = await getDB();
  const pages = await db.getAll(PAGES_STORE);
  return pages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function savePage(page) {
  const db = await getDB();
  await db.put(PAGES_STORE, page);
  return page;
}

export async function saveAllPagesOrder(pages) {
  const db = await getDB();
  const tx = db.transaction(PAGES_STORE, 'readwrite');
  for (let i = 0; i < pages.length; i++) {
    const updated = { ...pages[i], order: i };
    tx.store.put(updated);
  }
  await tx.done;
}

export async function deletePageById(id) {
  const db = await getDB();
  await db.delete(PAGES_STORE, id);
}

export async function clearAllPages() {
  const db = await getDB();
  await db.clear(PAGES_STORE);
}

export async function getDocMeta(key, defaultValue = '') {
  const db = await getDB();
  const entry = await db.get(META_STORE, key);
  return entry ? entry.value : defaultValue;
}

export async function setDocMeta(key, value) {
  const db = await getDB();
  await db.put(META_STORE, { key, value });
}
