import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { applySync, seedFromDevice } from "@/lib/chat/cache/writer";
import { listenForWipe } from "@/lib/chat/cache/registry";
import {
  buildSnapshot,
  DEVICE_CONVERSATIONS,
  DEVICE_FORMAT,
  DEVICE_MESSAGES,
  loadDevice,
  markConversationOpened,
  parseDevice,
  serializeSnapshot,
  StartCachePersister,
  storableMessage,
  type PersisterDeps,
} from "@/lib/chat/cache/persist";
import {
  DEVICE_DB_PREFIX,
  DEVICE_MARKER_KEY,
  deviceDbName,
  deviceHoldsCache,
  indexedDbStartStore,
  listDeviceDatabases,
  memoryStartStore,
  readDeviceMarker,
} from "@/lib/chat/cache/device-store";
import { installChatRuntime, type RuntimeDeps } from "@/lib/chat/cache/runtime";
import { wipeChatCache } from "@/lib/chat/cache/wipe";
import { onChatWipe } from "@/lib/chat/cache/registry";
import { LATEST, type ChatListDto, type ChatRowDto, type MessageDto, type MessagesData, type MessagesPageDto, type SyncAnswer } from "@/lib/chat/cache/types";

// ───────────────────────────────────────── a browser's storage, made by hand ─────────────────────────────────────────

/** A hand-made IDBFactory: databases with one object store, connections that hear `versionchange`, `databases()`. */
function fakeIdb(opts: { blockDelete?: boolean } = {}) {
  const stores = new Map<string, Map<string, unknown>>();
  const conns = new Map<string, Set<{ onversionchange?: (() => void) | null; close(): void }>>();
  const later = (fn: () => void) => void setTimeout(fn, 0);
  const factory = {
    open(name: string) {
      const req: Record<string, unknown> & { result?: unknown } = { error: null };
      later(() => {
        const fresh = !stores.has(name);
        if (fresh) stores.set(name, new Map());
        const content = stores.get(name)!;
        const db = {
          objectStoreNames: { contains: () => !fresh },
          createObjectStore: () => undefined,
          onversionchange: null as (() => void) | null,
          close() {
            conns.get(name)?.delete(db);
          },
          transaction() {
            const tx: Record<string, unknown> = { error: null };
            const store = {
              put: (v: unknown, k: string) => (content.set(k, v), { result: k }),
              delete: (k: string) => (content.delete(k), { result: undefined }),
              clear: () => (content.clear(), { result: undefined }),
              getAll: () => ({ get result() { return [...content.values()]; } }),
              getAllKeys: () => ({ get result() { return [...content.keys()]; } }),
            };
            tx["objectStore"] = () => store;
            later(() => (tx["oncomplete"] as (() => void) | undefined)?.());
            return tx;
          },
        };
        (conns.get(name) ?? conns.set(name, new Set()).get(name)!).add(db);
        req.result = db;
        if (fresh) (req["onupgradeneeded"] as (() => void) | undefined)?.();
        (req["onsuccess"] as (() => void) | undefined)?.();
      });
      return req;
    },
    deleteDatabase(name: string) {
      const req: Record<string, unknown> = {};
      later(() => {
        // a tab that is frozen and never lets go: the delete stays blocked
        if (opts.blockDelete) return void (req["onblocked"] as (() => void) | undefined)?.();
        for (const c of [...(conns.get(name) ?? [])]) c.onversionchange?.();
        stores.delete(name);
        (req["onsuccess"] as (() => void) | undefined)?.();
      });
      return req;
    },
    databases: async () => [...stores.keys()].map((name) => ({ name, version: 1 })),
  };
  return { factory: factory as unknown as IDBFactory, stores, names: () => [...stores.keys()] };
}

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
}

function manualTimers(): PersisterDeps & { pending(): number; run(): void } {
  const queue: Array<() => void> = [];
  return {
    setTimer: (fn) => {
      queue.push(fn);
      return fn;
    },
    clearTimer: (h) => {
      const i = queue.indexOf(h as () => void);
      if (i >= 0) queue.splice(i, 1);
    },
    now: () => Date.now(),
    pending: () => queue.length,
    run: () => void queue.splice(0).forEach((fn) => fn()),
  };
}

// ───────────────────────────────────────── data ─────────────────────────────────────────

const at = (n: number) => new Date(Date.UTC(2026, 10, 16, 10, 0, n)).toISOString();
const msg = (id: string, n: number, over: Partial<MessageDto> = {}): MessageDto => ({ id, kind: "TEXT", body: `نص سري ${id}`, deleted: false, edited: false, pinned: false, mine: false, authorId: "u2", authorName: "سلمى", createdAt: at(n), clientId: null, mentions: [], attachments: [], reactions: [], ...over });
const page = (messages: MessageDto[], over: Partial<MessagesPageDto> = {}): MessagesPageDto => ({ messages, hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [], ...over });
const data = (...pages: MessagesPageDto[]): MessagesData => ({ pages, pageParams: pages.map(() => LATEST) });
const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({ id, kind: "DM", title: `محادثة ${id}`, emoji: null, space: null, lastMessage: null, unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false, ...over });
const list = (...rows: ChatRowDto[]): ChatListDto => ({ scope: "all", spaceId: null, canOversee: false, rows });
const header = (id: string) => ({ id, kind: "DM", title: `محادثة ${id}`, emoji: null, closed: false, me: { canPost: true } }) as never;

function confirmed(qc: QueryClient, convs: Record<string, MessageDto[]>) {
  qc.setQueryData(chatKeys.list(), list(...Object.keys(convs).map((id) => row(id))));
  for (const [id, messages] of Object.entries(convs)) {
    qc.setQueryData(chatKeys.messages(id), data(page(messages)));
    qc.setQueryData(chatKeys.header(id), header(id));
  }
}

/** What the runtime does with the device copy: read it, and paint it as stale data; returns the cursor it was current to. */
async function hydrateFromDevice(qc: QueryClient, store: ReturnType<typeof memoryStartStore> | NonNullable<ReturnType<typeof indexedDbStartStore>>, userId: string): Promise<string | null> {
  const loaded = await loadDevice(store, userId);
  if (!loaded) return null;
  seedFromDevice(qc, { list: loaded.parsed.list, conversations: loaded.parsed.conversations });
  return loaded.parsed.cursor;
}

/** a change that makes a tab's snapshot differ (a new message) */
function qc2Touch(qc: QueryClient) {
  qc.setQueryData(chatKeys.messages("x"), data(page([msg("x1", 1), msg("x2", 2)])));
}

const persisterOf = (qc: QueryClient, store = memoryStartStore(), over: { ready?: boolean; current?: boolean; cursor?: string | null; cap?: number } = {}) => {
  const timers = manualTimers();
  const p = new StartCachePersister(qc, store, "u1", { cursor: () => (over.cursor === undefined ? "500" : over.cursor), ready: () => over.ready ?? true, deviceCurrent: () => over.current ?? false }, timers, over.cap);
  return { p, store, timers };
};

afterEach(() => vi.unstubAllGlobals());

// ───────────────────────────────────────── what is stored ─────────────────────────────────────────

describe("C1.5 — what the device keeps", () => {
  it("the list, the header and the LAST 50 messages of a conversation, and the cursor they are current to", async () => {
    const qc = new QueryClient();
    confirmed(qc, { c1: Array.from({ length: 80 }, (_, i) => msg(`m${i}`, i)) });
    const { p, store } = persisterOf(qc);
    await p.flush();
    const dump = store.dump();
    expect(Object.keys(dump).sort()).toEqual(["conv:c1", "cursor", "list", "meta"]);
    expect(dump["cursor"]).toBe("500");
    const conv = JSON.parse(dump["conv:c1"]!);
    expect(conv.messages).toHaveLength(DEVICE_MESSAGES);
    expect(conv.messages[0].id).toBe("m30");
    expect(conv.messages[49].id).toBe("m79");
    expect(conv.hasOlder).toBe(true);
    expect(conv.header.id).toBe("c1");
    expect(JSON.parse(dump["meta"]!)).toMatchObject({ v: DEVICE_FORMAT, userId: "u1" });
  });

  it("the 30 most recently OPENED conversations, no more", async () => {
    const qc = new QueryClient();
    const ids = Array.from({ length: 35 }, (_, i) => `c${i}`);
    confirmed(qc, Object.fromEntries(ids.map((id) => [id, [msg(`${id}-m`, 1)]])));
    ids.forEach((id, i) => markConversationOpened(id, 1_000 + i));
    const { p, store } = persisterOf(qc);
    await p.flush();
    const kept = Object.keys(store.dump()).filter((k) => k.startsWith("conv:")).map((k) => k.slice(5));
    expect(kept).toHaveLength(DEVICE_CONVERSATIONS);
    expect(new Set(kept)).toEqual(new Set(ids.slice(5)));
  });

  it("20 MB: past the cap the least recently opened goes first (the list, the cursor and the others stay)", () => {
    const qc = new QueryClient();
    confirmed(qc, { a: [msg("a1", 1)], b: [msg("b1", 1)], c: [msg("c1", 1)] });
    markConversationOpened("a", 10);
    markConversationOpened("b", 30);
    markConversationOpened("c", 20);
    const snap = buildSnapshot(qc, "7")!;
    const full = serializeSnapshot(snap, "u1", 1, 20 * 1024 * 1024);
    expect(Object.keys(full).filter((k) => k.startsWith("conv:")).sort()).toEqual(["conv:a", "conv:b", "conv:c"]);
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    const oneConv = bytes(full["conv:a"]!);
    const fixed = bytes(full["meta"]!) + bytes(full["list"]!) + bytes(full["cursor"]!);
    const tight = serializeSnapshot(snap, "u1", 1, fixed + oneConv * 2 + 5);
    expect(Object.keys(tight).filter((k) => k.startsWith("conv:")).sort()).toEqual(["conv:b", "conv:c"]); // «a» is the oldest-opened
    const tighter = serializeSnapshot(snap, "u1", 1, fixed + oneConv + 5);
    expect(Object.keys(tighter).filter((k) => k.startsWith("conv:"))).toEqual(["conv:b"]);
    expect(tighter["list"]).toBeDefined();
    expect(tighter["cursor"]).toBe("7");
  });

  it("a tombstone is stored WITHOUT text, whatever the cache held; a deleted message that came with text too; the owner-only extras never", async () => {
    const qc = new QueryClient();
    confirmed(qc, { c1: [msg("m1", 1), msg("m2", 2), msg("m3", 3, { history: [{ body: "نسخة قديمة", editedAt: at(1) }], notes: [{ id: "n", authorId: "u", authorName: "م", body: "ملاحظة المشرف", createdAt: at(1) }] })] });
    const { p, store } = persisterOf(qc);
    await p.flush();
    expect(store.dump()["conv:c1"]).toContain("نص سري m1");
    // the server tombstones m1: the next write replaces the stored text
    applySync(qc, { cursor: "501", messages: [msg("m1", 1, { deleted: true, body: null })], reads: [], delivered: [], rows: [], removed: [] } as SyncAnswer);
    await p.flush();
    const text = store.dump()["conv:c1"]!;
    expect(text).not.toContain("نص سري m1");
    expect(JSON.parse(text).messages[0]).toMatchObject({ id: "m1", deleted: true, body: null, attachments: [], reactions: [] });
    // a deleted message that still carries its text in memory is stored as a tombstone anyway
    expect(storableMessage(msg("m9", 9, { deleted: true, body: "ما لازم ينحفظ" })).body).toBeNull();
    expect(text).not.toMatch(/نسخة قديمة|ملاحظة المشرف/);
    expect(text).toContain("نص سري m2");
  });

  it("nothing is written before the feed has answered once, or before the list is confirmed, or without a cursor", async () => {
    const qc = new QueryClient();
    confirmed(qc, { c1: [msg("m1", 1)] });
    const a = persisterOf(qc, memoryStartStore(), { ready: false });
    await a.p.flush();
    expect(a.store.dump()).toEqual({});
    const b = persisterOf(qc, memoryStartStore(), { cursor: null });
    await b.p.flush();
    expect(b.store.dump()).toEqual({});
    const empty = new QueryClient();
    const c = persisterOf(empty);
    await c.p.flush();
    expect(c.store.dump()).toEqual({});
  });

  it("data that came from the device is written again only once the feed has caught up from its cursor; data a reset made stale never", async () => {
    const qc = new QueryClient();
    seedFromDevice(qc, { list: list(row("c1")), conversations: [{ id: "c1", header: null, messages: [msg("m1", 1)], hasOlder: false, readers: [] }] });
    const notCurrent = persisterOf(qc, memoryStartStore(), { current: false });
    await notCurrent.p.flush();
    expect(notCurrent.store.dump()).toEqual({});
    const current = persisterOf(qc, memoryStartStore(), { current: true });
    await current.p.flush();
    expect(Object.keys(current.store.dump()).sort()).toEqual(["conv:c1", "cursor", "list", "meta"]);
    // a reset marks everything stale: the next write drops the window instead of renewing it
    await qc.invalidateQueries({ queryKey: chatKeys.all(), refetchType: "none" });
    qc.setQueryData(chatKeys.list(), list(row("c1"))); // the list is confirmed again, the window is not
    await current.p.flush();
    expect(Object.keys(current.store.dump())).not.toContain("conv:c1");
    expect(Object.keys(current.store.dump())).toContain("list");
  });

  it("each write is the WHOLE snapshot in one transaction (one tab's list, cursor and conversations belong together), and nothing at all when nothing changed", async () => {
    const qc = new QueryClient();
    confirmed(qc, { c1: [msg("m1", 1)], c2: [msg("m2", 1)] });
    const store = memoryStartStore();
    const replace = vi.spyOn(store, "replaceAll");
    const { p } = persisterOf(qc, store);
    await p.flush();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(Object.keys(replace.mock.calls[0]![0]).sort()).toEqual(["conv:c1", "conv:c2", "cursor", "list", "meta"]);
    await p.flush();
    expect(replace).toHaveBeenCalledTimes(1); // nothing changed
    qc.setQueryData(chatKeys.messages("c2"), data(page([msg("m2", 1), msg("m3", 2)])));
    await p.flush();
    expect(replace).toHaveBeenCalledTimes(2);
    expect(Object.keys(replace.mock.calls[1]![0]).sort()).toEqual(["conv:c1", "conv:c2", "cursor", "list", "meta"]); // all of it again, not a part
    // a conversation that is gone leaves the store in the same breath
    qc.removeQueries({ queryKey: chatKeys.conv("c1") });
    await p.flush();
    expect(Object.keys(store.dump()).sort()).toEqual(["conv:c2", "cursor", "list", "meta"]);
  });

  it("two tabs of one person never leave a MIX in the store: whoever wrote last wrote everything, with its own cursor", async () => {
    const store = memoryStartStore();
    const tabA = new QueryClient();
    confirmed(tabA, { y: [msg("y1", 1)] });
    const tabB = new QueryClient();
    confirmed(tabB, { x: [msg("x1", 1)] });
    const a = persisterOf(tabA, store, { cursor: "100" });
    const b = persisterOf(tabB, store, { cursor: "120" });
    await b.p.flush();
    await a.p.flush(); // the background tab, still at cursor 100, writes after the other
    const dump = store.dump();
    expect(dump["cursor"]).toBe("100");
    expect(Object.keys(dump).filter((k) => k.startsWith("conv:"))).toEqual(["conv:y"]); // nothing of tab B's (cursor 120) beside tab A's cursor
    await b.p.flush();
    expect(store.dump()["cursor"]).toBe("100"); // B has nothing new to say: it does not overwrite A with a copy of itself
    qc2Touch(tabB);
    await b.p.flush();
    expect(store.dump()["cursor"]).toBe("120");
    expect(Object.keys(store.dump()).filter((k) => k.startsWith("conv:"))).toEqual(["conv:x"]);
  });

  it("writes one at a time: a flush that comes while one is in flight waits for it, and a third does not run beside them", async () => {
    const qc = new QueryClient();
    confirmed(qc, { c1: [msg("m1", 1)] });
    const inner = memoryStartStore();
    let running = 0;
    let most = 0;
    const store = {
      ...inner,
      replaceAll: async (records: Record<string, string>) => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 5));
        await inner.replaceAll(records);
        running--;
      },
    };
    const { p } = persisterOf(qc, store as never);
    const first = p.flush();
    qc.setQueryData(chatKeys.messages("c1"), data(page([msg("m1", 1), msg("m2", 2)])));
    const second = p.flush();
    await new Promise((r) => setTimeout(r, 7)); // the first has finished, the second is running
    qc.setQueryData(chatKeys.messages("c1"), data(page([msg("m1", 1), msg("m2", 2), msg("m3", 3)])));
    const third = p.flush();
    await Promise.all([first, second, third]);
    expect(most).toBe(1);
    expect(JSON.parse(inner.dump()["conv:c1"]!).messages).toHaveLength(3);
  });

  it("a write a moment after the last change (debounced), and never after stop()", async () => {
    const qc = new QueryClient();
    confirmed(qc, { c1: [msg("m1", 1)] });
    const { p, store, timers } = persisterOf(qc);
    p.start();
    expect(timers.pending()).toBe(1);
    qc.setQueryData(chatKeys.messages("c1"), data(page([msg("m1", 1), msg("m2", 2)])));
    expect(timers.pending()).toBe(1); // folded into the one already waiting
    p.stop();
    timers.run();
    await p.flush();
    expect(store.dump()).toEqual({});
  });
});

describe("C1.5 — reading it back", () => {
  async function stored() {
    const qc = new QueryClient();
    confirmed(qc, { c1: [msg("m1", 1), msg("m2", 2)] });
    const { p, store } = persisterOf(qc);
    await p.flush();
    return store;
  }

  it("the list and the conversations come back as STALE data (fetched at 0), so a screen paints at once and then asks the server", async () => {
    const store = await stored();
    const fresh = new QueryClient();
    const cursor = await hydrateFromDevice(fresh, store, "u1");
    expect(cursor).toBe("500");
    expect(fresh.getQueryData<ChatListDto>(chatKeys.list())!.rows.map((r) => r.id)).toEqual(["c1"]);
    expect(fresh.getQueryData<MessagesData>(chatKeys.messages("c1"))!.pages[0]!.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(fresh.getQueryState(chatKeys.list())!.dataUpdatedAt).toBe(0);
    expect(fresh.getQueryCache().find({ queryKey: chatKeys.list() })!.isStaleByTime(300_000)).toBe(true);
    // the unread landing is the server's to decide when the conversation is opened
    expect(fresh.getQueryData<MessagesData>(chatKeys.messages("c1"))!.pages[0]).toMatchObject({ hasNewer: false, firstUnreadId: null });
  });

  it("never over a fresher answer that is already in the cache", async () => {
    const store = await stored();
    const fresh = new QueryClient();
    fresh.setQueryData(chatKeys.list(), list(row("newer")));
    await hydrateFromDevice(fresh, store, "u1");
    expect(fresh.getQueryData<ChatListDto>(chatKeys.list())!.rows.map((r) => r.id)).toEqual(["newer"]);
  });

  it("a copy that is somebody else's, in another format, damaged, or without a cursor is not read — and is emptied", async () => {
    const store = await stored();
    const records = store.dump();
    expect(parseDevice(records, "u2")).toBeNull();
    expect(parseDevice({ ...records, meta: JSON.stringify({ v: 999, userId: "u1" }) }, "u1")).toBeNull();
    expect(parseDevice({ ...records, cursor: "abc" }, "u1")).toBeNull();
    expect(parseDevice({ ...records, list: "{" }, "u1")).toBeNull();
    // one damaged conversation record costs only itself
    const partial = parseDevice({ ...records, "conv:c1": "{", "conv:c2": JSON.stringify({ id: "c2", messages: [], header: null }) }, "u1")!;
    expect(partial.conversations.map((c) => c.id)).toEqual(["c2"]);
    // another person's copy is emptied, not left for later
    const fresh = new QueryClient();
    expect(await hydrateFromDevice(fresh, store, "u2")).toBeNull();
    expect(store.dump()).toEqual({});
    expect(fresh.getQueryData(chatKeys.list())).toBeUndefined();
  });

  it("a stored message that was a tombstone but kept text (an older version, a hand-made copy) comes back as a tombstone", async () => {
    const store = memoryStartStore({
      meta: JSON.stringify({ v: DEVICE_FORMAT, userId: "u1", savedAt: Date.now() }),
      list: JSON.stringify(list(row("c1"))),
      cursor: "9",
      "conv:c1": JSON.stringify({ id: "c1", header: null, hasOlder: false, readers: [], messages: [msg("m1", 1, { deleted: true, body: "نص محذوف بقي هنا" })] }),
    });
    const fresh = new QueryClient();
    await hydrateFromDevice(fresh, store, "u1");
    expect(JSON.stringify(fresh.getQueryData(chatKeys.messages("c1")))).not.toContain("نص محذوف بقي هنا");
  });
});

describe("C1.5 — the IndexedDB adapter (a hand-made IDBFactory)", () => {
  it("replace the whole copy and read it back, one database per person, named zaki-chat-<userId>", async () => {
    const idb = fakeIdb();
    const a = indexedDbStartStore("u1", idb.factory)!;
    await a.replaceAll({ list: "[1]", cursor: "5" });
    expect(idb.names()).toEqual([deviceDbName("u1")]);
    expect(deviceDbName("u1")).toBe(`${DEVICE_DB_PREFIX}u1`);
    expect(await a.readAll()).toEqual({ list: "[1]", cursor: "5" });
    await a.replaceAll({ cursor: "6" });
    expect(await a.readAll()).toEqual({ cursor: "6" });
    // another person has another database: they do not see each other
    const b = indexedDbStartStore("u2", idb.factory)!;
    expect(await b.readAll()).toEqual({});
  });

  it("nothing at all when the browser has no IndexedDB or refuses it — never a throw", async () => {
    expect(indexedDbStartStore("u1", null)).toBeNull();
    const refusing = { open: () => { throw new Error("blocked"); } } as unknown as IDBFactory;
    const store = indexedDbStartStore("u1", refusing)!;
    await expect(store.readAll()).rejects.toBeDefined(); // the caller (loadDevice / the persister) catches it
    expect(await listDeviceDatabases(null)).toEqual([]);
  });
});

// ───────────────────────────────────────── the wipe ─────────────────────────────────────────

function device() {
  const idb = fakeIdb();
  const ls = fakeLocalStorage();
  vi.stubGlobal("indexedDB", idb.factory);
  vi.stubGlobal("window", { localStorage: ls });
  return { idb, ls };
}

const emptyAnswer = (cursor = "100"): SyncAnswer => ({ cursor, messages: [], reads: [], delivered: [], rows: [], removed: [] });

/** A page of person `userId` on this device: a runtime that has booted, with a confirmed list and one conversation, written to the device. */
async function signedIn(userId: string, opts: { external?: boolean | null; me?: RuntimeDeps["me"] } = {}) {
  const qc = new QueryClient();
  const timers = manualTimers();
  const rt = installChatRuntime(qc, {
    sync: { fetchJson: async <T,>() => emptyAnswer() as T, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), isOnline: () => true },
    persister: timers,
    me: opts.me ?? (async () => ({ status: "ok", userId })),
    external: async () => (opts.external === undefined ? false : opts.external),
  });
  await rt.ensure();
  await rt.whenBooted();
  confirmed(qc, { c1: [msg("m1", 1), msg("m2", 2)] });
  await rt.persister?.flush();
  return { qc, rt, timers };
}

describe("C1.5 — the wipe PROVES itself: write, wipe, read back nothing, across users", () => {
  beforeEach(() => void 0);

  it("a person's copy is on the device after a session; wipeChatCache() leaves NOTHING — no database, no marker, nothing to read back", async () => {
    const { idb, ls } = device();
    const a = await signedIn("alice");
    expect(idb.names()).toEqual([deviceDbName("alice")]);
    expect(ls.map.get(DEVICE_MARKER_KEY)).toBe("alice");
    const before = await indexedDbStartStore("alice", idb.factory)!.readAll();
    expect(before["conv:c1"]).toContain("نص سري m1");

    await wipeChatCache();

    expect(idb.names()).toEqual([]);
    expect(ls.map.has(DEVICE_MARKER_KEY)).toBe(false);
    expect(readDeviceMarker()).toBeNull();
    expect(await deviceHoldsCache()).toBe(false);
    // reading back (this recreates an empty database, as opening a missing one does)
    expect(await indexedDbStartStore("alice", idb.factory)!.readAll()).toEqual({});
    // memory is emptied too, and nothing writes after the wipe even if a timer fires
    expect(a.qc.getQueryData(chatKeys.list())).toBeUndefined();
    expect(a.rt.persister).toBeNull();
    a.timers.run();
    await Promise.resolve();
    expect(Object.keys(idb.stores.get(deviceDbName("alice")) ?? [])).toEqual([]);
  });

  it("across users: the wipe takes EVERY person's copy of the browser, not only the one signed in", async () => {
    const { idb } = device();
    await signedIn("alice");
    await indexedDbStartStore("bob", idb.factory)!.replaceAll({ meta: "{}", list: "[]" }); // a copy an older session left behind
    expect(idb.names().sort()).toEqual([deviceDbName("alice"), deviceDbName("bob")]);
    await wipeChatCache();
    expect(idb.names()).toEqual([]);
  });

  it("a DIFFERENT person signs in on the same device: the earlier person's messages are gone before the new person's copy is read or written", async () => {
    const { idb, ls } = device();
    await signedIn("alice");
    expect(ls.map.get(DEVICE_MARKER_KEY)).toBe("alice");
    const alicesText = JSON.stringify(await indexedDbStartStore("alice", idb.factory)!.readAll());
    expect(alicesText).toContain("نص سري m1");

    const bob = await signedIn("bob");

    expect(idb.names()).not.toContain(deviceDbName("alice"));
    expect(ls.map.get(DEVICE_MARKER_KEY)).toBe("bob");
    const bobsText = JSON.stringify(await indexedDbStartStore("bob", idb.factory)!.readAll());
    expect(bobsText).toContain("meta");
    // bob can never read alice's records, even if they were still there: the database names its person
    expect(parseDevice(JSON.parse(alicesText) as Record<string, string>, "bob")).toBeNull();
    expect(bob.rt.userId).toBe("bob");
    // and nothing of alice came into bob's cache
    expect(bob.qc.getQueryData<ChatListDto>(chatKeys.list())!.rows.map((r) => r.id)).toEqual(["c1"]); // his own confirmed list
  });

  it("nobody is signed in (the sign-in page after a sign-out, the stream's «signed_out», an expired session): the driver's boot finds the copy and wipes it", async () => {
    const { idb, ls } = device();
    await signedIn("alice");
    const qc = new QueryClient();
    const rt = installChatRuntime(qc, { me: async () => ({ status: "signed_out" }), sync: { fetchJson: async <T,>() => emptyAnswer() as T, setTimer: setTimeout as never, clearTimer: clearTimeout as never, isOnline: () => true } });
    await rt.bootIfDeviceHolds();
    expect(idb.names()).toEqual([]);
    expect(ls.map.has(DEVICE_MARKER_KEY)).toBe(false);
  });

  it("the live line is not opened for somebody who is signed out", async () => {
    device();
    await signedIn("alice");
    const frames = vi.fn(() => () => undefined);
    const qc = new QueryClient();
    const rt = installChatRuntime(qc, { me: async () => ({ status: "signed_out" }), frames });
    await rt.bootIfDeviceHolds();
    expect(frames).not.toHaveBeenCalled();
  });

  it("the same person comes back: the copy is hydrated, the list is there at once, and the feed continues from the stored cursor", async () => {
    device();
    await signedIn("alice");
    const asked: string[] = [];
    const qc = new QueryClient();
    const rt = installChatRuntime(qc, {
      sync: { fetchJson: async <T,>(url: string) => (asked.push(url), emptyAnswer("120") as T), setTimer: setTimeout as never, clearTimer: clearTimeout as never, isOnline: () => true },
      me: async () => ({ status: "ok", userId: "alice" }),
      external: async () => false,
    });
    await rt.bootIfDeviceHolds();
    expect(qc.getQueryData<ChatListDto>(chatKeys.list())!.rows.map((r) => r.id)).toEqual(["c1"]);
    expect(qc.getQueryData<MessagesData>(chatKeys.messages("c1"))!.pages[0]!.messages).toHaveLength(2);
    expect(rt.engine.cursor).toBe("100");
    expect(rt.deviceCurrent).toBe(true);
    await vi.waitFor(() => expect(asked).toEqual(["/api/chat/sync?after=100"]));
    rt.dispose();
  });

  it("an external partner (guest): NOTHING is ever written, and a copy an older session left is removed", async () => {
    const { idb, ls } = device();
    await indexedDbStartStore("guest1", idb.factory)!.replaceAll({ meta: "{}", list: "[]" });
    ls.setItem(DEVICE_MARKER_KEY, "guest1");
    const g = await signedIn("guest1", { external: true });
    expect(g.rt.persister).toBeNull();
    expect(idb.names()).not.toContain(deviceDbName("guest1"));
    expect(ls.map.has(DEVICE_MARKER_KEY)).toBe(false);
    // the cache still works in memory for the guest's own session
    expect(g.qc.getQueryData<ChatListDto>(chatKeys.list())!.rows).toHaveLength(1);
    expect(idb.names()).toEqual([]);
  });

  it("when it cannot be known who the person is, or whether they are external, nothing is written (it fails closed) and nothing is wiped", async () => {
    const { idb, ls } = device();
    await signedIn("alice");
    const stored = JSON.stringify(await indexedDbStartStore("alice", idb.factory)!.readAll());
    const unknownMe = await signedIn("alice", { me: async () => ({ status: "unknown" }) });
    expect(unknownMe.rt.persister).toBeNull();
    const unknownRole = await signedIn("alice", { external: null });
    expect(unknownRole.rt.persister).toBeNull();
    expect(idb.names()).toEqual([deviceDbName("alice")]);
    expect(ls.map.get(DEVICE_MARKER_KEY)).toBe("alice");
    expect(JSON.stringify(await indexedDbStartStore("alice", idb.factory)!.readAll())).toBe(stored);
  });

  it("a browser that refuses IndexedDB: the cache works in memory, nothing is stored, the wipe does not fail", async () => {
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });
    vi.stubGlobal("indexedDB", undefined);
    const qc = new QueryClient();
    const rt = installChatRuntime(qc, { me: async () => ({ status: "ok", userId: "alice" }), external: async () => false, sync: { fetchJson: async <T,>() => emptyAnswer() as T, setTimer: setTimeout as never, clearTimer: clearTimeout as never, isOnline: () => true } });
    await rt.ensure();
    await rt.whenBooted();
    expect(rt.persister).toBeNull();
    confirmed(qc, { c1: [msg("m1", 1)] });
    expect(qc.getQueryData(chatKeys.list())).toBeDefined();
    await expect(wipeChatCache()).resolves.toBeUndefined();
  });

  it("the wipe never throws and never waits for ever: a hook that throws does not keep the others from running, and a database another tab still holds open is deleted once it lets go", async () => {
    const { idb } = device();
    await signedIn("alice");
    const ran: string[] = [];
    const off1 = onChatWipe(() => { throw new Error("cannot stop"); });
    const off2 = onChatWipe(() => void ran.push("second"));
    // another tab holds the database open (it lets go on versionchange, as every connection of this cache does)
    const stubborn = indexedDbStartStore("alice", idb.factory)!;
    await stubborn.readAll();
    await expect(wipeChatCache()).resolves.toBeUndefined();
    off1();
    off2();
    expect(ran).toEqual(["second"]);
    expect(idb.names()).toEqual([]);
  });

  it("a session that wiped keeps working: the next use of the cache starts again from nothing", async () => {
    const { idb } = device();
    const a = await signedIn("alice");
    await wipeChatCache();
    expect(a.rt.engine.isStopped).toBe(true);
    await a.rt.ensure();
    expect(a.rt.engine.isStopped).toBe(false);
    await a.rt.whenBooted();
    confirmed(a.qc, { c9: [msg("z", 1)] });
    await a.rt.persister?.flush();
    expect(idb.names()).toEqual([deviceDbName("alice")]);
  });
});

// ───────────────────────────────────────── what the review found ─────────────────────────────────────────

describe("C1.5 — a person is told apart by the databases themselves, not only by a marker", () => {
  it("localStorage is refused or was cleared: another person's copy is STILL found and wiped when somebody else signs in", async () => {
    const idb = fakeIdb();
    vi.stubGlobal("indexedDB", idb.factory);
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });
    await signedIn("alice");
    expect(idb.names()).toEqual([deviceDbName("alice")]);
    // the marker goes (a cleared profile, a blocked store): the database remains
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } } });
    expect(readDeviceMarker()).toBeNull();
    const bob = await signedIn("bob");
    expect(idb.names()).not.toContain(deviceDbName("alice"));
    expect(bob.rt.userId).toBe("bob");
  });

  it("…and the same person's copy is still read back when the marker is gone", async () => {
    const idb = fakeIdb();
    vi.stubGlobal("indexedDB", idb.factory);
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });
    await signedIn("alice");
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() }); // a fresh, empty localStorage: no marker
    const qc = new QueryClient();
    const rt = installChatRuntime(qc, { sync: { fetchJson: async <T,>() => emptyAnswer("120") as T, setTimer: setTimeout as never, clearTimer: clearTimeout as never, isOnline: () => true }, me: async () => ({ status: "ok", userId: "alice" }), external: async () => false });
    await rt.bootIfDeviceHolds();
    expect(qc.getQueryData<ChatListDto>(chatKeys.list())!.rows.map((r) => r.id)).toEqual(["c1"]);
    expect(rt.deviceCurrent).toBe(true);
    rt.dispose();
  });
});

describe("C1.5 — a damaged or old copy cannot stop the start", () => {
  const base = (conv: unknown) => ({
    meta: JSON.stringify({ v: DEVICE_FORMAT, userId: "u1", savedAt: Date.now() }),
    list: JSON.stringify(list(row("c1"))),
    cursor: "9",
    "conv:c1": JSON.stringify(conv),
  });

  it("a stored deleted message without a mentions array (damage, or a later change of shape) costs its conversation, not the start", () => {
    const broken = { id: "c1", header: null, hasOlder: false, readers: [], messages: [{ ...msg("m1", 1), deleted: true, body: "نص", mentions: undefined }] };
    expect(() => parseDevice(base(broken), "u1")).not.toThrow();
    expect(parseDevice(base(broken), "u1")!.conversations).toEqual([]);
    expect(parseDevice(base(broken), "u1")!.list.rows).toHaveLength(1);
  });

  it("a copy older than 30 days is not painted, and is emptied", async () => {
    const records = { ...base({ id: "c1", header: null, hasOlder: false, readers: [], messages: [msg("m1", 1)] }), meta: JSON.stringify({ v: DEVICE_FORMAT, userId: "u1", savedAt: Date.now() - 31 * 86_400_000 }) };
    expect(parseDevice(records, "u1")).toBeNull();
    const store = memoryStartStore(records);
    expect(await loadDevice(store, "u1")).toBeNull();
    expect(store.dump()).toEqual({});
    expect(parseDevice({ ...records, meta: JSON.stringify({ v: DEVICE_FORMAT, userId: "u1", savedAt: Date.now() - 29 * 86_400_000 }) }, "u1")).not.toBeNull();
  });
});

describe("C1.5 — what the runtime does with a copy while the world changes under it", () => {
  const quiet = { setTimer: setTimeout as never, clearTimer: clearTimeout as never, isOnline: () => true };

  it("a boot that is still reading the copy when the runtime is reset (a wipe, a sign-out) paints NOTHING from it afterwards", async () => {
    const { idb } = device();
    await signedIn("alice");
    const real = indexedDbStartStore("alice", idb.factory)!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = { readAll: async () => (await gate, real.readAll()), replaceAll: (r: Record<string, string>) => real.replaceAll(r) };
    const qc = new QueryClient();
    const rt = installChatRuntime(qc, { sync: { fetchJson: async <T,>() => emptyAnswer("120") as T, ...quiet }, me: async () => ({ status: "ok", userId: "alice" }), external: async () => false, storeFor: () => slow });
    const booting = rt.ensure();
    await vi.waitFor(() => expect(rt.userId).toBe("alice"));
    rt.reset(); // a wipe by another tab, a sign-out: while the copy is still being read
    release();
    await booting;
    await rt.whenBooted();
    expect(qc.getQueryData(chatKeys.list())).toBeUndefined();
    expect(rt.deviceCurrent).toBe(false);
    expect(rt.userId).toBeNull();
    expect(rt.persister).toBeNull();
    rt.dispose();
  });

  it("a different person signing in does NOT drop what this page has already read for the new person (the wipe is of the device, not of this page)", async () => {
    device();
    await signedIn("alice");
    const qc = new QueryClient();
    const rt = installChatRuntime(qc, { sync: { fetchJson: async <T,>() => emptyAnswer("120") as T, ...quiet }, me: async () => ({ status: "ok", userId: "bob" }), external: async () => false });
    const booting = rt.ensure();
    qc.setQueryData(chatKeys.list(), list(row("bobs-chat")));
    await booting;
    await rt.whenBooted();
    expect(qc.getQueryData<ChatListDto>(chatKeys.list())!.rows.map((r) => r.id)).toEqual(["bobs-chat"]);
    expect(rt.engine.isStopped).toBe(false);
    expect(rt.engine.cursor).not.toBeNull();
    rt.dispose();
  });

  it("a reset answer from the feed empties the device copy at once when nothing on screen can replace it (the old text must not wait for a screen)", async () => {
    const { idb } = device();
    const qc = new QueryClient();
    let answer: SyncAnswer = emptyAnswer("100");
    const rt = installChatRuntime(qc, { sync: { fetchJson: async <T,>() => answer as T, ...quiet }, persister: manualTimers(), me: async () => ({ status: "ok", userId: "alice" }), external: async () => false });
    await rt.ensure();
    await rt.whenBooted();
    confirmed(qc, { c1: [msg("m1", 1)] });
    await rt.persister!.flush();
    expect(idb.stores.get(deviceDbName("alice"))!.size).toBeGreaterThan(0);
    expect((await indexedDbStartStore("alice", idb.factory)!.readAll())["conv:c1"]).toContain("نص سري m1");
    answer = { ...emptyAnswer("500"), reset: true };
    await rt.engine.now();
    await rt.persister!.flush();
    expect(await indexedDbStartStore("alice", idb.factory)!.readAll()).toEqual({});
    rt.dispose();
  });

  it("nothing is written while a catch-up is pending (the stored cursor must not run ahead of a window that lacks messages)", async () => {
    const { idb } = device();
    const qc = new QueryClient();
    const rt = installChatRuntime(qc, { sync: { fetchJson: async <T,>() => emptyAnswer("100") as T, ...quiet }, persister: manualTimers(), me: async () => ({ status: "ok", userId: "alice" }), external: async () => false });
    await rt.ensure();
    await rt.whenBooted();
    confirmed(qc, { c1: [msg("m1", 1)] });
    Object.defineProperty(rt.engine, "busy", { get: () => true });
    await rt.persister!.flush();
    expect(await indexedDbStartStore("alice", idb.factory)!.readAll()).toEqual({});
    rt.dispose();
  });

  it("a tab whose boot finds nobody signed in wipes WITHOUT telling the other tabs (two signed-out tabs would otherwise wipe each other for ever)", async () => {
    device();
    vi.stubGlobal("BroadcastChannel", class {
      static all = new Set<unknown>();
      onmessage: ((e: { data: unknown }) => void) | null = null;
      constructor(public name: string) {}
      postMessage(data: unknown) {
        posted.push(data);
      }
      close() {}
    });
    const posted: unknown[] = [];
    await signedIn("alice");
    posted.length = 0;
    const rt = installChatRuntime(new QueryClient(), { me: async () => ({ status: "signed_out" }) });
    await rt.bootIfDeviceHolds();
    expect(posted).toEqual([]);
    // a wipe the person asks for (the button, a sign-out) does tell them
    await wipeChatCache();
    expect(posted).toHaveLength(1);
  });
});

describe("C1.5 — the order of eviction survives a restart", () => {
  it("the time each conversation was opened is stored and restored, so the 20 MB cap still drops the least recently opened", async () => {
    const qc = new QueryClient();
    confirmed(qc, { a: [msg("a1", 1)], b: [msg("b1", 1)], c: [msg("c1", 1)] });
    markConversationOpened("a", 10);
    markConversationOpened("b", 30);
    markConversationOpened("c", 20);
    const { p, store } = persisterOf(qc);
    await p.flush();
    expect(JSON.parse(store.dump()["conv:b"]!).openedAt).toBe(30);

    // a new page: the module forgot everything; the copy remembers
    const parsed = parseDevice(store.dump(), "u1")!;
    expect(Object.fromEntries(parsed.conversations.map((c) => [c.id, c.openedAt]))).toEqual({ a: 10, b: 30, c: 20 });
    const fresh = new QueryClient();
    seedFromDevice(fresh, { list: parsed.list, conversations: parsed.conversations });
    const snap = buildSnapshot(fresh, "500", true)!;
    expect(snap.conversations.map((c) => c.id)).toEqual(["b", "c", "a"]);
    const bytes = (t: string) => new TextEncoder().encode(t).length;
    const all = serializeSnapshot(snap, "u1", 1);
    const tight = serializeSnapshot(snap, "u1", 1, bytes(all["meta"]!) + bytes(all["list"]!) + bytes(all["cursor"]!) + bytes(all["conv:b"]!) + bytes(all["conv:c"]!) + 5);
    expect(Object.keys(tight).filter((k) => k.startsWith("conv:")).sort()).toEqual(["conv:b", "conv:c"]);
  });
});

describe("C1.5 — a delete that cannot finish still leaves nothing to read", () => {
  it("a database held open by a frozen tab is EMPTIED first, and the wipe still returns", async () => {
    const idb = fakeIdb({ blockDelete: true });
    vi.stubGlobal("indexedDB", idb.factory);
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });
    await indexedDbStartStore("alice", idb.factory)!.replaceAll({ meta: "{}", list: "[1]", "conv:c1": "نص سري" });
    vi.useFakeTimers();
    try {
      const done = wipeChatCache();
      await vi.advanceTimersByTimeAsync(6_000);
      await done;
      expect(idb.stores.get(deviceDbName("alice"))?.size ?? 0).toBe(0); // the delete is still pending: nothing readable is left in it
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("C1.5 — a wipe in ONE tab reaches the others", () => {
  class FakeChannel {
    static all = new Set<FakeChannel>();
    onmessage: ((e: { data: unknown }) => void) | null = null;
    constructor(public name: string) {
      FakeChannel.all.add(this);
    }
    postMessage(data: unknown) {
      for (const c of FakeChannel.all) if (c !== this && c.name === this.name) queueMicrotask(() => c.onmessage?.({ data }));
    }
    close() {
      FakeChannel.all.delete(this);
    }
  }

  it("wipeChatCache() tells the other tabs; a tab that hears stops writing and forgets (it cannot bring the deleted copy back)", async () => {
    const { idb } = device();
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const heard: string[] = [];
    const off = listenForWipe(() => void heard.push("wipe"));
    const other = new FakeChannel("zk-chat-wipe"); // another tab's channel
    const got: unknown[] = [];
    other.onmessage = (e) => void got.push(e.data);
    await signedIn("alice");
    await wipeChatCache();
    await Promise.resolve();
    expect(got).toEqual([{ t: "wipe", from: expect.any(String) }]);
    expect(idb.names()).toEqual([]);
    // a message from another tab: this tab stops (its hooks run) without deleting anything itself
    other.postMessage({ t: "wipe", from: "another-tab" });
    await Promise.resolve();
    off();
    other.close();
    expect(heard).toEqual(["wipe"]); // only the one from the other tab: this page's own wipe is not «another tab»
  });

  it("a tab that is showing the chat when another tab wipes goes on: its screens ask again, and the feed and the writer start over", async () => {
    const { idb } = device();
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const asked: string[] = [];
    const listAnswer = { scope: "all", spaceId: null, canOversee: false, rows: [row("c1")] };
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      asked.push(url);
      if (url.startsWith("/api/chat/list")) return new Response(JSON.stringify(listAnswer), { status: 200 });
      return new Response(JSON.stringify(emptyAnswer("200")), { status: 200 });
    }));
    const qc = new QueryClient();
    const rt = installChatRuntime(qc, { me: async () => ({ status: "ok", userId: "alice" }), external: async () => false, sync: { fetchJson: async <T,>(url: string) => (asked.push(url), emptyAnswer("200") as T), setTimer: setTimeout as never, clearTimer: clearTimeout as never, isOnline: () => true } });
    const { QueryObserver } = await import("@tanstack/react-query");
    const { listQueryOptions } = await import("@/lib/chat/cache/queries");
    const observer = new QueryObserver(qc, listQueryOptions());
    const off = observer.subscribe(() => undefined); // a screen is mounted on the list
    await vi.waitFor(() => expect(qc.getQueryData(chatKeys.list())).toBeDefined());
    await rt.whenBooted();
    const before = asked.filter((u) => u.startsWith("/api/chat/list")).length;
    new FakeChannel("zk-chat-wipe").postMessage({ t: "wipe", from: "another-tab" });
    await vi.waitFor(() => expect(asked.filter((u) => u.startsWith("/api/chat/list")).length).toBe(before + 1));
    expect(rt.engine.isStopped).toBe(false);
    await vi.waitFor(() => expect(qc.getQueryData(chatKeys.list())).toBeDefined());
    off();
    rt.dispose();
    void idb;
  });

  it("a runtime that hears a wipe from another tab resets: its persister stops and its memory is emptied", async () => {
    const { idb } = device();
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const a = await signedIn("alice");
    expect(a.rt.persister).not.toBeNull();
    const elsewhere = new FakeChannel("zk-chat-wipe");
    elsewhere.postMessage({ t: "wipe", from: "another-tab" });
    await Promise.resolve();
    await Promise.resolve();
    expect(a.rt.persister).toBeNull();
    expect(a.qc.getQueryData(chatKeys.list())).toBeUndefined();
    a.timers.run();
    confirmed(a.qc, { c9: [msg("z", 1)] });
    await a.rt.persister?.flush();
    expect(Object.keys(idb.stores.get(deviceDbName("alice")) ?? [])).toEqual([]);
    elsewhere.close();
  });

  it("the others are told BEFORE the databases are deleted (a writer must not slip in during the delete), and a writer that started with a marker stops when it is gone even before its first write", async () => {
    const { idb, ls } = device();
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const order: string[] = [];
    const other = new FakeChannel("zk-chat-wipe");
    other.onmessage = () => void order.push(idb.names().length ? "told while the copy still exists" : "told after the delete");
    await signedIn("alice");
    await wipeChatCache();
    await Promise.resolve();
    expect(order[0]).toBe("told while the copy still exists");
    other.close();
    // a persister that was created while the marker named its person: the marker going away is a stop, with no write behind it
    ls.setItem(DEVICE_MARKER_KEY, "carol");
    const qc = new QueryClient();
    confirmed(qc, { c1: [msg("m1", 1)] });
    const { p, store } = persisterOf(qc);
    const carol = new StartCachePersister(qc, store, "carol", { cursor: () => "5", ready: () => true, deviceCurrent: () => false }, manualTimers());
    carol.start();
    ls.map.delete(DEVICE_MARKER_KEY);
    await carol.flush();
    expect(store.dump()).toEqual({});
    void p;
  });

  it("a write whose marker has been removed by a wipe (another tab, same realm or not) is not made", async () => {
    const { idb, ls } = device();
    const a = await signedIn("alice");
    expect(idb.stores.get(deviceDbName("alice"))!.size).toBeGreaterThan(0);
    // the other tab wiped: the databases and the marker are gone, but this tab was not told (no channel)
    idb.stores.delete(deviceDbName("alice"));
    ls.map.delete(DEVICE_MARKER_KEY);
    qc2Touch(a.qc);
    confirmed(a.qc, { c1: [msg("m1", 1), msg("m2", 2), msg("m3", 3)] });
    await a.rt.persister?.flush();
    expect(idb.names()).toEqual([]); // it did not bring the copy back
  });
});
