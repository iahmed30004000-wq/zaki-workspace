import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the shared EventSource state machine of src/lib/realtime/use-realtime.ts,
 * driven through its test seam (subscribeForTests) with a fake EventSource.
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((m: { data: string; lastEventId: string }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  addEventListener() {}
}

vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
vi.stubGlobal("navigator", { onLine: true });
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
vi.stubGlobal("document", { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined });

const frame = (es: FakeEventSource, payload: Record<string, unknown>, id: string) =>
  es.onmessage?.({ data: JSON.stringify(payload), lastEventId: id });

describe("use-realtime shared stream", () => {
  let mod: typeof import("@/lib/realtime/use-realtime");

  beforeEach(async () => {
    vi.resetModules();
    FakeEventSource.instances = [];
    mod = await import("@/lib/realtime/use-realtime");
    mod.resetRealtimeForTests();
  });

  afterEach(() => {
    mod.resetRealtimeForTests();
    vi.useRealTimers();
  });

  it("one shared EventSource for every subscriber of the tab, closed with the last one", () => {
    const off1 = mod.subscribeForTests(() => undefined);
    const off2 = mod.subscribeForTests(() => undefined);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(mod.streamStateForTests()?.refs).toBe(2);
    off1();
    off2();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(mod.streamStateForTests()).toBeNull();
  });

  it("a new message reaches the screens (it used to stop at the typing state)", () => {
    const seen: string[] = [];
    mod.subscribeForTests((e) => seen.push(`${e.kind}:${e.conversationId ?? ""}`));
    const es = FakeEventSource.instances[0]!;
    frame(es, { kind: "message.created", conversationId: "cv1", messageId: "m1" }, "7");
    frame(es, { kind: "conversation.read", conversationId: "cv1", userId: "u2" }, "8");
    expect(seen).toEqual(["message.created:cv1", "conversation.read:cv1"]);
  });

  it("a typing frame stays in the typing state and never reaches the screens", () => {
    const seen: string[] = [];
    mod.subscribeForTests((e) => seen.push(e.kind));
    frame(FakeEventSource.instances[0]!, { kind: "typing", conversationId: "cv1", userId: "u2", name: "سارة" }, "9");
    expect(seen).toEqual([]);
  });

  it("a reconnect asks for what it missed: the last event id goes in the new stream's address", () => {
    vi.useFakeTimers();
    mod.subscribeForTests(() => undefined);
    const first = FakeEventSource.instances[0]!;
    // the stream carries this tab's own id (F0.5); nothing else until there is an event id to resume from
    expect(first.url).toMatch(/^\/api\/rt\?tab=[^&]+$/);
    frame(first, { kind: "message.created", conversationId: "cv1" }, "42");
    first.onerror?.();
    vi.advanceTimersByTime(1000);
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toMatch(/^\/api\/rt\?tab=[^&]+&lastEventId=42$/);
  });

  it("after three failed streams it polls, with a synthetic conversation.changed every 15 s", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    mod.subscribeForTests((e) => seen.push(e.kind));
    for (let i = 0; i < 3; i++) {
      FakeEventSource.instances.at(-1)!.onerror?.();
      vi.advanceTimersByTime(2000);
    }
    expect(mod.streamStateForTests()?.polling).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(seen).toContain("conversation.changed");
  });
});
