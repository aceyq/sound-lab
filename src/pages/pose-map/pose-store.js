// Recordings for Motion Morph (the pose map), kept in this browser only:
// the raw Float32 samples go to their own IndexedDB database so "▶ Original"
// still works after a reload. The project itself (names, analyses, poses,
// takes, range) is in localStorage (index.js). Every call reports failure
// instead of throwing, because private windows can block storage.

const DB_NAME = 'pose-map';
const STORE = 'recordings';

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let result;
    const req = fn(t.objectStore(STORE));
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed'));
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  }));
}

export async function putRecording(rec) {
  try {
    const { samples, ...meta } = rec;
    await tx('readwrite', (s) => s.put({ ...meta, pcm: samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

export async function deleteRecording(id) {
  try { await tx('readwrite', (s) => s.delete(id)); return { ok: true }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

export async function loadRecordings() {
  try {
    const rows = (await tx('readonly', (s) => s.getAll())) || [];
    return { ok: true, list: rows.map(({ pcm, ...meta }) => ({ ...meta, samples: new Float32Array(pcm) })) };
  } catch (e) {
    return { ok: false, list: [], error: String((e && e.message) || e) };
  }
}
