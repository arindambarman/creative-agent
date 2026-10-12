// Where generated and imported images live.
//
// The picture data goes in IndexedDB, which holds megabytes comfortably; only a short record
// of each image is kept with the project, so projects stay small in localStorage and Supabase.
// Images never leave the browser: they are not uploaded anywhere.

const DB_NAME = 'creative-agent-assets';
const STORE = 'images';
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('This browser blocked image storage. Check that site data is allowed.'));
  });
  return dbPromise;
}

function run(mode, work) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Image storage failed.'));
  }));
}

export const putImage = (id, dataUrl) => run('readwrite', store => store.put({ id, dataUrl }));
export const getImage = id => run('readonly', store => store.get(id)).then(row => row?.dataUrl || null);
export const deleteImage = id => run('readwrite', store => store.delete(id));

// The record kept with the project. `id` points at the picture in IndexedDB.
export function assetRecord({ id, frame, variant, name, source, model, cost, bytes }) {
  return {
    id,
    frame,
    variant,                       // 'full' or 'plate'
    name: name || `Frame ${frame}`,
    source,                        // 'generated' or 'imported'
    model: model || null,
    cost: cost || 0,
    bytes: bytes || 0,
    created: Date.now()
  };
}

export const assetsForFrame = (assets, frame, variant) =>
  (assets || []).filter(a => a.frame === frame && (!variant || a.variant === variant));

// One line per image for the later phases, so Deliver and Publish know what exists.
export function assetSummary(assets) {
  if (!assets?.length) return '';
  const byFrame = new Map();
  for (const a of assets) {
    const key = `${a.frame}|${a.name}`;
    if (!byFrame.has(key)) byFrame.set(key, []);
    byFrame.get(key).push(a);
  }
  const lines = [...byFrame.entries()].map(([key, list]) => {
    const [frame, name] = key.split('|');
    const made = list.map(a => `${a.variant === 'plate' ? 'scene plate' : 'full scene'} (${a.source})`).join(', ');
    return `- Frame ${frame} ${name}: ${made}`;
  });
  return lines.join('\n');
}

export const totalAssetCost = assets => (assets || []).reduce((n, a) => n + (a.cost || 0), 0);
