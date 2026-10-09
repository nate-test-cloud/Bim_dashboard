/** Local persistence: localStorage for settings/scenarios, IndexedDB for model blobs. */

const SETTINGS_KEY = 'bim-sustainability-project-v1';

export interface PersistedProject {
  projectName: string;
  env: unknown;
  design: unknown;
  scenarios: unknown;
  modelMeta: unknown;
  euiTarget: unknown;
  savedAt: string;
}

export function saveProject(p: Omit<PersistedProject, 'savedAt'>): void {
  const payload: PersistedProject = { ...p, savedAt: new Date().toISOString() };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

export function loadProject(): PersistedProject | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedProject;
  } catch {
    return null;
  }
}

export function clearProject(): void {
  localStorage.removeItem(SETTINGS_KEY);
}

// --- IndexedDB for larger model files --------------------------------------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('bim-sustainability-db', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('models');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key: string, value: Blob | string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite');
    tx.objectStore('models').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet(key: string): Promise<Blob | string | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readonly');
    const req = tx.objectStore('models').get(key);
    req.onsuccess = () => resolve(req.result as Blob | string | undefined);
    req.onerror = () => reject(req.error);
  });
}
