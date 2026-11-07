// js/idb-cache.js
// Almacenamiento persistente basado en IndexedDB con soporte para grandes volúmenes de datos.
// Supera el límite estricto de 5MB de localStorage y evita errores de cuota (QuotaExceededError).

const DB_NAME = 'VidriosExitoCacheDB';
const DB_VERSION = 1;
const STORE_NAME = 'key_val_cache';

let dbPromise = null;
const memoryFallback = new Map();

function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
            return reject(new Error('IndexedDB no soportado en este navegador.'));
        }

        try {
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    try { db.close(); } catch {}
                    dbPromise = null;
                };
                resolve(db);
            };

            request.onerror = () => {
                console.warn('[IDB] Error abriendo base de datos IndexedDB:', request.error);
                reject(request.error);
            };

            request.onblocked = () => {
                console.warn('[IDB] Base de datos IndexedDB bloqueada por otra pestaña.');
            };
        } catch (err) {
            reject(err);
        }
    }).catch(err => {
        dbPromise = null;
        throw err;
    });

    return dbPromise;
}

/**
 * Obtiene un valor desde IndexedDB. Si no existe, revisa si hay datos en localStorage
 * para migrarlos automáticamente y liberar la cuota de localStorage.
 */
export async function getCache(key) {
    // 1. Intentar obtener desde IndexedDB
    try {
        const db = await openDatabase();
        const value = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
            req.onerror = () => reject(req.error);
        });

        if (value !== null && value !== undefined) {
            // Limpieza pasiva de localStorage para asegurar cuota libre
            try { localStorage.removeItem(key); } catch {}
            return value;
        }
    } catch (idbErr) {
        console.warn(`[IDB] No se pudo leer '${key}' desde IndexedDB:`, idbErr);
    }

    // 2. Si no estaba en IndexedDB, migrar datos preexistentes en localStorage
    try {
        const rawLS = localStorage.getItem(key);
        if (rawLS) {
            try {
                const parsed = JSON.parse(rawLS);
                // Guardar en IndexedDB y liberar de inmediato el localStorage
                setCache(key, parsed).catch(() => {});
                try { localStorage.removeItem(key); } catch {}
                return parsed;
            } catch {
                try { localStorage.removeItem(key); } catch {}
            }
        }
    } catch {}

    // 3. Fallback de memoria volátil
    return memoryFallback.get(key) ?? null;
}

/**
 * Guarda un valor en IndexedDB. No sufre del límite de 5MB de localStorage.
 */
export async function setCache(key, value) {
    memoryFallback.set(key, value);

    try {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });

        // Al guardar con éxito en IndexedDB, aseguramos que localStorage no esté saturado
        try { localStorage.removeItem(key); } catch {}
        return true;
    } catch (idbErr) {
        console.warn(`[IDB] No se pudo guardar '${key}' en IndexedDB:`, idbErr);

        // Fallback defensivo a localStorage con captura de error para no quebrar la app
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (lsErr) {
            console.warn(`[Storage] Cuota de almacenamiento excedida en localStorage para '${key}'. Se mantiene en memoria.`);
            return false;
        }
    }
}

/**
 * Elimina una entrada tanto de IndexedDB como de localStorage.
 */
export async function removeCache(key) {
    memoryFallback.delete(key);
    try {
        localStorage.removeItem(key);
    } catch {}

    try {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (idbErr) {
        console.warn(`[IDB] Error al eliminar '${key}' de IndexedDB:`, idbErr);
    }
}
