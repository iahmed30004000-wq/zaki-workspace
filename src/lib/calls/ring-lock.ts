/**
 * ONE tab rings. Every open tab of a browser (and the live line re-broadcasts to all of them) hears the same incoming call; each used to play its own copy,
 * unsynchronised (the owner: «صوت الرنين بيخري»). Now the tabs race for a lock kept in localStorage — the tab that holds it rings, the others stay silent and
 * check every second whether the holder went quiet (it closed, or the phone put it to sleep), then one of them takes over. Which tab rings is not
 * important, only that it is one. A tab that answers or declines also tells the others to drop their card (BroadcastChannel).
 */

const LOCK_KEY = "zk-ring-lock";
/** A holder that has not renewed its lock for this long is gone. */
export const LOCK_FRESH_MS = 3000;
/** How often the holder renews, and the others look. */
const HEARTBEAT_MS = 1000;

export interface Lock {
  tab: string;
  callId: string;
  at: number;
}

export interface LockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What this tab does about the ring now: take the lock, keep what it holds, or stay silent because another live tab holds it. */
export function lockDecision(current: Lock | null, me: string, callId: string, now: number): "take" | "mine" | "other" {
  if (!current || current.callId !== callId || now - current.at > LOCK_FRESH_MS) return "take";
  return current.tab === me ? "mine" : "other";
}

const THIS_TAB = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t${Math.random().toString(36).slice(2)}`;

function browserStorage(): LockStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readLock(store: LockStorage): Lock | null {
  try {
    const v = JSON.parse(store.getItem(LOCK_KEY) ?? "null") as Partial<Lock> | null;
    return v && typeof v.tab === "string" && typeof v.callId === "string" && typeof v.at === "number" ? (v as Lock) : null;
  } catch {
    return null;
  }
}

/**
 * Rings through the lock: `play` starts the sound (and the shaking) and returns its stop; it is called only while this tab holds the lock, and
 * stopped when the lock is lost or the ring stops. Returns the stop of the whole thing. `opts` are for tests: a tab's name, the shared storage
 * (null: no storage, the ring just plays), and the random wait (a few ms) that keeps two tabs from starting in the same breath.
 */
export function startSharedRing(callId: string, play: () => () => void, opts: { tabId?: string; storage?: LockStorage | null; jitterMs?: number } = {}): () => void {
  const tab = opts.tabId ?? THIS_TAB;
  const store = opts.storage === undefined ? browserStorage() : opts.storage;
  if (!store) return play();
  let stopTone: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let first: ReturnType<typeof setTimeout> | null = null;
  let over = false;

  const tick = () => {
    if (over) return;
    const now = Date.now();
    const decision = lockDecision(readLock(store), tab, callId, now);
    if (decision === "other") {
      stopTone?.();
      stopTone = null;
      return;
    }
    try {
      store.setItem(LOCK_KEY, JSON.stringify({ tab, callId, at: now } satisfies Lock));
    } catch {
      // storage refused: ring anyway rather than ring nowhere
    }
    // two tabs that wrote in the same breath: the last write stands, the other one reads it back and goes quiet
    const after = readLock(store);
    if (after && after.tab !== tab) {
      stopTone?.();
      stopTone = null;
      return;
    }
    if (!stopTone) stopTone = play();
  };

  const jitter = opts.jitterMs ?? Math.floor(Math.random() * 120);
  if (jitter > 0) first = setTimeout(tick, jitter);
  else tick();
  timer = setInterval(tick, HEARTBEAT_MS);

  return () => {
    if (over) return;
    over = true;
    if (first) clearTimeout(first);
    if (timer) clearInterval(timer);
    stopTone?.();
    stopTone = null;
    // let go of the lock, if it is this tab's, so another tab can take the ring at once
    const held = readLock(store);
    if (held && held.tab === tab) {
      try {
        store.removeItem(LOCK_KEY);
      } catch {
        // it goes stale by itself
      }
    }
  };
}

const CHANNEL = "zk-call-ring";

/** This tab answered or declined the call: the other tabs of the browser drop their card for it. */
export function announceRingDone(callId: string): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ t: "done", callId });
    channel.close();
  } catch {
    // no channel: the other tabs close on `call.changed` a moment later
  }
}

/** Hears the other tabs say a call's ring is done (answered or declined there); returns its stop. */
export function onRingDone(handler: (callId: string) => void): () => void {
  try {
    if (typeof BroadcastChannel === "undefined") return () => undefined;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      const m = e.data as { t?: unknown; callId?: unknown } | null;
      if (m && m.t === "done" && typeof m.callId === "string") handler(m.callId);
    };
    return () => channel.close();
  } catch {
    return () => undefined;
  }
}
