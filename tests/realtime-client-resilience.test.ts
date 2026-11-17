import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F0.2 / F0.3 on the page's side of the live line (src/lib/realtime/use-realtime.ts), through its test seam with a fake
 * EventSource that also keeps the NAMED listeners the page registers:
 *  - `bye` + `signed_out` goes to the sign-in page; `bye` + `evicted` does NOT reconnect (it would evict another of the
 *    person's streams: ping-pong) and falls back to polling every 60 s;
 *  - a 60 s watchdog, reset by ANY frame, closes a silent stream and reconnects;
 *  - the reconnect delay has ±30 % jitter;
 *  - a tab hidden for 60 s closes its stream and resumes, with a refetch, when it comes back.
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((m: { data: string; lastEventId: string }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  listeners = new Map<string, (m: { data: string; lastEventId?: string }) => void>();
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  addEventListener(name: string, fn: (m: { data: string; lastEventId?: string }) => void) {
    this.listeners.set(name, fn);
  }
  emit(name: string, data = "{}") {
    this.listeners.get(name)?.({ data });
  }
}

const assign = vi.fn();
const docHandlers = new Map<string, () => void>();
const doc = {
  hidden: false,
  addEventListener: (name: string, fn: () => void) => docHandlers.set(name, fn),
  removeEventListener: (name: string) => docHandlers.delete(name),
};
vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
vi.stubGlobal("navigator", { onLine: true });
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined, location: { assign } });
vi.stubGlobal("document", doc);

const frame = (es: FakeEventSource, payload: Record<string, unknown>, id: string) => es.onmessage?.({ data: JSON.stringify(payload), lastEventId: id });

describe("the page's side of the live line", () => {
  let mod: typeof import("@/lib/realtime/use-realtime");

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    assign.mockClear();
    docHandlers.clear();
    doc.hidden = false;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    mod = await import("@/lib/realtime/use-realtime");
    mod.resetRealtimeForTests();
  });
  afterEach(() => {
    mod.resetRealtimeForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("bye: signed_out goes to the sign-in page and does not reconnect", () => {
    mod.subscribeForTests(() => undefined);
    const es = FakeEventSource.instances[0]!;
    es.emit("bye", JSON.stringify({ reason: "signed_out" }));
    expect(assign).toHaveBeenCalledWith("/login");
    expect(es.closed).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("bye: evicted does NOT reconnect, polls every 60 s instead, and says so", () => {
    const seen: string[] = [];
    mod.subscribeForTests((e) => seen.push(e.kind));
    const es = FakeEventSource.instances[0]!;
    es.emit("bye", JSON.stringify({ reason: "evicted" }));
    expect(es.closed).toBe(true);
    expect(mod.streamStateForTests()?.evicted).toBe(true);
    vi.advanceTimersByTime(59_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1_500);
    expect(seen).toEqual(["conversation.changed"]);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("the watchdog: a stream silent for 60 s is closed and reopened; any frame resets it", () => {
    mod.subscribeForTests(() => undefined);
    const first = FakeEventSource.instances[0]!;
    vi.advanceTimersByTime(50_000);
    first.emit("ping", String(Date.now()));
    vi.advanceTimersByTime(50_000); // 100 s in, but only 50 s since the ping
    expect(first.closed).toBe(false);
    vi.advanceTimersByTime(11_000); // 61 s of silence
    expect(first.closed).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(2);
  });

  it("the reconnect delay carries ±30 % jitter", () => {
    const low = vi.spyOn(Math, "random").mockReturnValue(0);
    mod.subscribeForTests(() => undefined);
    FakeEventSource.instances[0]!.onerror?.(); // failure 1: base 500 ms → 350 ms at the low end
    vi.advanceTimersByTime(340);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(20);
    expect(FakeEventSource.instances).toHaveLength(2);
    low.mockReturnValue(1);
    FakeEventSource.instances[1]!.onerror?.(); // failure 2: base 1000 ms → 1300 ms at the high end
    vi.advanceTimersByTime(1_250);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("a tab hidden for 60 s closes its stream, and on return reconnects from where it was and refetches", () => {
    const seen: string[] = [];
    mod.subscribeForTests((e) => seen.push(e.kind));
    const first = FakeEventSource.instances[0]!;
    frame(first, { kind: "message.created", conversationId: "cv1" }, "42");
    seen.length = 0;
    doc.hidden = true;
    docHandlers.get("visibilitychange")?.();
    vi.advanceTimersByTime(59_000);
    expect(first.closed).toBe(false);
    vi.advanceTimersByTime(1_500);
    expect(first.closed).toBe(true);
    doc.hidden = false;
    docHandlers.get("visibilitychange")?.();
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toMatch(/^\/api\/rt\?tab=[^&]+&lastEventId=42$/);
    expect(seen).toEqual(["conversation.changed"]);
  });
});
