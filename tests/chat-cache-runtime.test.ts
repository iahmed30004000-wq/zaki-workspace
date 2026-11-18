import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { setEconomy } from "@/lib/economy";
import { chatKeys } from "@/lib/chat/cache/keys";
import { chatRetry } from "@/lib/chat/cache/http";
import { headerQueryOptions, listQueryOptions, messagesQueryOptions, messagesRequestUrl } from "@/lib/chat/cache/queries";
import { frameWantsSync, HIDDEN_RESYNC_MS, installChatRuntime, scheduleSync, type RuntimeDeps } from "@/lib/chat/cache/runtime";
import { SYNC_COALESCE_MS } from "@/lib/chat/cache/sync";
import { CHAT_GC_MS } from "@/lib/chat/cache/constants";
import { createHoverPrefetch, HOVER_PREFETCH_MS, prefetchStartup, startupCandidates } from "@/lib/chat/cache/prefetch";
import { memoryStartStore } from "@/lib/chat/cache/device-store";
import { LATEST, type ChatListDto, type ChatRowDto, type MessageDto, type MessagesData, type MessagesPageDto } from "@/lib/chat/cache/types";
import type { RealtimeEventPayload } from "@/lib/realtime/use-realtime";

const at = (n: number) => `2026-11-16T10:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`;
const msg = (id: string, n: number): MessageDto => ({ id, kind: "TEXT", body: `نص ${id}`, deleted: false, edited: false, pinned: false, mine: false, authorId: "u2", authorName: "سلمى", createdAt: at(n), clientId: null, mentions: [], attachments: [], reactions: [] });
const page = (messages: MessageDto[], over: Partial<MessagesPageDto> = {}): MessagesPageDto => ({ messages, hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [], ...over });
const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({ id, kind: "DM", title: `محادثة ${id}`, emoji: null, space: null, lastMessage: null, unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false, ...over });
const last = (id: string, n: number) => ({ id, authorName: "سلمى", preview: "x", kind: "TEXT" as const, at: at(n), mine: false });

/** What the page's `fetch` answers, by address; every address asked is kept in order. */
function network(routes: Record<string, unknown | ((url: string) => unknown)>) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      asked.push(url);
      const key = Object.keys(routes).find((k) => url === k || url.startsWith(k));
      if (!key) return new Response(JSON.stringify({ error: "x" }), { status: 404 });
      const r = routes[key];
      const body = typeof r === "function" ? (r as (u: string) => unknown)(url) : r;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return asked;
}

function events() {
  const map = new Map<string, Set<() => void>>();
  const target = {
    visibilityState: "visible" as string,
    addEventListener: (type: string, fn: () => void) => void (map.get(type) ?? map.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: () => void) => void map.get(type)?.delete(fn),
    fire: (type: string) => map.get(type)?.forEach((fn) => fn()),
  };
  return target;
}

const staff = (over: Partial<RuntimeDeps> = {}): Partial<RuntimeDeps> => ({
  me: async () => ({ status: "ok", userId: "u1" }),
  external: async () => false,
  storeFor: () => memoryStartStore(),
  holdsDeviceCache: async () => false,
  owners: async () => ({ owners: new Set<string>() }),
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setEconomy(false);
});

describe("which frames ask the feed", () => {
  it("everything that can change what the cache holds; never the stream-only ones", () => {
    for (const kind of ["message.created", "message.edited", "message.deleted", "message.reacted", "message.pinned", "poll.voted", "ticket.changed", "conversation.read", "conversation.delivered", "conversation.changed", "membership.changed"]) {
      expect(frameWantsSync({ kind }), kind).toBe(true);
    }
    for (const kind of ["typing", "presence.changed", "whiteboard.changed", "call.ring", "call.changed", "watch.changed"]) expect(frameWantsSync({ kind }), kind).toBe(false);
    // a reconnect or a return to the tab is a synthetic refetch signal: it asks too
    expect(frameWantsSync({ kind: "conversation.changed", synthetic: true })).toBe(true);
  });
});

describe("the runtime: frames, reconnect, focus, online", () => {
  beforeEach(() => vi.useFakeTimers());

  function started() {
    const qc = new QueryClient();
    const asked = network({ "/api/chat/sync": () => ({ cursor: "10", messages: [], reads: [], delivered: [], rows: [], removed: [] }) });
    const win = events();
    const doc = events();
    let handler: ((e: RealtimeEventPayload) => void) | null = null;
    let clock = 1_000_000;
    const rt = installChatRuntime(qc, staff({ frames: (h) => ((handler = h), () => void (handler = null)), win: win as never, doc: doc as never, now: () => clock }));
    return { qc, rt, asked, win, doc, frame: (e: RealtimeEventPayload) => handler?.(e), tick: (ms: number) => (clock += ms) };
  }

  it("a frame asks the feed (folded 120 ms), a typing frame does not", async () => {
    const t = started();
    await t.rt.ensure();
    expect(t.asked).toEqual(["/api/chat/sync"]); // the cold start learned where «now» is
    t.frame({ kind: "typing", conversationId: "c1" });
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(t.asked).toHaveLength(1);
    t.frame({ kind: "message.created", conversationId: "c1" });
    t.frame({ kind: "message.created", conversationId: "c1" });
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(t.asked).toEqual(["/api/chat/sync", "/api/chat/sync?after=10"]);
    t.rt.dispose();
  });

  it("coming online asks the feed", async () => {
    const t = started();
    await t.rt.ensure();
    t.win.fire("online");
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(t.asked).toHaveLength(2);
    t.rt.dispose();
  });

  it("a tab that was hidden for more than 60 s asks when it is shown again; a short absence does not", async () => {
    const t = started();
    await t.rt.ensure();
    t.doc.visibilityState = "hidden";
    t.doc.fire("visibilitychange");
    t.tick(HIDDEN_RESYNC_MS - 1_000);
    t.doc.visibilityState = "visible";
    t.doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(t.asked).toHaveLength(1);
    t.doc.visibilityState = "hidden";
    t.doc.fire("visibilitychange");
    t.tick(HIDDEN_RESYNC_MS + 1_000);
    t.doc.visibilityState = "visible";
    t.doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(t.asked).toHaveLength(2);
    t.rt.dispose();
  });

  it("scheduleSync(qc) is the public entry: the same folded question", async () => {
    const t = started();
    await t.rt.ensure();
    scheduleSync(t.qc);
    scheduleSync(t.qc);
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(t.asked).toHaveLength(2);
    t.rt.dispose();
  });

  it("the safety refresh asks the feed and refetches what is on screen, every period", async () => {
    const qc = new QueryClient();
    const asked = network({ "/api/chat/sync": () => ({ cursor: "10", messages: [], reads: [], delivered: [], rows: [], removed: [] }) });
    const rt = installChatRuntime(qc, staff({ frames: () => () => undefined, win: events() as never, doc: events() as never, safetyMs: () => 300_000 }));
    await rt.ensure();
    await vi.advanceTimersByTimeAsync(300_000 + SYNC_COALESCE_MS + 10);
    expect(asked).toEqual(["/api/chat/sync", "/api/chat/sync?after=10"]);
    await vi.advanceTimersByTimeAsync(300_000 + SYNC_COALESCE_MS + 10);
    expect(asked).toHaveLength(3);
    rt.dispose();
  });
});

describe("the safety refresh touches only what is on screen", () => {
  beforeEach(() => vi.useFakeTimers());

  it("a conversation nobody looks at is NOT made stale by it (a stale one would be dropped from the device copy)", async () => {
    const qc = new QueryClient();
    const asked = network({ "/api/chat/sync": () => ({ cursor: "10", messages: [], reads: [], delivered: [], rows: [], removed: [] }) });
    const rt = installChatRuntime(qc, staff({ safetyMs: () => 300_000 }));
    await rt.ensure();
    qc.setQueryData(chatKeys.list(), { scope: "all", spaceId: null, canOversee: false, rows: [row("c1")] });
    qc.setQueryData(chatKeys.messages("c1"), { pages: [page([msg("a", 1)])], pageParams: [LATEST] });
    await vi.advanceTimersByTimeAsync(300_000 + SYNC_COALESCE_MS + 10);
    expect(asked).toContain("/api/chat/sync?after=10");
    expect(qc.getQueryState(chatKeys.messages("c1"))!.isInvalidated).toBe(false);
    expect(qc.getQueryState(chatKeys.list())!.isInvalidated).toBe(false);
    rt.dispose();
  });
});

describe("a cursor that arrives late makes everything fetched before it stale", () => {
  beforeEach(() => vi.useFakeTimers());

  it("the first chat query goes on without it after 4 s; when it comes, what was read before it is asked for again (it is not current to the cursor)", async () => {
    const qc = new QueryClient();
    let release!: (v: unknown) => void;
    const hang = new Promise((r) => (release = r));
    const rt = installChatRuntime(qc, staff({ sync: { fetchJson: async <T,>() => (await hang) as T, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), isOnline: () => true } }));
    const ready = rt.ensure();
    await vi.advanceTimersByTimeAsync(4_000);
    await ready;
    expect(rt.engine.cursor).toBeNull();
    qc.setQueryData(chatKeys.list(), { scope: "all", spaceId: null, canOversee: false, rows: [row("c1")] });
    release({ cursor: "9", messages: [], reads: [], delivered: [], rows: [], removed: [] });
    await vi.advanceTimersByTimeAsync(10);
    expect(rt.engine.cursor).toBe("9");
    expect(qc.getQueryState(chatKeys.list())!.isInvalidated).toBe(true);
    rt.dispose();
  });
});

describe("a fetch that was in the air while the feed moved on does not erase what the feed said", () => {
  beforeEach(() => vi.useFakeTimers());

  it("when a chat query settles and the cursor moved since it started, the engine goes back to where the query started and asks again (a replay is harmless)", async () => {
    const qc = new QueryClient();
    let releaseList!: () => void;
    const listGate = new Promise<void>((r) => (releaseList = r));
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      asked.push(url);
      if (url.startsWith("/api/chat/list")) {
        await listGate;
        return new Response(JSON.stringify({ scope: "all", spaceId: null, canOversee: false, rows: [row("c1")] }), { status: 200 });
      }
      const after = new URL(url, "http://x").searchParams.get("after");
      return new Response(JSON.stringify({ cursor: after === "10" ? "11" : after === null ? "10" : "12", messages: [], reads: [], delivered: [], rows: [], removed: [] }), { status: 200 });
    }));
    const rt = installChatRuntime(qc, staff());
    const fetching = qc.fetchQuery(listQueryOptions());
    await vi.advanceTimersByTimeAsync(10);
    expect(rt.engine.cursor).toBe("10");
    // while the list is in the air an event arrives and the feed applies it
    rt.engine.schedule();
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(rt.engine.cursor).toBe("11");
    releaseList();
    await fetching;
    // the answer was read BEFORE event 11 was applied: the engine is back at 10 and asks again from there
    expect(rt.engine.cursor).toBe("10");
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(asked.filter((u) => u.startsWith("/api/chat/sync?after=10")).length).toBe(2);
    expect(rt.engine.cursor).toBe("11");
    rt.dispose();
  });

  it("a query that settles while the cursor did not move changes nothing", async () => {
    const qc = new QueryClient();
    const asked = network({ "/api/chat/sync": { cursor: "10", messages: [], reads: [], delivered: [], rows: [], removed: [] }, "/api/chat/list": { scope: "all", spaceId: null, canOversee: false, rows: [] } });
    const rt = installChatRuntime(qc, staff());
    await qc.fetchQuery(listQueryOptions());
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(asked).toEqual(["/api/chat/sync", "/api/chat/list"]);
    expect(rt.engine.cursor).toBe("10");
    rt.dispose();
  });
});

describe("timers and listeners do not outlive the wipe", () => {
  beforeEach(() => vi.useFakeTimers());

  it("the safety refresh stops re-arming once the engine is stopped, and starts again with the next use", async () => {
    const qc = new QueryClient();
    network({ "/api/chat/sync": { cursor: "10", messages: [], reads: [], delivered: [], rows: [], removed: [] } });
    const rt = installChatRuntime(qc, staff({ safetyMs: () => 300_000, frames: () => () => undefined, win: events() as never, doc: events() as never }));
    await rt.ensure();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    rt.reset();
    await vi.advanceTimersByTimeAsync(300_000 + 10);
    expect(vi.getTimerCount()).toBe(0);
    await rt.ensure();
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    rt.dispose();
  });

  it("a different person signing in: after the wipe the engine has a cursor again (the wipe erased the one the first query learned), and what was read before it is asked for again", async () => {
    const qc = new QueryClient();
    network({ "/api/chat/sync": { cursor: "10", messages: [], reads: [], delivered: [], rows: [], removed: [] } });
    const rt = installChatRuntime(qc, staff({ me: async () => ({ status: "ok", userId: "bob" }), owners: async () => ({ owners: new Set(["alice"]) }) }));
    await rt.ensure();
    await rt.whenBooted();
    await vi.advanceTimersByTimeAsync(10);
    expect(rt.engine.cursor).toBe("10");
    expect(rt.engine.isStopped).toBe(false);
    expect(rt.userId).toBe("bob");
    rt.dispose();
  });
});

describe("how long a conversation is kept without a screen", () => {
  it("long enough that the device copy is not shrunk by a tab left open (at least 6 hours), for EVERY chat query, even one made by setQueryData", async () => {
    const qc = new QueryClient();
    network({ "/api/chat/sync": { cursor: "1", messages: [], reads: [], delivered: [], rows: [], removed: [] } });
    const rt = installChatRuntime(qc, staff());
    await rt.ensure();
    expect(CHAT_GC_MS).toBeGreaterThanOrEqual(6 * 3_600_000);
    for (const key of [chatKeys.list(), chatKeys.space("s1"), chatKeys.header("c1"), chatKeys.messages("c1")]) {
      expect(qc.getQueryDefaults(key).gcTime, JSON.stringify(key)).toBe(CHAT_GC_MS);
    }
    rt.dispose();
  });
});

describe("a cold start: the cursor is learned BEFORE the list is read", () => {
  it("the first chat query asks the feed where «now» is, then the list — nothing that happens in between is lost", async () => {
    const qc = new QueryClient();
    const list: ChatListDto = { scope: "all", spaceId: null, canOversee: false, rows: [row("d1")] };
    const asked = network({ "/api/chat/sync": { cursor: "77", messages: [], reads: [], delivered: [], rows: [], removed: [] }, "/api/chat/list": list });
    const rt = installChatRuntime(qc, staff());
    const got = await qc.fetchQuery(listQueryOptions());
    expect(got.rows[0]!.id).toBe("d1");
    expect(asked).toEqual(["/api/chat/sync", "/api/chat/list"]);
    expect(rt.engine.cursor).toBe("77");
    // the second query does not ask for a cursor again
    await qc.fetchQuery(headerQueryOptions("c1")).catch(() => undefined);
    expect(asked.filter((u) => u === "/api/chat/sync")).toHaveLength(1);
    rt.dispose();
  });

  it("a failed cursor request does not stop the list (the line asks again later)", async () => {
    const qc = new QueryClient();
    const asked = network({ "/api/chat/list": { scope: "all", spaceId: null, canOversee: false, rows: [] } });
    const rt = installChatRuntime(qc, staff());
    await expect(qc.fetchQuery(listQueryOptions())).resolves.toBeDefined();
    expect(asked[0]).toBe("/api/chat/sync");
    rt.dispose();
  });
});

describe("the queries", () => {
  it("the messages are an infinite query of windows of 50: the older cursor is the first message of the first window, the newer one only while the last window does not reach the end", () => {
    const o = messagesQueryOptions("c1");
    expect(o.queryKey).toEqual(["chat", "conv", "c1", "messages"]);
    expect(o.initialPageParam).toEqual(LATEST);
    expect(o.getPreviousPageParam(page([msg("a", 1), msg("b", 2)], { hasOlder: true }))).toEqual({ kind: "before", id: "a" });
    expect(o.getPreviousPageParam(page([msg("a", 1)], { hasOlder: false }))).toBeUndefined();
    expect(o.getNextPageParam(page([msg("a", 1), msg("b", 2)], { hasNewer: true }))).toEqual({ kind: "after", id: "b" });
    expect(o.getNextPageParam(page([msg("a", 1)]))).toBeUndefined();
    expect(messagesQueryOptions("c1", { around: "m9" }).initialPageParam).toEqual({ kind: "around", id: "m9" });
  });

  it("each window asks its own address", () => {
    expect(messagesRequestUrl("c1", LATEST)).toBe("/api/chat/conversations/c1/messages?limit=50");
    expect(messagesRequestUrl("c1", { kind: "before", id: "m1" })).toBe("/api/chat/conversations/c1/messages?limit=50&before=m1");
    expect(messagesRequestUrl("c1", { kind: "after", id: "m1" })).toBe("/api/chat/conversations/c1/messages?limit=50&after=m1");
    expect(messagesRequestUrl("c1", { kind: "around", id: "m1" })).toBe("/api/chat/conversations/c1/messages?limit=50&around=m1");
  });

  it("keys are the family the guard test watches", () => {
    expect(chatKeys.list()).toEqual(["chat", "list"]);
    expect(chatKeys.space("s1")).toEqual(["chat", "space", "s1"]);
    expect(chatKeys.header("c1")).toEqual(["chat", "conv", "c1", "header"]);
  });

  it("a conversation that answers «no» (404) is not asked again; a fault is retried once", () => {
    expect(chatRetry(0, new ApiError("chat.e.not_found", 404))).toBe(false);
    expect(chatRetry(0, new ApiError("x", 403))).toBe(false);
    expect(chatRetry(0, new ApiError("x", 500))).toBe(true);
    expect(chatRetry(1, new ApiError("x", 500))).toBe(false);
    expect(chatRetry(0, new TypeError("network"))).toBe(true);
  });

  it("a fetched window lands normalized: a deleted message that came with text is a tombstone", async () => {
    const qc = new QueryClient();
    network({ "/api/chat/sync": { cursor: "1", messages: [], reads: [], delivered: [], rows: [], removed: [] }, "/api/chat/conversations/c1/messages": page([{ ...msg("a", 1), deleted: true, body: "سر" }]) });
    const rt = installChatRuntime(qc, staff());
    const data = await qc.fetchInfiniteQuery(messagesQueryOptions("c1"));
    expect(JSON.stringify(data)).not.toContain("سر");
    rt.dispose();
  });
});

describe("prefetch", () => {
  beforeEach(() => vi.useFakeTimers());

  function warm() {
    const qc = new QueryClient();
    const asked = network({
      "/api/chat/sync": { cursor: "1", messages: [], reads: [], delivered: [], rows: [], removed: [] },
      "/api/chat/conversations/c1/header": { id: "c1" },
      "/api/chat/conversations/c1/messages": page([msg("a", 1)]),
      "/api/chat/conversations/c2/header": { id: "c2" },
      "/api/chat/conversations/c2/messages": page([msg("b", 1)]),
      "/api/chat/conversations/c3/header": { id: "c3" },
      "/api/chat/conversations/c3/messages": page([msg("c", 1)]),
      "/api/chat/conversations/c4/header": { id: "c4" },
      "/api/chat/conversations/c4/messages": page([msg("d", 1)]),
    });
    const rt = installChatRuntime(qc, staff());
    return { qc, asked, rt };
  }

  it("a mouse resting on a row for 150 ms fetches the header and the first window; leaving first cancels; a touch does nothing", async () => {
    const { qc, asked, rt } = warm();
    const hover = createHoverPrefetch(qc, "c1");
    hover.enter("mouse");
    await vi.advanceTimersByTimeAsync(HOVER_PREFETCH_MS - 1);
    expect(asked.filter((u) => u.includes("/c1/"))).toEqual([]);
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(50);
    expect(asked.filter((u) => u.includes("/c1/")).sort()).toEqual(["/api/chat/conversations/c1/header", "/api/chat/conversations/c1/messages?limit=50"]);

    const left = createHoverPrefetch(qc, "c2");
    left.enter("mouse");
    await vi.advanceTimersByTimeAsync(100);
    left.leave();
    await vi.advanceTimersByTimeAsync(500);
    const touch = createHoverPrefetch(qc, "c2");
    touch.enter("touch");
    touch.enter("pen");
    await vi.advanceTimersByTimeAsync(500);
    expect(asked.filter((u) => u.includes("/c2/"))).toEqual([]);
    rt.dispose();
  });

  it("what is already fresh is not asked again", async () => {
    const { qc, asked, rt } = warm();
    const hover = createHoverPrefetch(qc, "c1");
    hover.enter();
    await vi.advanceTimersByTimeAsync(300);
    const first = asked.length;
    hover.leave();
    hover.enter();
    await vi.advanceTimersByTimeAsync(300);
    expect(asked).toHaveLength(first);
    expect(qc.getQueryData<MessagesData>(chatKeys.messages("c1"))).toBeDefined();
    rt.dispose();
  });

  it("at startup: the first window of the 3 most recent chats that have something unread — chips of a forum row included", () => {
    const rows = [
      row("c1", { unread: 1, lastMessage: last("m", 10) }),
      row("c2", { unread: 0, lastMessage: last("m", 99) }), // read: not warmed
      row("c3", { unread: 4, lastMessage: last("m", 50) }),
      row("s1", { kind: "SPACE", unread: 3, lastMessage: last("m", 70), topicChips: [{ id: "t1", title: "عام", emoji: null, unread: 3 }, { id: "t2", title: "ب", emoji: null, unread: 0 }] }),
      row("c4", { unread: 2, lastMessage: last("m", 5) }),
    ];
    expect(startupCandidates(rows)).toEqual(["t1", "c3", "c1"]);
    expect(startupCandidates(rows, 4)).toEqual(["t1", "c3", "c1", "c4"]);
  });

  it("startup prefetch runs once per page, and never in economy mode", async () => {
    const { qc, asked, rt } = warm();
    const rows = [row("c1", { unread: 1, lastMessage: last("m", 10) }), row("c2", { unread: 1, lastMessage: last("m", 20) })];
    expect(prefetchStartup(qc, rows)).toEqual(["c2", "c1"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(asked.filter((u) => u.includes("/messages"))).toHaveLength(2);
    expect(prefetchStartup(qc, rows)).toEqual([]);
    rt.dispose();

    setEconomy(true);
    const other = warm();
    expect(prefetchStartup(other.qc, rows)).toEqual([]);
    other.rt.dispose();
  });
});
