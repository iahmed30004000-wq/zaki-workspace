import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C1.3 / F1.5 — badges, presence and the spaces' counts from frames; the polls that fed them are gone.
 *
 * A poll is removed only after the frame path that replaces it is proven here:
 *  - `watchFrames` (the non-React core of every `useFrameRefresh`) refetches ONCE per burst of matching frames, after its delay, and
 *    never for a frame that does not match; the presence kind reaches only the presence handler;
 *  - the unread number, the space counts, the people dock and the quick chat ask which frames move them (small pure functions);
 *  - each screen is wired to it and keeps NO timer of its own shorter than the 5-minute safety refresh, read through pollMs().
 * What is NOT here: the bell's non-chat notifications have no frame (a task or an approval writes a row and emits nothing), so the
 * bell keeps its 30 s poll and only gains the frame refresh for the chat's own.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string; lastEventId: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (m: { data: string }) => void>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {}
  addEventListener(name: string, fn: (m: { data: string }) => void) {
    this.listeners.set(name, fn);
  }
  frame(payload: Record<string, unknown>, id = "") {
    this.onmessage?.({ data: JSON.stringify(payload), lastEventId: id });
  }
}
vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
vi.stubGlobal("navigator", { onLine: true });
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined, location: { assign: vi.fn() } });
vi.stubGlobal("document", { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined });

describe("watchFrames: the frame path behind every badge", () => {
  let mod: typeof import("@/lib/realtime/live-refresh");
  let rt: typeof import("@/lib/realtime/use-realtime");
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    rt = await import("@/lib/realtime/use-realtime");
    mod = await import("@/lib/realtime/live-refresh");
  });
  afterEach(() => {
    rt.resetRealtimeForTests();
    vi.useRealTimers();
  });
  const es = () => FakeEventSource.instances[0]!;

  it("a burst of matching frames refetches once, after the delay; a frame that does not match refetches nothing", () => {
    const refresh = vi.fn();
    const off = mod.watchFrames({ matches: (e) => e.kind === "message.created", delayMs: 400, onRefresh: refresh });
    es().frame({ kind: "typing", conversationId: "c1", userId: "u2" });
    es().frame({ kind: "message.reacted", conversationId: "c1" });
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
    es().frame({ kind: "message.created", conversationId: "c1" }, "1");
    vi.advanceTimersByTime(300);
    es().frame({ kind: "message.created", conversationId: "c2" }, "2");
    vi.advanceTimersByTime(99);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); // 400 ms after the FIRST frame: a steady stream cannot starve the refresh
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1); // the second frame was part of the same burst
    es().frame({ kind: "message.created", conversationId: "c1" }, "3");
    vi.advanceTimersByTime(401);
    expect(refresh).toHaveBeenCalledTimes(2); // the next burst
    off();
  });

  it("a reconnect's refetch signal (a synthetic conversation.changed) moves it like a real one", () => {
    const refresh = vi.fn();
    mod.watchFrames({ matches: (e) => e.kind === "conversation.changed", delayMs: 100, onRefresh: refresh });
    es().listeners.get("reload")?.({ data: "{}" });
    vi.advanceTimersByTime(150);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("the presence kind reaches only a presence watcher; a screen's matcher never sees it", () => {
    const screens = vi.fn();
    const people = vi.fn();
    mod.watchFrames({ matches: () => true, delayMs: 50, onRefresh: screens });
    mod.watchFrames({ presence: true, delayMs: 50, onRefresh: people });
    es().frame({ kind: "presence.changed" });
    vi.advanceTimersByTime(100);
    expect(screens).not.toHaveBeenCalled();
    expect(people).toHaveBeenCalledTimes(1);
  });

  it("stopping the watch cancels what was waiting and listens to nothing more", () => {
    const refresh = vi.fn();
    const off = mod.watchFrames({ matches: () => true, delayMs: 100, onRefresh: refresh });
    es().frame({ kind: "message.created" }, "1");
    off();
    vi.advanceTimersByTime(500);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("the safety refresh is five minutes, and economy mode stretches it (pollMs)", async () => {
    const { setEconomy } = await import("@/lib/economy");
    const { ECONOMY_POLL_FACTOR } = await import("@/lib/features");
    expect(mod.SAFETY_REFRESH_MS).toBe(300_000);
    setEconomy(false);
    expect(mod.safetyRefreshMs()).toBe(300_000);
    setEconomy(true);
    expect(mod.safetyRefreshMs()).toBe(300_000 * ECONOMY_POLL_FACTOR);
    setEconomy(false);
  });
});

describe("which frames move which number", () => {
  it("the unread total ignores somebody else's read mark and follows mine", async () => {
    const { movesUnread } = await import("@/lib/chat/use-chat-unread");
    expect(movesUnread({ kind: "message.created" })).toBe(true);
    expect(movesUnread({ kind: "conversation.read", userId: "u2" })).toBe(false);
    expect(movesUnread({ kind: "conversation.read", userId: "u1", self: true })).toBe(true);
    expect(movesUnread({ kind: "typing" })).toBe(false);
    expect(movesUnread({ kind: "conversation.changed", synthetic: true })).toBe(true);
  });

  it("the spaces' counts follow a message, a deletion, a door and my own read mark", async () => {
    const { movesSpaceCounts } = await import("@/lib/realtime/live-refresh");
    for (const kind of ["message.created", "message.deleted", "membership.changed", "conversation.changed"]) expect(movesSpaceCounts({ kind })).toBe(true);
    expect(movesSpaceCounts({ kind: "conversation.read", userId: "u2" })).toBe(false);
    expect(movesSpaceCounts({ kind: "conversation.read", userId: "u1", self: true })).toBe(true);
    for (const kind of ["typing", "message.reacted", "call.ring", "whiteboard.changed"]) expect(movesSpaceCounts({ kind })).toBe(false);
  });

  it("the quick chat's window follows the frames of its own conversation only (and the refetch signal, which names none)", async () => {
    const { touchesConversation } = await import("@/lib/realtime/live-refresh");
    expect(touchesConversation({ kind: "message.created", conversationId: "c1" }, "c1")).toBe(true);
    expect(touchesConversation({ kind: "message.created", conversationId: "c2" }, "c1")).toBe(false);
    expect(touchesConversation({ kind: "conversation.read", conversationId: "c1", userId: "u2" }, "c1")).toBe(true);
    expect(touchesConversation({ kind: "typing", conversationId: "c1" }, "c1")).toBe(false);
    expect(touchesConversation({ kind: "whiteboard.changed", conversationId: "c1" }, "c1")).toBe(false);
    expect(touchesConversation({ kind: "conversation.changed", synthetic: true }, "c1")).toBe(true);
    expect(touchesConversation({ kind: "presence.changed" }, "c1")).toBe(false);
  });
});

describe("the screens: wired to frames, no timer shorter than the safety refresh", () => {
  const src = {
    unread: read("src/lib/chat/use-chat-unread.ts"),
    dock: read("src/components/shell/people-dock.tsx"),
    spaces: read("src/components/shell/space-switcher.tsx"),
    quick: read("src/components/shell/quick-chat.tsx"),
    bell: read("src/components/notification-bell.tsx"),
  };

  it("the unread badge: no 30 s poll; frames, my own reads and the safety refresh", () => {
    expect(src.unread).not.toMatch(/refetchInterval: 30_000/);
    expect(src.unread).toMatch(/\.\.\.frameDrivenQuery\(\)/);
    expect(src.unread).toMatch(/useFrameRefresh\(/);
    expect(src.unread).toMatch(/movesUnread\(/);
    expect(src.unread).toMatch(/onChatRead\(/);
  });

  it("the people dock: no 30 s poll; presence frames and the safety refresh", () => {
    expect(src.dock).not.toMatch(/refetchInterval: 30_000/);
    expect(src.dock).toMatch(/\.\.\.frameDrivenQuery\(\)/);
    expect(src.dock).toMatch(/useFrameRefresh\(\{[^}]*presence: true/);
  });

  it("the spaces' counts: no 60 s poll; frames (one reader, the shell's) and the safety refresh", () => {
    expect(src.spaces).not.toMatch(/refetchInterval: 60_000/);
    expect(src.spaces).toMatch(/\.\.\.frameDrivenQuery\(\)/);
    expect(src.spaces).toMatch(/useFrameRefresh\(\{[^}]*enabled: sync/);
    expect(src.spaces).toMatch(/movesSpaceCounts/);
  });

  it("the quick chat: no 20 s and no 4 s poll; its own conversation's frames, presence frames and the safety refresh", () => {
    expect(src.quick).not.toMatch(/refetchInterval: 4_000/);
    expect(src.quick).not.toMatch(/refetchInterval: 20_000/);
    expect(src.quick).toMatch(/touchesConversation\(/);
    expect(src.quick).toMatch(/useFrameRefresh\(\{[^}]*presence: true/);
    expect(src.quick.match(/\.\.\.frameDrivenQuery\(\)/g)).toHaveLength(2);
    // it still reads the OLD detail route (kept for the phone app): moving it to the cache is C1.4's job
    expect(src.quick).toContain("/api/chat/conversations/${conversationId}?limit=30");
  });

  it("the bell: still polls every 30 s through pollMs (non-chat notifications have no frame) and also follows the chat's frames", () => {
    expect(src.bell).toMatch(/refetchInterval: pollMs\(30_000\)/);
    expect(src.bell).toMatch(/useFrameRefresh\(/);
  });

  it("no screen of this change keeps a bare timer: every period goes through pollMs or the safety refresh", () => {
    for (const [name, text] of Object.entries(src)) {
      for (const m of text.matchAll(/refetchInterval: ([^,\n]+)/g)) expect(m[1], `${name}: ${m[0]}`).toMatch(/pollMs\(|safetyRefreshMs\(/);
      expect(text, name).not.toMatch(/setInterval\(/);
    }
  });
});

describe("the public hook is untouched", () => {
  it("useRealtime, useTyping, useOnline and useStreamEvicted keep their names and shapes", () => {
    const text = read("src/lib/realtime/use-realtime.ts");
    for (const sig of ["export function useRealtime(handler: Handler): void", "export function useTyping(conversationId: string | null): TypingState", "export function useOnline(): boolean", "export function useStreamEvicted(): boolean"]) {
      expect(text).toContain(sig);
    }
  });
});
