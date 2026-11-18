import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C1.3 — ONE line per browser (src/lib/realtime/use-realtime.ts). Several tabs are simulated in one process: each tab is its own
 * copy of the module with its own `document`, `window` and fetch log, while the browser's `navigator.locks` and `BroadcastChannel`
 * are shared, as they are between real tabs.
 *
 * What must hold:
 *  - the first tab takes the lock `zk-rt` and owns the EventSource; the others open none and get every frame over the channel;
 *  - when the leader goes (closed, or crashed), another tab takes the lock, resumes from the last event id it saw and refetches;
 *  - F0.5: the leader reports to the server the OR of every tab's visibility, under its own tab id, and a follower never posts;
 *  - F0.3: a hidden leader keeps the stream while any tab is visible, and pauses (and wakes) on the tabs' common state; a follower
 *    that hears nothing from the leader for 60 s polls every 15 s like a stream that is down;
 *  - F0.2: `evicted` and `signed_out` reach every tab; two tabs of one browser never evict each other (there is one stream);
 *  - `presence.changed` reaches the presence handlers only, never a screen's handler;
 *  - without Web Locks (or without BroadcastChannel) every tab opens its own stream, exactly as before.
 */

type Doc = { hidden: boolean; visibilityState: string; handlers: Map<string, () => void>; addEventListener: (n: string, f: () => void) => void; removeEventListener: (n: string) => void };
type Tab = { name: string; doc: Doc; win: { handlers: Map<string, () => void>; location: { assign: ReturnType<typeof vi.fn> }; addEventListener: (n: string, f: () => void) => void; removeEventListener: (n: string) => void }; fetches: { url: string; body: { visible: boolean; tab: string } | null }[]; mod: typeof import("@/lib/realtime/use-realtime") };

let current: Tab;
const inTab = <T,>(tab: Tab, fn: () => T): T => {
  const prev = current;
  current = tab;
  try {
    return fn();
  } finally {
    current = prev;
  }
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((m: { data: string; lastEventId: string }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  listeners = new Map<string, (m: { data: string }) => void>();
  closed = false;
  owner = current;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  addEventListener(name: string, fn: (m: { data: string }) => void) {
    this.listeners.set(name, fn);
  }
  frame(payload: Record<string, unknown>, id?: string) {
    inTab(this.owner, () => this.onmessage?.({ data: JSON.stringify(payload), lastEventId: id ?? "" }));
  }
  emit(name: string, data = "{}") {
    inTab(this.owner, () => this.listeners.get(name)?.({ data }));
  }
  open() {
    inTab(this.owner, () => this.onopen?.());
  }
}

class FakeBroadcastChannel {
  static all = new Set<FakeBroadcastChannel>();
  onmessage: ((m: { data: unknown }) => void) | null = null;
  owner = current;
  closed = false;
  constructor(public name: string) {
    FakeBroadcastChannel.all.add(this);
  }
  postMessage(data: unknown) {
    for (const other of [...FakeBroadcastChannel.all]) {
      if (other === this || other.name !== this.name || other.closed) continue;
      const copy = structuredClone(data);
      inTab(other.owner, () => other.onmessage?.({ data: copy }));
    }
  }
  close() {
    this.closed = true;
    FakeBroadcastChannel.all.delete(this);
  }
}

/** Web Locks as the browser has them: exclusive, queued, released when the holder's promise settles or the holder dies. */
class FakeLocks {
  held: { owner: Tab; resolve: () => void } | null = null;
  queue: { cb: () => unknown; owner: Tab; signal?: AbortSignal; resolve: () => void; reject: (e: unknown) => void }[] = [];
  requests = 0;
  request(_name: string, options: { signal?: AbortSignal } | (() => unknown), cb?: () => unknown): Promise<void> {
    const opts = typeof options === "function" ? {} : options;
    const callback = typeof options === "function" ? options : cb!;
    this.requests++;
    return new Promise<void>((resolve, reject) => {
      const entry = { cb: callback, owner: current, signal: opts.signal, resolve, reject };
      opts.signal?.addEventListener("abort", () => {
        this.queue = this.queue.filter((q) => q !== entry);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
      this.queue.push(entry);
      this.pump();
    });
  }
  pump() {
    if (this.held || this.queue.length === 0) return;
    const entry = this.queue.shift()!;
    this.held = { owner: entry.owner, resolve: entry.resolve };
    queueMicrotask(() => {
      let result: unknown;
      inTab(entry.owner, () => {
        result = entry.cb();
      });
      void Promise.resolve(result).then(() => {
        if (this.held?.owner === entry.owner) this.held = null;
        entry.resolve();
        this.pump();
      });
    });
  }
  /** a tab that crashed: its lock goes without the holder saying so */
  crash(tab: Tab) {
    if (this.held?.owner === tab) {
      this.held = null;
      this.pump();
    }
  }
}

const locks = new FakeLocks();
const nav: { onLine: boolean; locks?: FakeLocks } = { onLine: true, locks };
const proxyOf = <T extends object>(pick: () => T) =>
  new Proxy({} as T, {
    get: (_t, k) => (pick() as Record<string | symbol, unknown>)[k],
    set: (_t, k, v) => {
      (pick() as Record<string | symbol, unknown>)[k] = v;
      return true;
    },
  });
vi.stubGlobal("document", proxyOf(() => current.doc));
vi.stubGlobal("window", proxyOf(() => current.win));
vi.stubGlobal("navigator", nav);
vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as unknown as typeof BroadcastChannel);
vi.stubGlobal(
  "fetch",
  vi.fn((url: string, init?: { body?: string }) => {
    current.fetches.push({ url: String(url), body: init?.body ? (JSON.parse(init.body) as { visible: boolean; tab: string }) : null });
    return Promise.resolve({ ok: true });
  }),
);

async function openTab(name: string): Promise<Tab> {
  vi.resetModules();
  const handlers = new Map<string, () => void>();
  const winHandlers = new Map<string, () => void>();
  const tab = {
    name,
    doc: { hidden: false, visibilityState: "visible", handlers, addEventListener: (n: string, f: () => void) => handlers.set(n, f), removeEventListener: (n: string) => handlers.delete(n) },
    win: { handlers: winHandlers, location: { assign: vi.fn() }, addEventListener: (n: string, f: () => void) => winHandlers.set(n, f), removeEventListener: (n: string) => winHandlers.delete(n) },
    fetches: [],
  } as unknown as Tab;
  inTab(tab, () => undefined);
  const prev = current;
  current = tab;
  tab.mod = await import("@/lib/realtime/use-realtime");
  current = prev ?? tab;
  return tab;
}
const flush = () => vi.advanceTimersByTimeAsync(0);
const sub = (tab: Tab, handler: (e: { kind: string; synthetic?: boolean }) => void = () => undefined, presence?: () => void) => inTab(tab, () => tab.mod.subscribeRealtime(handler, presence));
const hide = (tab: Tab, hidden: boolean) =>
  inTab(tab, () => {
    tab.doc.hidden = hidden;
    tab.doc.visibilityState = hidden ? "hidden" : "visible";
    tab.doc.handlers.get("visibilitychange")?.();
  });
const reports = (tab: Tab) => tab.fetches.filter((f) => f.url === "/api/rt/visibility").map((f) => f.body!);
const streams = () => FakeEventSource.instances;
/** The server's heartbeat: time moves and the open stream hears a ping every 25 s, so no watchdog fires. */
async function run(ms: number) {
  let left = ms;
  while (left > 0) {
    const step = Math.min(25_000, left);
    await vi.advanceTimersByTimeAsync(step);
    left -= step;
    const open = streams().filter((e) => !e.closed).at(-1);
    if (open) open.emit("ping");
  }
}
const tabParam = (es: FakeEventSource) => new URL(es.url, "http://x").searchParams.get("tab");

let tabs: Tab[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  // a timer fires in the tab that set it (each real tab has its own document): remember the tab when it is set
  const realSet = globalThis.setTimeout;
  const realInterval = globalThis.setInterval;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    const owner = current;
    return realSet(() => (owner ? inTab(owner, fn) : fn()), ms);
  }) as unknown as typeof setTimeout;
  globalThis.setInterval = ((fn: () => void, ms?: number) => {
    const owner = current;
    return realInterval(() => (owner ? inTab(owner, fn) : fn()), ms);
  }) as unknown as typeof setInterval;
  FakeEventSource.instances = [];
  FakeBroadcastChannel.all.clear();
  locks.held = null;
  locks.queue = [];
  locks.requests = 0;
  nav.locks = locks;
  nav.onLine = true;
  tabs = [];
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = FakeBroadcastChannel;
});
afterEach(() => {
  for (const t of tabs) inTab(t, () => t.mod.resetRealtimeForTests());
  vi.useRealTimers();
});
const tab = async (name: string) => {
  const t = await openTab(name);
  tabs.push(t);
  return t;
};

describe("one stream per browser", () => {
  it("the first tab owns the stream; the second opens none and still gets every frame, with the event id", async () => {
    const a = await tab("A");
    const b = await tab("B");
    const seenA: string[] = [];
    const seenB: string[] = [];
    sub(a, (e) => seenA.push(e.kind));
    await flush();
    sub(b, (e) => seenB.push(e.kind));
    await flush();
    expect(streams()).toHaveLength(1);
    expect(streams()[0]!.owner).toBe(a);
    expect(inTab(a, () => a.mod.streamStateForTests()?.role)).toBe("leader");
    expect(inTab(b, () => b.mod.streamStateForTests()?.role)).toBe("follower");
    streams()[0]!.frame({ kind: "message.created", conversationId: "cv1", messageId: "m1" }, "42");
    expect(seenA).toEqual(["message.created"]);
    expect(seenB).toEqual(["message.created"]);
    expect(inTab(b, () => b.mod.streamStateForTests()?.lastEventId)).toBe("42");
  });

  it("five tabs make one stream (the server's cap of streams per person is no longer reached by one browser)", async () => {
    const all: Tab[] = [];
    for (const n of ["A", "B", "C", "D", "E"]) {
      const t = await tab(n);
      all.push(t);
      sub(t);
      await flush();
    }
    expect(streams()).toHaveLength(1);
    expect(locks.requests).toBe(5);
  });

  it("a typing frame reaches the follower's typing state, and a reload reaches its screens as a refetch", async () => {
    const a = await tab("A");
    const b = await tab("B");
    const seenB: { kind: string; synthetic?: boolean }[] = [];
    sub(a);
    await flush();
    sub(b, (e) => seenB.push(e));
    await flush();
    streams()[0]!.emit("reload");
    expect(seenB).toEqual([{ kind: "conversation.changed", synthetic: true }]);
    const typed = inTab(b, () => b.mod.typingStateForTests("cv1"));
    streams()[0]!.frame({ kind: "typing", conversationId: "cv1", userId: "u2", name: "سارة" });
    expect(inTab(b, () => b.mod.typingStateForTests("cv1"))).toEqual(["سارة"]);
    expect(typed).toEqual([]);
  });

  it("without Web Locks every tab opens its own stream, exactly as before", async () => {
    delete nav.locks;
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    sub(b);
    await flush();
    expect(streams()).toHaveLength(2);
    expect(inTab(a, () => a.mod.streamStateForTests()?.role)).toBe("solo");
  });

  it("without BroadcastChannel every tab opens its own stream too", async () => {
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    sub(b);
    await flush();
    expect(streams()).toHaveLength(2);
  });
});

describe("the leader goes", () => {
  it("when the leader's last screen closes, a follower takes over: one new stream, from the last id, with a refetch", async () => {
    const a = await tab("A");
    const b = await tab("B");
    const seenB: string[] = [];
    const offA = sub(a);
    await flush();
    sub(b, (e) => seenB.push(e.kind));
    await flush();
    streams()[0]!.frame({ kind: "message.created", conversationId: "cv1" }, "42");
    seenB.length = 0;
    inTab(a, offA);
    await flush();
    expect(streams()[0]!.closed).toBe(true);
    expect(streams()).toHaveLength(2);
    expect(streams()[1]!.owner).toBe(b);
    expect(streams()[1]!.url).toMatch(/^\/api\/rt\?tab=[^&]+&lastEventId=42$/);
    expect(seenB).toEqual(["conversation.changed"]);
    expect(inTab(b, () => b.mod.streamStateForTests()?.role)).toBe("leader");
  });

  it("when the leader crashes (its lock goes with it), a follower takes over the same way", async () => {
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    await flush();
    sub(b);
    await flush();
    streams()[0]!.frame({ kind: "message.created" }, "7");
    locks.crash(a);
    await flush();
    expect(streams()).toHaveLength(2);
    expect(streams()[1]!.owner).toBe(b);
    expect(streams()[1]!.url).toContain("lastEventId=7");
  });

  it("a tab that stops listening before it was ever leader cancels its place in the queue", async () => {
    const a = await tab("A");
    const b = await tab("B");
    const offA = sub(a);
    await flush();
    const offB = sub(b);
    await flush();
    inTab(b, offB);
    await flush();
    inTab(a, offA);
    await flush();
    expect(streams()).toHaveLength(1); // nobody took over: B had left
    expect(locks.held).toBeNull();
  });

  it("an evicted leader says so to every tab (the small line), and a signed-out one sends every tab to the sign-in page", async () => {
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    await flush();
    sub(b);
    await flush();
    streams()[0]!.emit("bye", JSON.stringify({ reason: "evicted" }));
    expect(inTab(b, () => b.mod.streamEvictedNow())).toBe(true);
    expect(streams()).toHaveLength(1); // nothing reconnects into a ping-pong
    streams()[0]!.emit("bye", JSON.stringify({ reason: "signed_out" }));
    expect(b.win.location.assign).toHaveBeenCalledWith("/login");
    expect(a.win.location.assign).toHaveBeenCalledWith("/login");
  });

  it("the leader's own stream failing polls for everybody: the follower's screens refetch every 15 s too", async () => {
    const a = await tab("A");
    const b = await tab("B");
    const seenB: string[] = [];
    sub(a);
    await flush();
    sub(b, (e) => seenB.push(e.kind));
    await flush();
    for (let i = 0; i < 3; i++) {
      inTab(a, () => streams().at(-1)!.onerror?.());
      await vi.advanceTimersByTimeAsync(2000);
    }
    seenB.length = 0;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(seenB).toContain("conversation.changed");
  });
});

describe("F0.5 — the leader reports the OR of every tab", () => {
  it("a hidden leader with a visible follower reports visible, under the leader's own tab id", async () => {
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    await flush();
    sub(b);
    await flush();
    hide(a, true);
    expect(reports(a).at(-1)).toMatchObject({ visible: true, tab: tabParam(streams()[0]!) });
    // the follower said it was visible when it opened; now it hides too
    hide(b, true);
    expect(reports(a).at(-1)!.visible).toBe(false);
    hide(b, false);
    expect(reports(a).at(-1)!.visible).toBe(true);
  });

  it("a visible leader with a hidden follower reports visible; both hidden, hidden", async () => {
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    await flush();
    hide(b, true);
    sub(b);
    await flush();
    streams()[0]!.open();
    expect(reports(a).at(-1)!.visible).toBe(true);
    hide(a, true);
    expect(reports(a).at(-1)!.visible).toBe(false);
  });

  it("a follower never posts a report of its own: it speaks to the leader", async () => {
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    await flush();
    sub(b);
    await flush();
    hide(b, true);
    hide(b, false);
    streams()[0]!.emit("ping");
    expect(reports(b)).toEqual([]);
  });

  it("every ping re-reports the OR (a lost report is corrected within a beat)", async () => {
    const a = await tab("A");
    sub(a);
    await flush();
    const before = reports(a).length;
    streams()[0]!.emit("ping");
    streams()[0]!.emit("ping");
    expect(reports(a).length - before).toBe(2);
  });

  it("a follower that closes is forgotten at once: a hidden leader then reports hidden", async () => {
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    await flush();
    const offB = sub(b);
    await flush();
    hide(a, true);
    expect(reports(a).at(-1)!.visible).toBe(true);
    inTab(b, offB);
    expect(reports(a).at(-1)!.visible).toBe(false);
  });

  it("a follower that vanished without a word is forgotten after 75 s of silence", async () => {
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    await flush();
    sub(b);
    await flush();
    hide(a, true);
    FakeBroadcastChannel.all.forEach((c) => c.owner === b && c.close()); // a crashed follower: no `gone`, no more answers
    await run(80_000);
    expect(reports(a).at(-1)!.visible).toBe(false);
  });
});

describe("F0.3 — pause, wake and silence", () => {
  it("a hidden leader keeps the stream while any tab is visible; it pauses when every tab has been hidden for 60 s, and wakes when one is shown", async () => {
    const a = await tab("A");
    const b = await tab("B");
    const seenA: string[] = [];
    const seenB: string[] = [];
    sub(a, (e) => seenA.push(e.kind));
    await flush();
    sub(b, (e) => seenB.push(e.kind));
    await flush();
    streams()[0]!.frame({ kind: "message.created" }, "42");
    hide(a, true);
    await run(100_000);
    expect(streams()[0]!.closed).toBe(false); // B is still looking
    hide(b, true);
    await run(50_000);
    expect(streams()[0]!.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(streams()[0]!.closed).toBe(true); // everybody hidden for 60 s
    seenA.length = 0;
    seenB.length = 0;
    hide(b, false); // a FOLLOWER is shown: the (hidden) leader wakes
    await flush();
    expect(streams()).toHaveLength(2);
    expect(streams()[1]!.owner).toBe(a);
    expect(streams()[1]!.url).toContain("lastEventId=42");
    expect(seenA).toContain("conversation.changed");
    expect(seenB).toContain("conversation.changed");
  });

  it("a follower that hears nothing from the leader for 60 s polls every 15 s, like a stream that is down; a sign of life stops it", async () => {
    const a = await tab("A");
    const b = await tab("B");
    const seenB: string[] = [];
    sub(a);
    await flush();
    sub(b, (e) => seenB.push(e.kind));
    await flush();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(inTab(b, () => b.mod.streamStateForTests()?.polling)).toBe(true);
    seenB.length = 0;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(seenB).toEqual(["conversation.changed"]);
    streams()[0]!.emit("ping");
    expect(inTab(b, () => b.mod.streamStateForTests()?.polling)).toBe(false);
  });

  it("every sign of life resets the follower's silence", async () => {
    const a = await tab("A");
    const b = await tab("B");
    sub(a);
    await flush();
    sub(b);
    await flush();
    await run(50_000);
    await run(50_000);
    expect(inTab(b, () => b.mod.streamStateForTests()?.polling)).toBe(false);
  });
});

describe("presence.changed", () => {
  it("reaches the presence handlers of every tab and never a screen's handler; a refetch signal reaches both", async () => {
    const a = await tab("A");
    const b = await tab("B");
    const screens: string[] = [];
    const presence: string[] = [];
    sub(a, (e) => screens.push(`A:${e.kind}`), () => presence.push("A"));
    await flush();
    sub(b, (e) => screens.push(`B:${e.kind}`), () => presence.push("B"));
    await flush();
    streams()[0]!.frame({ kind: "presence.changed" });
    expect(presence).toEqual(["A", "B"]);
    expect(screens).toEqual([]);
    streams()[0]!.emit("reload");
    expect(screens).toEqual(["A:conversation.changed", "B:conversation.changed"]);
    expect(presence).toEqual(["A", "B", "A", "B"]);
  });

  it("a presence frame never moves the event id (it has none)", async () => {
    const a = await tab("A");
    sub(a);
    await flush();
    streams()[0]!.frame({ kind: "message.created" }, "9");
    streams()[0]!.frame({ kind: "presence.changed" });
    expect(inTab(a, () => a.mod.streamStateForTests()?.lastEventId)).toBe("9");
  });
});
