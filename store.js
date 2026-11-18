/* store.js — stockage local : clips (IndexedDB) et réglages (localStorage).
   Compatible avec la v1 : même base « viceclip », même table « clips ». */

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('viceclip', 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('clips')) r.result.createObjectStore('clips', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Base bloquée : ferme les autres onglets ViceClip.'));
  });
  return dbp;
}
async function run(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction('clips', mode);
    const req = fn(tx.objectStore('clips'));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Transaction annulée'));
  });
}

/* Complète les clips créés par la v1 avec les nouveaux champs */
export function normalizeClip(c) {
  return {
    favorite: false, format: 'original', fit: 'crop', tags: [],
    title: 'Clip', thumb: '', duration: 0, size: c.blob ? c.blob.size : 0,
    type: (c.blob && c.blob.type) || 'video/mp4', createdAt: Date.now(),
    ...c,
  };
}

export const Clips = {
  all: async () => (await run('readonly', s => s.getAll())).map(normalizeClip),
  put: c => run('readwrite', s => s.put(c)),
  del: id => run('readwrite', s => s.delete(id)),
  clear: () => run('readwrite', s => s.clear()),
};

/* ---------- Réglages ---------- */
export const DEFAULT_SETTINGS = {
  creatorName: '',
  format: '9:16',        // original | 9:16 | 1:1 | 16:9
  fit: 'crop',           // crop | blur | fit
  resolution: 1080,      // 720 | 1080 (côté court)
  quality: 'high',       // standard | high
  clipLength: 30,        // longueur des clips proposés par l'analyse (s)
  suggestions: 6,        // nombre de moments proposés
};
const KEY = 'viceclip.settings.v2';
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch (e) { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
}

export async function storageInfo() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { usage: e.usage || 0, quota: e.quota || 0, persisted };
  } catch (e) { return null; }
}
export async function requestPersist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
  catch (e) { return false; }
}
