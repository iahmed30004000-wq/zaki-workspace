import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canMarkReadNow } from "@/lib/chat/read-gate";

/**
 * F0.5 (page half): a message is marked read only while the tab is VISIBLE and the window FOCUSED (the other person's ✓✓ must
 * mean «seen»); the tab tells the server whether it is being looked at, with its own id, so the push is held back only for a
 * person who is really looking.
 */

describe("canMarkReadNow", () => {
  it("is true only for a visible, focused page", () => {
    expect(canMarkReadNow({ visibilityState: "visible", hasFocus: () => true })).toBe(true);
    expect(canMarkReadNow({ visibilityState: "hidden", hasFocus: () => true })).toBe(false);
    expect(canMarkReadNow({ visibilityState: "visible", hasFocus: () => false })).toBe(false);
  });
});

describe("the conversation screen", () => {
  const src = readFileSync(join(process.cwd(), "src/components/chat/conversation/conversation-screen.tsx"), "utf8");
  it("marks read through the gate and once more when the person comes back", () => {
    expect(src).toContain("canMarkReadNow(");
    expect(src).toContain("pendingRead");
    expect(src).toMatch(/addEventListener\("visibilitychange"/);
    expect(src).toMatch(/addEventListener\("focus"/);
  });
});

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
const fetchMock = vi.fn().mockResolvedValue({ ok: true });
const docHandlers = new Map<string, () => void>();
const doc = { hidden: false, visibilityState: "visible", addEventListener: (n: string, f: () => void) => docHandlers.set(n, f), removeEventListener: (n: string) => docHandlers.delete(n) };
vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
vi.stubGlobal("navigator", { onLine: true });
vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined, location: { assign: vi.fn() } });
vi.stubGlobal("document", doc);

describe("the tab reports its visibility", () => {
  let mod: typeof import("@/lib/realtime/use-realtime");
  beforeEach(async () => {
    vi.resetModules();
    FakeEventSource.instances = [];
    fetchMock.mockClear();
    docHandlers.clear();
    doc.hidden = false;
    doc.visibilityState = "visible";
    mod = await import("@/lib/realtime/use-realtime");
    mod.resetRealtimeForTests();
  });
  afterEach(() => mod.resetRealtimeForTests());

  const reports = () =>
    fetchMock.mock.calls.filter((c) => String(c[0]) === "/api/rt/visibility").map((c) => JSON.parse(String((c[1] as { body: string }).body)) as { visible: boolean; tab: string });

  it("opens its stream with a tab id, and says so with the same id when it is hidden and shown", () => {
    mod.subscribeForTests(() => undefined);
    const url = FakeEventSource.instances[0]!.url;
    const tab = new URL(url, "http://x").searchParams.get("tab");
    expect(tab).toBeTruthy();
    doc.hidden = true;
    doc.visibilityState = "hidden";
    docHandlers.get("visibilitychange")?.();
    doc.hidden = false;
    doc.visibilityState = "visible";
    docHandlers.get("visibilitychange")?.();
    expect(reports().map((r) => r.visible)).toEqual([false, true]);
    expect(new Set(reports().map((r) => r.tab))).toEqual(new Set([tab]));
  });

  it("tells the server how it stands as soon as the stream opens (a tab opened in the background is hidden from the start)", () => {
    doc.hidden = true;
    doc.visibilityState = "hidden";
    mod.subscribeForTests(() => undefined);
    FakeEventSource.instances[0]!.onopen?.();
    expect(reports().at(-1)?.visible).toBe(false);
  });

  it("keeps the same tab id across a reconnect", () => {
    vi.useFakeTimers();
    mod.subscribeForTests(() => undefined);
    const first = new URL(FakeEventSource.instances[0]!.url, "http://x").searchParams.get("tab");
    FakeEventSource.instances[0]!.onerror?.();
    vi.advanceTimersByTime(2000);
    const second = new URL(FakeEventSource.instances[1]!.url, "http://x").searchParams.get("tab");
    expect(second).toBe(first);
    vi.useRealTimers();
  });
});
