/**
 * C1.5 — where the start cache lives on the device: IndexedDB database `zaki-chat-<userId>`, one object store `kv` of small JSON texts
 * (`meta`, `list`, `cursor`, `conv:<id>`; every write replaces ALL of them in one transaction, so what is on the device is always ONE
 * tab's consistent snapshot, never a mix of two tabs'). The pattern of `src/lib/chat/outbox/storage.ts`: IndexedDB first, every access inside
 * try/catch, and NOTHING when the browser refuses (a private window, a blocked profile) — there is no localStorage fallback on
 * purpose: message text must not land in a store that has no per-person database to delete.
 *
 * ⚠️ MESSAGE TEXT IS KEPT ON THE DEVICE (C1.5). 🔧 `wipeChatCache()` (wipe.ts) deletes every `zaki-chat-*` database of this browser:
 * at sign-out (both client logout paths), when the stream says «signed out», when a different person signs in, and from the
 * «امسح ذاكرة المحادثات» button of C4. An external partner's (guest) messages are never written at all (`runtime.ts`).
 *
 * This file knows nothing of the chat or of TanStack Query: it is the adapter and the wipe, small enough to load from a logout button.
 */

export const DEVICE_DB_PREFIX = "zaki-chat-";
export const DEVICE_MARKER_KEY = "zaki-chat-cache-user";
const STORE = "kv";
const DELETE_WAIT_MS = 1_500;
const EMPTY_WAIT_MS = 1_500;

export function deviceDbName(userId: string): string {
  return `${DEVICE_DB_PREFIX}${userId}`;
}

/** One person's start cache: read everything, or replace everything. */
export interface StartStore {
  readAll(): Promise<Record<string, string>>;
  /** Empties the store and writes `records` in ONE transaction: a reader (another tab, the next page) sees the old copy or the new one, never half of each. */
  replaceAll(records: Record<string, string>): Promise<void>;
}

/** In memory: tests, and the shape every adapter must keep. */
export function memoryStartStore(initial: Record<string, string> = {}): StartStore & { dump(): Record<string, string> } {
  let map = new Map(Object.entries(initial));
  return {
    readAll: async () => Object.fromEntries(map),
    replaceAll: async (records) => {
      map = new Map(Object.entries(records));
    },
    dump: () => Object.fromEntries(map),
  };
}

function browserFactory(): IDBFactory | null {
  try {
    if (typeof indexedDB === "undefined" || !indexedDB) return null;
    return indexedDB;
  } catch {
    return null;
  }
}

/** IndexedDB as a StartStore, or null when the browser has none. `factory` is for tests (a hand-made IDBFactory). */
export function indexedDbStartStore(userId: string, factory?: IDBFactory | null): StartStore | null {
  const idb = factory === undefined ? browserFactory() : factory;
  if (!idb) return null;
  const name = deviceDbName(userId);
  let opened: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(name, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        // another tab (or the wipe) wants to delete or upgrade this database: let go of it at once
        db.onversionchange = () => {
          db.close();
          opened = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        opened = null;
        reject(req.error ?? new Error("indexeddb"));
      };
      req.onblocked = () => {
        opened = null;
        reject(new Error("indexeddb-blocked"));
      };
    });
    return opened;
  };
  const tx = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const db = await open();
    return new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = work(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error ?? new Error("indexeddb"));
      t.onabort = () => reject(t.error ?? new Error("indexeddb-abort"));
    });
  };
  return {
    readAll: async () => {
      const db = await open();
      return new Promise<Record<string, string>>((resolve, reject) => {
        const t = db.transaction(STORE, "readonly");
        const store = t.objectStore(STORE);
        const keys = store.getAllKeys();
        const values = store.getAll();
        t.oncomplete = () => {
          const out: Record<string, string> = {};
          (keys.result as IDBValidKey[]).forEach((k, i) => {
            const v = (values.result as unknown[])[i];
            if (typeof k === "string" && typeof v === "string") out[k] = v;
          });
          resolve(out);
        };
        t.onerror = () => reject(t.error ?? new Error("indexeddb"));
        t.onabort = () => reject(t.error ?? new Error("indexeddb-abort"));
      });
    },
    replaceAll: async (records) => {
      await tx("readwrite", (s) => {
        s.clear();
        for (const [k, v] of Object.entries(records)) s.put(v, k);
      });
    },
  };
}

/** `deleteDatabase`, never rejecting and never hanging: a database held open by another tab is deleted as soon as that tab lets go. */
export function deleteDatabase(idb: IDBFactory, name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      resolve();
    };
    try {
      const req = idb.deleteDatabase(name);
      req.onsuccess = finish;
      req.onerror = finish;
      req.onblocked = () => void timers.push(setTimeout(finish, DELETE_WAIT_MS));
      timers.push(setTimeout(finish, DELETE_WAIT_MS * 2));
    } catch {
      finish();
    }
  });
}

/** The start-cache databases this browser holds (`indexedDB.databases()`, where the browser has it). */
export async function listDeviceDatabases(factory?: IDBFactory | null): Promise<string[]> {
  const idb = factory === undefined ? browserFactory() : factory;
  try {
    const list = await (idb as (IDBFactory & { databases?: () => Promise<{ name?: string }[]> }) | null)?.databases?.();
    return (list ?? []).map((d) => d.name ?? "").filter((n) => n.startsWith(DEVICE_DB_PREFIX));
  } catch {
    return [];
  }
}

// ───────────────────────────────────────── whose cache is on this device ─────────────────────────────────────────

function localStore(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The person whose start cache this device holds (an id, nothing else), or null. Where localStorage is refused, `databases()` answers instead. */
export function readDeviceMarker(): string | null {
  try {
    return localStore()?.getItem(DEVICE_MARKER_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Can the marker be read at all? (localStorage may be refused: then «no marker» says nothing, and a missing one is not a sign of a wipe.) */
export function deviceMarkerAvailable(): boolean {
  try {
    localStore()?.getItem(DEVICE_MARKER_KEY);
    return localStore() !== null;
  } catch {
    return false;
  }
}

export function writeDeviceMarker(userId: string): void {
  try {
    localStore()?.setItem(DEVICE_MARKER_KEY, userId);
  } catch {
    /* refused: databases() still finds the cache */
  }
}

export function clearDeviceMarker(): void {
  try {
    localStore()?.removeItem(DEVICE_MARKER_KEY);
  } catch {
    /* refused */
  }
}

/**
 * Whose start caches this device holds: the person the marker names and the owners of every `zaki-chat-*` database the browser lists.
 * The databases themselves are the truth (the marker lives in a different store and can be lost on its own). A browser that can neither
 * list its databases nor keep the marker cannot say; such a browser (an old one in a private window) does not keep the copy past the window either.
 */
export async function deviceOwners(factory?: IDBFactory | null): Promise<{ owners: Set<string> }> {
  const idb = factory === undefined ? browserFactory() : factory;
  const owners = new Set<string>();
  const marker = readDeviceMarker();
  if (marker) owners.add(marker);
  for (const name of await listDeviceDatabases(idb)) owners.add(name.slice(DEVICE_DB_PREFIX.length));
  return { owners };
}

/** Does this device hold a start cache of anybody? (Cheap: the marker, then the database list.) */
export async function deviceHoldsCache(factory?: IDBFactory | null): Promise<boolean> {
  if (readDeviceMarker()) return true;
  return (await listDeviceDatabases(factory)).length > 0;
}

/**
 * Deletes the start cache of EVERY person this browser knows (the databases it lists, the one the marker names, and `also`), and the
 * marker. Never throws; waits at most a few seconds when another tab holds a database open (it is emptied first, so nothing is
 * left to read meanwhile).
 */
export async function deleteDeviceCaches(opts: { also?: string[]; factory?: IDBFactory | null } = {}): Promise<void> {
  const idb = opts.factory === undefined ? browserFactory() : opts.factory;
  const marker = readDeviceMarker();
  clearDeviceMarker();
  if (!idb) return;
  const names = new Set<string>(await listDeviceDatabases(idb));
  if (marker) names.add(deviceDbName(marker));
  for (const id of opts.also ?? []) names.add(deviceDbName(id));
  await Promise.all(
    [...names].map(async (name) => {
      // empty it first: a database a frozen tab holds open cannot be deleted until that tab lets go, but nothing readable stays in it
      await withTimeout(indexedDbStartStore(name.slice(DEVICE_DB_PREFIX.length), idb)?.replaceAll({}), EMPTY_WAIT_MS).catch(() => undefined);
      await deleteDatabase(idb, name);
    }),
  );
}

/** `promise`, or nothing after `ms` (never rejects on the timer, and clears it). */
function withTimeout(promise: Promise<unknown> | undefined, ms: number): Promise<void> {
  if (!promise) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
