// IndexedDB toi gian (origin cua extension):
//   kv     : thu muc goc (FileSystemDirectoryHandle), job dang chay, cai dat
//   parsed : ket qua parseFile() theo "<ngay>/<ten file>" -> xu ly khong can doc lai HTML
//   images : "<ngay>/<id>" da tai anh (dung cho che do Downloads)

const DB_NAME = "shopee-crawler";
const STORES = ["kv", "parsed", "images"];
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const get = (store, key) => tx(store, "readonly", (s) => s.get(key));
export const put = (store, key, value) => tx(store, "readwrite", (s) => s.put(value, key));
export const del = (store, key) => tx(store, "readwrite", (s) => s.delete(key));

/** Moi value co key bat dau bang prefix. */
export function getByPrefix(store, prefix) {
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
  return tx(store, "readonly", (s) => s.getAll(range));
}

export function keysByPrefix(store, prefix) {
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
  return tx(store, "readonly", (s) => s.getAllKeys(range));
}
