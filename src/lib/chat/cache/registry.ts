/**
 * C1.5 — the places that hold chat data in this page (the persister, the sync engine, the query cache) tell this tiny registry how
 * to stop and forget; `wipeChatCache()` runs them all BEFORE it deletes the databases, so nothing can write a message back after the
 * wipe. No imports on purpose: a logout button loads `wipe.ts` and this file, not the cache.
 */
export type WipeHook = () => void | Promise<void>;

const hooks = new Set<WipeHook>();

/** Register what a wipe must stop or drop. Returns the function that unregisters it. */
export function onChatWipe(hook: WipeHook): () => void {
  hooks.add(hook);
  return () => void hooks.delete(hook);
}

const CHANNEL = "zk-chat-wipe";
/** This page's own token: a message it sent itself (the page that wiped) is not a wipe «by another tab». */
const PAGE = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** Tells the other tabs of this browser that the copy was wiped (their writers must not bring it back). Never throws. */
export function broadcastWipe(): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ t: "wipe", from: PAGE });
    channel.close();
  } catch {
    /* a browser without BroadcastChannel: the marker check of the writer is the second line */
  }
}

/** Hears a wipe done by ANOTHER tab of this browser. Returns the function that stops listening. */
export function listenForWipe(handler: () => void): () => void {
  try {
    if (typeof BroadcastChannel === "undefined") return () => undefined;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      const data = e.data as { t?: unknown; from?: unknown } | null;
      if (data?.t === "wipe" && data.from !== PAGE) handler();
    };
    return () => channel.close();
  } catch {
    return () => undefined;
  }
}

/** Runs every hook; one that throws does not stop the others. */
export async function runWipeHooks(): Promise<void> {
  for (const hook of [...hooks]) {
    try {
      await hook();
    } catch {
      /* a hook that cannot stop must not keep the others from wiping */
    }
  }
}
