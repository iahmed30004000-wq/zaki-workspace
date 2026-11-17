import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The independent review of F0 (docs/restructure/pr/F0.R.md), the parts that need no database:
 *  - a visibility report from a tab with no stream changes nothing (it used to change ALL of the person's streams);
 *  - coming back online while the tab is hidden does not reopen the stream (it used to un-pause it);
 *  - a screen opened AFTER an eviction still knows about it;
 *  - the page re-reports its visibility at every ping, so one lost report is corrected within a beat;
 *  - a failed first connect of the listener is retried (the early return in the scheduler made it give up).
 */

import { addClient, resetHubForTests, setStreamViewing, streamsViewingOf } from "@/server/realtime/hub";

describe("the hub", () => {
  beforeEach(() => resetHubForTests());
  it("a report from a tab that has no stream changes nothing", () => {
    addClient({ userId: "u1", orgId: "o1", tabId: "visible-tab", send: () => undefined, close: () => undefined });
    setStreamViewing("u1", false, "evicted-tab"); // an evicted tab went hidden: it must not hide the visible one
    expect(streamsViewingOf("u1").map((s) => s.viewing)).toEqual([true]);
    setStreamViewing("u1", false, "visible-tab");
    expect(streamsViewingOf("u1").map((s) => s.viewing)).toEqual([false]);
  });
  it("an old page that sends no tab id still reports for all of the person's streams", () => {
    addClient({ userId: "u2", orgId: "o1", tabId: "a", send: () => undefined, close: () => undefined });
    addClient({ userId: "u2", orgId: "o1", send: () => undefined, close: () => undefined });
    setStreamViewing("u2", false);
    expect(streamsViewingOf("u2").map((s) => s.viewing)).toEqual([false, false]);
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((m: { data: string; lastEventId: string }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  listeners = new Map<string, (m: { data: string }) => void>();
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  addEventListener(name: string, fn: (m: { data: string }) => void) {
    this.listeners.set(name, fn);
  }
  emit(name: string, data = "{}") {
    this.listeners.get(name)?.({ data });
  }
}
const docHandlers = new Map<string, () => void>();
const winHandlers = new Map<string, () => void>();
const doc = { hidden: false, visibilityState: "visible", addEventListener: (n: string, f: () => void) => docHandlers.set(n, f), removeEventListener: (n: string) => docHandlers.delete(n) };
const nav = { onLine: true };
const fetchMock = vi.fn();
vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
vi.stubGlobal("navigator", nav);
vi.stubGlobal("window", { addEventListener: (n: string, f: () => void) => winHandlers.set(n, f), removeEventListener: (n: string) => winHandlers.delete(n), location: { assign: vi.fn() } });
vi.stubGlobal("document", doc);

describe("the page", () => {
  let mod: typeof import("@/lib/realtime/use-realtime");
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    docHandlers.clear();
    winHandlers.clear();
    doc.hidden = false;
    doc.visibilityState = "visible";
    nav.onLine = true;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    mod = await import("@/lib/realtime/use-realtime");
    mod.resetRealtimeForTests();
  });
  afterEach(() => {
    mod.resetRealtimeForTests();
    vi.useRealTimers();
  });

  it("coming back online while the tab is hidden does not reopen the stream; showing the tab does", () => {
    mod.subscribeForTests(() => undefined);
    doc.hidden = true;
    doc.visibilityState = "hidden";
    docHandlers.get("visibilitychange")?.();
    vi.advanceTimersByTime(61_000); // hidden for 60 s: the stream is closed
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    nav.onLine = false;
    winHandlers.get("offline")?.();
    nav.onLine = true;
    winHandlers.get("online")?.();
    expect(FakeEventSource.instances).toHaveLength(1); // still hidden: nothing reopened
    doc.hidden = false;
    doc.visibilityState = "visible";
    docHandlers.get("visibilitychange")?.();
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("a screen opened after an eviction still knows the stream was taken over", () => {
    mod.subscribeForTests(() => undefined);
    FakeEventSource.instances[0]!.emit("bye", JSON.stringify({ reason: "evicted" }));
    expect(mod.streamEvictedNow()).toBe(true);
  });

  it("re-reports its visibility at every ping (a lost report is corrected within a beat)", () => {
    mod.subscribeForTests(() => undefined);
    const es = FakeEventSource.instances[0]!;
    fetchMock.mockClear();
    es.emit("ping", "1");
    es.emit("ping", "2");
    const reports = fetchMock.mock.calls.filter((c) => String(c[0]) === "/api/rt/visibility");
    expect(reports).toHaveLength(2);
    expect((reports[0]![1] as { keepalive?: boolean }).keepalive).toBe(true);
  });
});
