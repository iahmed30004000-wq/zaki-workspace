import type { QueryClient } from "@tanstack/react-query";
import { safetyRefreshMs } from "@/lib/realtime/live-refresh";
import { subscribeRealtime, type RealtimeEventPayload } from "@/lib/realtime/use-realtime";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import { deleteDeviceCaches, deviceHoldsCache, deviceOwners, indexedDbStartStore, type StartStore } from "@/lib/chat/cache/device-store";
import { fetchIsExternal, fetchMe, type MeResult } from "@/lib/chat/cache/identity";
import { loadDevice, StartCachePersister, type PersisterDeps } from "@/lib/chat/cache/persist";
import { broadcastWipe, listenForWipe, onChatWipe } from "@/lib/chat/cache/registry";
import { ChatSyncEngine, browserSyncDeps, type SyncDeps } from "@/lib/chat/cache/sync";
import { dropAllChatQueries, resetChatCache, seedFromDevice } from "@/lib/chat/cache/writer";
import { wipeChatCache } from "@/lib/chat/cache/wipe";

/**
 * C1.4 + C1.5 — the cache's life in one page: one runtime per QueryClient that owns the sync engine, listens to the live line and the
 * browser, and (for staff, never for an external partner) keeps the device copy.
 *
 * Nothing here starts until a chat screen (or the quick chat, later) asks for chat data: `ensureChatCache(qc)` is called by every
 * chat query before it fetches. The one exception is a device that already holds a start cache: the driver (`driver.tsx`) boots it at
 * once so the list can paint from it, and so a sign-out, a different person or a guest account finds and removes it.
 */

/** Frames that never change what the cache holds: they live on the stream only. Everything else asks the feed. */
const STREAM_ONLY = new Set(["typing", "presence.changed", "whiteboard.changed", "call.ring", "call.changed", "watch.changed", "emoji.effect"]);
export function frameWantsSync(e: RealtimeEventPayload): boolean {
  return !STREAM_ONLY.has(e.kind);
}

/** A tab hidden for longer than this asks the feed when it is shown again. */
export const HIDDEN_RESYNC_MS = 60_000;
/** The most a first chat query waits for the device copy to be read before it goes to the network. */
const BOOT_WAIT_MS = 800;
/** The most it waits for the feed to say where «now» is: the list is read without it rather than not at all. */
const CURSOR_WAIT_MS = 4_000;

export interface RuntimeDeps {
  sync: SyncDeps;
  persister?: PersisterDeps;
  /** the live line (`subscribeRealtime`); null: no browser */
  frames: ((handler: (e: RealtimeEventPayload) => void) => () => void) | null;
  /** window / document, or null (tests, the server) */
  win: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  doc: (Pick<Document, "addEventListener" | "removeEventListener"> & { visibilityState?: string }) | null;
  now(): number;
  me(): Promise<MeResult>;
  external(qc: QueryClient): Promise<boolean | null>;
  storeFor(userId: string): StartStore | null;
  holdsDeviceCache(): Promise<boolean>;
  /** whose start caches this browser holds (the marker AND every `zaki-chat-*` database the browser lists) */
  owners(): Promise<{ owners: Set<string> }>;
  /** the safety refresh's period (the live line's five minutes, stretched by economy mode); null: none */
  safetyMs: (() => number) | null;
}

export function browserRuntimeDeps(): RuntimeDeps {
  const browser = typeof window !== "undefined";
  return {
    sync: browserSyncDeps,
    frames: browser ? (h) => subscribeRealtime(h) : null,
    win: browser ? window : null,
    doc: browser && typeof document !== "undefined" ? document : null,
    now: () => Date.now(),
    me: fetchMe,
    external: fetchIsExternal,
    storeFor: (userId) => indexedDbStartStore(userId),
    holdsDeviceCache: () => deviceHoldsCache(),
    owners: () => deviceOwners(),
    safetyMs: browser ? safetyRefreshMs : null,
  };
}

/** `promise`, or nothing after `ms` (a request that hangs must not hold a screen up); the timer is cleared as soon as the promise settles. */
function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

export class ChatCacheRuntime {
  readonly engine: ChatSyncEngine;
  userId: string | null = null;
  persister: StartCachePersister | null = null;
  /** the device copy supplied the cursor the engine runs from (and so the data it painted is current once the feed has caught up) */
  deviceCurrent = false;
  private readyPromise: Promise<void> | null = null;
  private bootPromise: Promise<void> | null = null;
  private attached = false;
  private signedOut = false;
  private cursorLate = false;
  private offApplied: (() => void) | null = null;
  private offReset: (() => void) | null = null;
  /** counts the wipes and resets: a boot that started before one is stale and does nothing more */
  private generation = 0;
  private offs: Array<() => void> = [];
  private safetyTimer: unknown = null;
  private hiddenSince: number | null = null;
  private offWipe: (() => void) | null = null;

  constructor(
    private readonly qc: QueryClient,
    public deps: RuntimeDeps,
  ) {
    this.engine = new ChatSyncEngine(qc, deps.sync, () => this.userId ?? undefined);
    // a cursor that came late (the first request hung) is where «now» was learned AFTER the data was read: what was read is not
    // current to it, so it is asked for again (and, being stale, it is not written to the device as current)
    this.engine.onApplied(() => {
      if (this.cursorLate && this.engine.cursor !== null) {
        this.cursorLate = false;
        resetChatCache(this.qc);
      }
    });
  }

  /** Called by every chat query before it fetches. Resolves once the feed has a cursor (or has failed to get one: the query goes on). */
  ensure(): Promise<void> {
    // after a wipe the next use starts again
    if (this.engine.isStopped) this.readyPromise = null;
    this.readyPromise ??= this.start();
    return this.readyPromise;
  }

  private async start(): Promise<void> {
    this.engine.start();
    installChatDefaults(this.qc);
    this.offWipe ??= onChatWipe(() => this.reset());
    const holds = await this.deps.holdsDeviceCache().catch(() => false);
    this.bootPromise = this.boot();
    // a device that holds a copy: give it a moment to be read, so the feed continues from ITS cursor and what it painted stays valid
    if (holds) await within(this.bootPromise, BOOT_WAIT_MS);
    await within(this.engine.ensureCursor(), CURSOR_WAIT_MS);
    if (this.engine.cursor === null && !this.engine.isStopped) this.cursorLate = true;
    // the live line is listened to once it is known that somebody is signed in (a boot that found nobody has already left)
    if (!this.signedOut) this.live();
  }

  /** Listen to the live line and the browser, and keep the five-minute net. Idempotent. */
  private live(): void {
    this.attach();
    this.armSafety();
  }

  /** Resolves when the identity check and the device copy have been dealt with (tests; the driver). */
  whenBooted(): Promise<void> {
    return this.bootPromise ?? Promise.resolve();
  }

  /** The driver's entry: does everything `ensure` does, but only when the device holds a copy. */
  async bootIfDeviceHolds(): Promise<void> {
    if (await this.deps.holdsDeviceCache().catch(() => false)) await this.ensure();
    await this.bootPromise;
  }

  /** Who is this, and what does the device hold of them? Never throws. */
  private async boot(): Promise<void> {
    const gen = this.generation;
    const stale = () => gen !== this.generation || this.engine.isStopped;
    try {
      const me = await this.deps.me();
      if (gen !== this.generation) return;
      this.signedOut = me.status === "signed_out";
      if (me.status === "signed_out") {
        // nobody is signed in (a sign-out in another tab, the stream's «signed_out», an expired session): nothing of anybody stays,
        // and the live line is not opened (it would only be refused on the sign-in page). The other tabs are not told: each finds
        // out for itself, and two tabs telling each other would never stop.
        await wipeChatCache({ broadcast: false });
        return;
      }
      this.live();
      if (me.status !== "ok") return;
      // whose copies does this device hold? The databases themselves say (the marker is another store and can be lost on its own)
      let { owners } = await this.deps.owners();
      if (stale()) return;
      if ([...owners].some((id) => id !== me.userId)) {
        // a DIFFERENT person signed in on this device: the earlier person's messages go before anything of this one is read. It is
        // the DEVICE that is wiped: what this page has read is the new person's own and stays; the other tabs are told to stop writing.
        broadcastWipe();
        await deleteDeviceCaches();
        if (stale()) return;
        owners = new Set();
      }
      this.userId = me.userId;
      const store = this.deps.storeFor(me.userId);
      let loaded: Awaited<ReturnType<typeof loadDevice>> = null;
      if (store && owners.has(me.userId)) loaded = await loadDevice(store, me.userId);
      if (stale()) return; // a wipe or a sign-out came while the copy was being read: nothing of it is painted
      // a cursor learned from the server while the device was being read is newer than the copy: the copy is not painted
      if (loaded && this.engine.adoptCursor(loaded.parsed.cursor)) {
        seedFromDevice(this.qc, { list: loaded.parsed.list, conversations: loaded.parsed.conversations });
        this.deviceCurrent = true;
        this.engine.schedule();
      }
      const external = await this.deps.external(this.qc);
      if (stale()) return;
      if (external === true) {
        // an external partner keeps nothing on the device, and whatever an older session kept goes
        this.persister?.stop();
        this.persister = null;
        await deleteDeviceCaches({ also: [me.userId] });
        return;
      }
      if (external !== false || !store) return; // unknown: nothing is written
      const persister = new StartCachePersister(
        this.qc,
        store,
        me.userId,
        { cursor: () => this.engine.cursor, ready: () => this.engine.answered && !this.engine.busy, deviceCurrent: () => this.deviceCurrent },
        this.deps.persister,
      );
      this.persister = persister;
      persister.start();
      this.offApplied?.();
      this.offApplied = this.engine.onApplied(() => persister.schedule());
      this.offReset?.();
      this.offReset = this.engine.onReset(() => persister.dropCopy());
    } catch {
      /* the cache works in memory either way */
    }
  }

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    const { frames, win, doc } = this.deps;
    if (frames) this.offs.push(frames((e) => frameWantsSync(e) && this.engine.schedule()));
    // another tab wiped the copy (sign-out, a different person, the settings button): this tab stops writing and forgets too
    this.offs.push(listenForWipe(() => this.reset({ restart: true })));
    if (win) {
      const online = () => this.engine.schedule();
      win.addEventListener("online", online);
      this.offs.push(() => win.removeEventListener("online", online));
    }
    if (doc) {
      const visibility = () => {
        if (doc.visibilityState === "hidden") {
          this.hiddenSince = this.deps.now();
          void this.persister?.flush(); // the tab may be going away: write what is current now
          return;
        }
        const since = this.hiddenSince;
        this.hiddenSince = null;
        if (since !== null && this.deps.now() - since > HIDDEN_RESYNC_MS) this.engine.schedule();
      };
      doc.addEventListener("visibilitychange", visibility);
      this.offs.push(() => doc.removeEventListener("visibilitychange", visibility));
    }
  }

  /** The five-minute safety net of the live line: whatever is on screen is asked for again (a frame lost, an event numbered late). */
  private armSafety(): void {
    if (this.safetyTimer !== null) return;
    const period = this.deps.safetyMs?.();
    if (!period) return;
    this.safetyTimer = this.deps.sync.setTimer(() => {
      this.safetyTimer = null;
      // a stopped engine (a wipe) does not re-arm it: the next use of the cache does
      if (this.engine.isStopped) return;
      // only what is on screen is asked for again: a window nobody looks at is NOT made stale (a stale one is dropped from the device copy)
      void this.qc.refetchQueries({ queryKey: chatKeys.all(), type: "active" });
      this.engine.schedule();
      this.armSafety();
    }, period);
  }

  /**
   * The wipe: nothing writes any more, the engine stops, memory is emptied. `restart` (a wipe by ANOTHER tab while this one shows the
   * chat): the queries are reset instead of removed, so every screen that is mounted asks again, and that starts the runtime over.
   */
  reset(opts: { restart?: boolean } = {}): void {
    this.engine.stop();
    this.persister?.stop();
    this.persister = null;
    this.offApplied?.();
    this.offApplied = null;
    this.offReset?.();
    this.offReset = null;
    this.generation++;
    if (this.safetyTimer !== null) this.deps.sync.clearTimer(this.safetyTimer);
    this.safetyTimer = null;
    this.deviceCurrent = false;
    this.userId = null;
    if (opts.restart) void this.qc.resetQueries({ queryKey: chatKeys.all() });
    else dropAllChatQueries(this.qc);
  }

  /** Leaves the page's listeners (tests, unmount of a throw-away client). */
  dispose(): void {
    this.reset();
    for (const off of this.offs) off();
    this.offs = [];
    if (this.safetyTimer !== null) this.deps.sync.clearTimer(this.safetyTimer);
    this.safetyTimer = null;
    this.offWipe?.();
    this.offWipe = null;
    this.attached = false;
  }
}

const runtimes = new WeakMap<QueryClient, ChatCacheRuntime>();

export function chatRuntimeOf(qc: QueryClient): ChatCacheRuntime {
  let rt = runtimes.get(qc);
  if (!rt) {
    rt = new ChatCacheRuntime(qc, browserRuntimeDeps());
    runtimes.set(qc, rt);
  }
  return rt;
}

/** Replace the runtime of a client (tests: a fake network, a fake clock, an in-memory device). */
export function installChatRuntime(qc: QueryClient, deps: Partial<RuntimeDeps>): ChatCacheRuntime {
  runtimes.get(qc)?.dispose();
  const base: RuntimeDeps = { ...browserRuntimeDeps(), frames: null, win: null, doc: null, safetyMs: null, ...deps };
  const rt = new ChatCacheRuntime(qc, base);
  runtimes.set(qc, rt);
  return rt;
}

/** Every chat query calls this before it fetches. */
export function ensureChatCache(qc: QueryClient): Promise<void> {
  return chatRuntimeOf(qc).ensure();
}

/** A frame, a focus, a reconnect: ask the feed in 120 ms (frames of one burst are one question; one question at a time). */
export function scheduleSync(qc: QueryClient): void {
  chatRuntimeOf(qc).engine.schedule();
}

/** Ask the feed now (after my own send). */
export function syncNow(qc: QueryClient): Promise<void> {
  return chatRuntimeOf(qc).engine.now();
}
