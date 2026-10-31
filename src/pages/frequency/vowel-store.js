// Browser storage for the Vowel Lab. Everything stays on this computer, in
// this browser; nothing is uploaded.
//
//   experiments (settings + notes) → localStorage (small JSON)
//   recordings (raw samples)       → IndexedDB (a few hundred KB each)
//
// Both can fail (private windows, blocked site data, full disk) or be cleared
// by the browser at any time, so every call reports whether it worked and the
// page tells you to download files you want to keep.

const EXP_KEY = 'frequencyPlayground.vowelLab.experiments.v1';
const DB_NAME = 'frequency-playground-vowel-lab';
const STORE = 'recordings';

export function loadExperiments() {
  try {
    const raw = localStorage.getItem(EXP_KEY);
    if (!raw) return { ok: true, list: [] };
    const list = JSON.parse(raw);
    return { ok: true, list: Array.isArray(list) ? list : [] };
  } catch (e) {
    return { ok: false, list: [], error: String(e && e.message || e) };
  }
}

export function saveExperiments(list) {
  try {
    localStorage.setItem(EXP_KEY, JSON.stringify(list));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// Vowel filtering experiments (assignment 4) have their own key, so saving
// one can never overwrite or reshape the manual and automatic experiments.
const FILTER_KEY = 'frequencyPlayground.vowelLab.filterExperiments.v1';

export function loadFilterExperiments() {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return { ok: true, list: [] };
    const list = JSON.parse(raw);
    return { ok: true, list: Array.isArray(list) ? list : [] };
  } catch (e) {
    return { ok: false, list: [], error: String(e && e.message || e) };
  }
}

export function saveFilterExperiments(list) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(list));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

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
    const store = t.objectStore(STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed'));
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  }));
}

/** Stores a recording ({ id, name, sampleRate, samples: Float32Array, ... }). */
export async function putRecording(rec) {
  try {
    const { samples, ...meta } = rec;
    await tx('readwrite', (s) => s.put({ ...meta, pcm: samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

export async function deleteRecording(id) {
  try {
    await tx('readwrite', (s) => s.delete(id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

export async function loadRecordings() {
  try {
    const rows = (await tx('readonly', (s) => s.getAll())) || [];
    const list = rows.map(({ pcm, ...meta }) => ({ ...meta, samples: new Float32Array(pcm) }));
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return { ok: true, list };
  } catch (e) {
    return { ok: false, list: [], error: String(e && e.message || e) };
  }
}
