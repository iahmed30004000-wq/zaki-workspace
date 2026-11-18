import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import {
  applyCatchUp,
  applyReads,
  applySync,
  appendMessage,
  markConversationRead,
  removeConversation,
  replaceMessage,
  resetChatCache,
  seedFromDevice,
  tombstone,
  upsertRows,
} from "@/lib/chat/cache/writer";
import { chatKeys } from "@/lib/chat/cache/keys";
import { ChatSyncEngine, SYNC_COALESCE_MS, SYNC_LIMIT, type SyncDeps } from "@/lib/chat/cache/sync";
import { LATEST, type ChatListDto, type ChatRowDto, type ConversationHeaderDto, type MessageDto, type MessagesData, type MessagesPageDto, type SpaceTopicsDto, type SyncAnswer } from "@/lib/chat/cache/types";

const at = (n: number) => `2026-11-16T10:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`;
const msg = (id: string, n: number, over: Partial<MessageDto> = {}): MessageDto => ({
  id,
  kind: "TEXT",
  body: `نص ${id}`,
  deleted: false,
  edited: false,
  pinned: false,
  mine: false,
  authorId: "u2",
  authorName: "سلمى",
  createdAt: at(n),
  clientId: null,
  mentions: [],
  attachments: [],
  reactions: [],
  ...over,
});
const page = (messages: MessageDto[], over: Partial<MessagesPageDto> = {}): MessagesPageDto => ({ messages, hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [], ...over });
const data = (...pages: MessagesPageDto[]): MessagesData => ({ pages, pageParams: pages.map(() => LATEST) });
const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({
  id,
  kind: "TOPIC",
  title: `موضوع ${id}`,
  emoji: null,
  space: { id: "s1", name: "مبيعات" },
  lastMessage: null,
  unread: 0,
  mentionsUnread: 0,
  muted: false,
  pinnedByMe: false,
  archivedByMe: false,
  markedUnread: false,
  restricted: false,
  ...over,
});
const last = (id: string, n: number, over: Partial<NonNullable<ChatRowDto["lastMessage"]>> = {}) => ({ id, authorName: "سلمى", preview: `نص ${id}`, kind: "TEXT" as const, at: at(n), mine: false, ...over });
const sync = (over: Partial<SyncAnswer> = {}): SyncAnswer => ({ cursor: "100", messages: [], reads: [], delivered: [], rows: [], removed: [], ...over });

function world() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const list: ChatListDto = {
    scope: "all",
    spaceId: null,
    canOversee: false,
    rows: [
      row("s1", { kind: "SPACE", title: "مبيعات", unread: 1, topicChips: [{ id: "t1", title: "عام", emoji: null, unread: 1 }], lastMessage: last("m2", 20) }),
      row("d1", { kind: "DM", title: "سلمى", space: { id: "s1", name: "مبيعات" }, lastMessage: last("x2", 15, { mine: true, status: "sent" }) }),
    ],
  };
  qc.setQueryData(chatKeys.list(), list);
  const forum: SpaceTopicsDto = { space: { id: "s1", name: "مبيعات", emoji: null, canModerate: false, canCreateTopic: false }, rows: [row("t1", { unread: 1, lastMessage: last("m2", 20) })] };
  qc.setQueryData(chatKeys.space("s1"), forum);
  qc.setQueryData(chatKeys.messages("t1"), data(page([msg("m1", 10), msg("m2", 20)])));
  qc.setQueryData(chatKeys.messages("d1"), data(page([msg("x1", 10, { mine: true, authorId: "me", status: "sent" }), msg("x2", 15, { mine: true, authorId: "me", status: "sent" })])));
  qc.setQueryData(chatKeys.header("t1"), { id: "t1", kind: "TOPIC", title: "موضوع t1", emoji: null, closed: false, restricted: false, topicType: "DISCUSSION", pinnedMessages: [{ id: "m1", authorName: "سلمى", preview: "نص m1" }] } as unknown as ConversationHeaderDto);
  return qc;
}
const texts = (qc: QueryClient, id: string) => (qc.getQueryData<MessagesData>(chatKeys.messages(id))?.pages.flatMap((p) => p.messages) ?? []).map((m) => m.id);
const rowOf = (qc: QueryClient, id: string) => qc.getQueryData<ChatListDto>(chatKeys.list())!.rows.find((r) => r.id === id)!;

describe("applySync: where each message goes", () => {
  it("an edit or a reaction of a message the cache holds replaces it in place, in ITS conversation only", () => {
    const qc = world();
    applySync(qc, sync({ messages: [msg("m1", 10, { body: "معدّل", edited: true })] }));
    const m1 = qc.getQueryData<MessagesData>(chatKeys.messages("t1"))!.pages[0]!.messages[0]!;
    expect(m1).toMatchObject({ body: "معدّل", edited: true });
    expect(texts(qc, "t1")).toEqual(["m1", "m2"]);
    expect(texts(qc, "d1")).toEqual(["x1", "x2"]); // the other conversation is untouched
  });

  it("a deletion becomes a tombstone: no text anywhere in the cache", () => {
    const qc = world();
    applySync(qc, sync({ messages: [msg("m2", 20, { deleted: true, body: null })] }));
    expect(qc.getQueryData<MessagesData>(chatKeys.messages("t1"))!.pages[0]!.messages[1]).toMatchObject({ id: "m2", deleted: true, body: null });
    expect(JSON.stringify(qc.getQueryData(chatKeys.messages("t1")))).not.toContain("نص m2");
  });

  it("a deletion from the feed also clears the quotes of it, the pinned bar and the row's last line — not only the message", () => {
    const qc = world();
    qc.setQueryData(chatKeys.messages("t1"), data(page([msg("m1", 10), msg("m2", 20, { replyTo: { id: "m1", preview: "نص m1", authorName: "سلمى" } })])));
    applySync(qc, sync({ messages: [msg("m1", 10, { deleted: true, body: null })] }));
    const [m1, m2] = qc.getQueryData<MessagesData>(chatKeys.messages("t1"))!.pages[0]!.messages;
    expect(m1).toMatchObject({ deleted: true, body: null });
    expect(m2!.replyTo).toMatchObject({ preview: null, deleted: true });
    expect(qc.getQueryData<ConversationHeaderDto>(chatKeys.header("t1"))!.pinnedMessages).toEqual([]);
    applySync(qc, sync({ messages: [msg("m2", 20, { deleted: true, body: null })] }));
    expect(qc.getQueryData<SpaceTopicsDto>(chatKeys.space("s1"))!.rows[0]!.lastMessage!.preview).toBeNull();
    expect(JSON.stringify([qc.getQueryData(chatKeys.messages("t1")), qc.getQueryData(chatKeys.header("t1"))])).not.toContain("نص m1");
  });

  it("a deleted message that sits outside every cached window is still scrubbed from the quotes and the pinned bar that name it", () => {
    const qc = world();
    // an old message, pinned and quoted, that is not among the loaded messages
    qc.setQueryData(chatKeys.header("t1"), { id: "t1", kind: "TOPIC", title: "x", emoji: null, closed: false, restricted: false, pinnedMessages: [{ id: "old1", authorName: "سلمى", preview: "نص قديم سري" }] } as unknown as ConversationHeaderDto);
    qc.setQueryData(chatKeys.messages("t1"), data(page([msg("m1", 10), msg("m2", 20, { replyTo: { id: "old1", preview: "نص قديم سري", authorName: "سلمى" } })])));
    applySync(qc, sync({ messages: [msg("old1", 1, { deleted: true, body: null })] }));
    expect(qc.getQueryData<ConversationHeaderDto>(chatKeys.header("t1"))!.pinnedMessages).toEqual([]);
    expect(qc.getQueryData<MessagesData>(chatKeys.messages("t1"))!.pages[0]!.messages[1]!.replyTo).toMatchObject({ preview: null, deleted: true });
    expect(JSON.stringify([qc.getQueryData(chatKeys.messages("t1")), qc.getQueryData(chatKeys.header("t1"))])).not.toContain("نص قديم سري");
  });

  it("ONE new message is placed through the row that names it as its newest, and the server's row replaces the derived numbers", () => {
    const qc = world();
    const incoming = msg("m3", 30);
    applySync(qc, sync({ messages: [incoming], rows: [row("t1", { unread: 2, lastMessage: last("m3", 30) }), row("s1", { kind: "SPACE", unread: 2, lastMessage: last("m3", 30) })] }));
    expect(texts(qc, "t1")).toEqual(["m1", "m2", "m3"]);
    expect(rowOf(qc, "s1").unread).toBe(2);
    expect(qc.getQueryData<SpaceTopicsDto>(chatKeys.space("s1"))!.rows[0]).toMatchObject({ id: "t1", unread: 2 });
  });

  it("two new messages of one conversation: it is NOT guessed (a hole would be worse), the conversation goes to catch-up", () => {
    const qc = world();
    const out = applySync(qc, sync({ messages: [msg("m3", 30), msg("m4", 40)], rows: [row("t1", { lastMessage: last("m4", 40) })] }));
    expect(texts(qc, "t1")).toEqual(["m1", "m2"]);
    expect(out.catchUp).toEqual(["t1"]);
  });

  it("one new message in each of two conversations is placed in both (no catch-up needed)", () => {
    const qc = world();
    const out = applySync(qc, sync({ messages: [msg("m3", 30), msg("x3", 31)], rows: [row("t1", { lastMessage: last("m3", 30) }), row("d1", { kind: "DM", space: null, lastMessage: last("x3", 31) })] }));
    expect(out.catchUp).toEqual([]);
    expect(texts(qc, "t1")).toContain("m3");
    expect(texts(qc, "d1")).toContain("x3");
  });

  it("the day the server names the conversation of each message, the message goes straight there (and a message is never put in another conversation)", () => {
    const qc = world();
    applySync(qc, sync({ messages: [{ ...msg("n1", 30), conversationId: "t1" }, { ...msg("n2", 31), conversationId: "d1" }] }));
    expect(texts(qc, "t1")).toEqual(["m1", "m2", "n1"]);
    expect(texts(qc, "d1")).toEqual(["x1", "x2", "n2"]);
  });

  it("a message of a conversation whose windows the cache does not hold is dropped (it is fetched when that conversation is opened)", () => {
    const qc = world();
    applySync(qc, sync({ messages: [msg("z1", 30)], rows: [row("zzz", { lastMessage: last("z1", 30) })] }));
    expect(qc.getQueryData(chatKeys.messages("zzz"))).toBeUndefined();
  });

  it("a window opened around an old message does not grow at the wrong end", () => {
    const qc = world();
    qc.setQueryData(chatKeys.messages("t1"), data(page([msg("m1", 10), msg("m2", 20)], { hasNewer: true })));
    applySync(qc, sync({ messages: [msg("m3", 30)], rows: [row("t1", { lastMessage: last("m3", 30) })] }));
    expect(texts(qc, "t1")).toEqual(["m1", "m2"]);
  });

  it("a conversation removed in the same answer gets nothing back from the rows or the messages", () => {
    const qc = world();
    applySync(qc, sync({ removed: ["t1"], messages: [msg("m1", 10, { body: "بعد" })], rows: [row("t1", { lastMessage: last("m9", 50) })] }));
    expect(qc.getQueryData(chatKeys.messages("t1"))).toBeUndefined();
    expect(qc.getQueryData<SpaceTopicsDto>(chatKeys.space("s1"))!.rows).toEqual([]);
  });
});

describe("removeConversation drops it from every key", () => {
  it("the list's chips, the forum view, the header and the messages", () => {
    const qc = world();
    removeConversation(qc, "t1");
    expect(rowOf(qc, "s1").topicChips).toEqual([]);
    expect(qc.getQueryData<SpaceTopicsDto>(chatKeys.space("s1"))!.rows).toEqual([]);
    expect(qc.getQueryData(chatKeys.header("t1"))).toBeUndefined();
    expect(qc.getQueryData(chatKeys.messages("t1"))).toBeUndefined();
    removeConversation(qc, "d1");
    expect(qc.getQueryData<ChatListDto>(chatKeys.list())!.rows.map((r) => r.id)).toEqual(["s1"]);
  });
});

describe("the other writers", () => {
  it("appendMessage: joins the window, moves the row, adds one unread (not for my own message); the space's row follows", () => {
    const qc = world();
    appendMessage(qc, "t1", msg("m3", 30));
    expect(texts(qc, "t1")).toEqual(["m1", "m2", "m3"]);
    expect(qc.getQueryData<SpaceTopicsDto>(chatKeys.space("s1"))!.rows[0]).toMatchObject({ unread: 2, lastMessage: { id: "m3" } });
    expect(rowOf(qc, "s1")).toMatchObject({ unread: 2, lastMessage: { id: "m3" }, topicChips: [{ id: "t1", unread: 2 }] });
    appendMessage(qc, "t1", msg("m4", 31, { mine: true, authorId: "me" }));
    expect(rowOf(qc, "s1").unread).toBe(2);
    // the same message twice is one message
    appendMessage(qc, "t1", msg("m4", 31, { mine: true, authorId: "me" }));
    expect(texts(qc, "t1")).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("replaceMessage: the server's message takes the place of my pending one (by clientId) and the row's line follows", () => {
    const qc = world();
    appendMessage(qc, "d1", msg("pending:c9", 16, { mine: true, authorId: "me", clientId: "c9", status: "sent", body: "جاري الإرسال" }));
    expect(rowOf(qc, "d1").lastMessage!.id).toBe("pending:c9");
    replaceMessage(qc, "d1", msg("srv9", 16, { mine: true, authorId: "me", clientId: "c9", status: "sent", body: "جاري الإرسال" }), { id: "pending:c9" });
    expect(texts(qc, "d1")).toEqual(["x1", "x2", "srv9"]);
    expect(rowOf(qc, "d1").lastMessage!.id).toBe("srv9");
  });

  it("tombstone: the place stays, the text goes, the pinned bar and the row's line follow", () => {
    const qc = world();
    tombstone(qc, null, "m2"); // the conversation is found from the message
    tombstone(qc, "t1", "m1");
    expect(qc.getQueryData<MessagesData>(chatKeys.messages("t1"))!.pages[0]!.messages.map((m) => [m.deleted, m.body])).toEqual([[true, null], [true, null]]);
    expect(qc.getQueryData<ConversationHeaderDto>(chatKeys.header("t1"))!.pinnedMessages).toEqual([]);
    expect(qc.getQueryData<SpaceTopicsDto>(chatKeys.space("s1"))!.rows[0]!.lastMessage!.preview).toBeNull();
  });

  it("tombstone also scrubs the line of the SPACE row that names the message, even when the topic's own row is not cached", () => {
    const qc = world();
    qc.removeQueries({ queryKey: chatKeys.space("s1") }); // the forum view was never opened: only the list's forum row knows the line
    tombstone(qc, "t1", "m2");
    expect(rowOf(qc, "s1").lastMessage).toMatchObject({ id: "m2", preview: null });
  });

  it("upsertRows: a renamed topic makes its header stale", () => {
    const qc = world();
    upsertRows(qc, [row("t1", { title: "اسم جديد", unread: 0 })]);
    expect(qc.getQueryState(chatKeys.header("t1"))!.isInvalidated).toBe(true);
    const qc2 = world();
    upsertRows(qc2, [row("t1", { unread: 5 })]); // only a number moved: the header is fine
    expect(qc2.getQueryState(chatKeys.header("t1"))!.isInvalidated).toBe(false);
  });

  it("markConversationRead empties the row and the topic's share of the forum row", () => {
    const qc = world();
    markConversationRead(qc, "t1");
    expect(qc.getQueryData<SpaceTopicsDto>(chatKeys.space("s1"))!.rows[0]!.unread).toBe(0);
    expect(rowOf(qc, "s1")).toMatchObject({ unread: 0, topicChips: [{ id: "t1", unread: 0 }] });
  });

  it("applyReads: the peer's read mark moves the ticks and my last line; MY mark on another device empties the row", () => {
    const qc = world();
    applyReads(qc, { reads: [{ conversationId: "d1", userId: "peer", lastReadAt: at(40) }], delivered: [] });
    expect(qc.getQueryData<MessagesData>(chatKeys.messages("d1"))!.pages[0]!.messages.map((m) => m.status)).toEqual(["read", "read"]);
    expect(rowOf(qc, "d1").lastMessage!.status).toBe("read");
    // mine
    applyReads(qc, { reads: [{ conversationId: "t1", userId: "me", lastReadAt: at(25) }], delivered: [] }, { meId: "me" });
    expect(qc.getQueryData<SpaceTopicsDto>(chatKeys.space("s1"))!.rows[0]!.unread).toBe(0);
    // a read mark that does not reach the last message leaves the row alone
    const qc2 = world();
    applyReads(qc2, { reads: [{ conversationId: "t1", userId: "me", lastReadAt: at(5) }], delivered: [] }, { meId: "me" });
    expect(qc2.getQueryData<SpaceTopicsDto>(chatKeys.space("s1"))!.rows[0]!.unread).toBe(1);
  });

  it("applyCatchUp: the messages after the newest known join in order, once each", () => {
    const qc = world();
    applyCatchUp(qc, "t1", page([msg("m3", 30), msg("m4", 40), msg("m2", 20)]));
    expect(texts(qc, "t1")).toEqual(["m1", "m2", "m3", "m4"]);
  });
});

describe("a patch never makes data look fresher than it is", () => {
  it("a change keeps the time the data was fetched; a change that changes nothing writes nothing", () => {
    const qc = new QueryClient();
    seedFromDevice(qc, { list: { scope: "all", spaceId: null, canOversee: false, rows: [row("d1", { kind: "DM", space: null })] }, conversations: [{ id: "d1", header: null, messages: [msg("a", 1)], hasOlder: false, readers: [] }] });
    expect(qc.getQueryState(chatKeys.list())!.dataUpdatedAt).toBe(0);
    applySync(qc, sync({ messages: [msg("a", 1, { body: "جديد" })], rows: [row("d1", { kind: "DM", space: null, unread: 3 })] }));
    expect(qc.getQueryState(chatKeys.list())!.dataUpdatedAt).toBe(0); // still «from the device»: the server has not confirmed it
    expect(qc.getQueryState(chatKeys.messages("d1"))!.dataUpdatedAt).toBe(0);
    const before = qc.getQueryState(chatKeys.list())!;
    applySync(qc, sync({ rows: [] }));
    expect(qc.getQueryState(chatKeys.list())).toBe(before);
  });
});

describe("a reset marks everything stale", () => {
  it("every list, header and window is invalidated, and a window with older pages is cut back to its newest page", () => {
    const qc = world();
    qc.setQueryData(chatKeys.messages("t1"), data(page([msg("a", 1)], { hasOlder: false }), page([msg("m1", 10), msg("m2", 20)])));
    applySync(qc, sync({ reset: true, cursor: "7" }));
    for (const key of [chatKeys.list(), chatKeys.space("s1"), chatKeys.header("t1"), chatKeys.messages("t1"), chatKeys.messages("d1")]) {
      expect(qc.getQueryState(key)!.isInvalidated, JSON.stringify(key)).toBe(true);
    }
    const cut = qc.getQueryData<MessagesData>(chatKeys.messages("t1"))!;
    expect(cut.pages).toHaveLength(1);
    expect(cut.pageParams).toEqual([LATEST]);
    resetChatCache(qc);
  });
});

// ───────────────────────────────────────── the engine ─────────────────────────────────────────

function engineWorld(answers: Array<SyncAnswer | Error | ((url: string) => SyncAnswer | Error)>, opts: { online?: boolean } = {}) {
  const qc = world();
  const urls: string[] = [];
  const queue = [...answers];
  let inFlight = 0;
  let maxInFlight = 0;
  const deps: SyncDeps = {
    fetchJson: async <T,>(url: string): Promise<T> => {
      urls.push(url);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
      const next = queue.shift();
      const out = typeof next === "function" ? next(url) : next;
      if (!out) throw new Error("no answer prepared for " + url);
      if (out instanceof Error) throw out;
      return out as T;
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    isOnline: () => opts.online ?? true,
  };
  const engine = new ChatSyncEngine(qc, deps);
  return { qc, engine, urls, maxInFlight: () => maxInFlight, left: () => queue.length };
}

describe("scheduleSync: the engine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("frames of one burst are ONE question, asked 120 ms after the first", async () => {
    const w = engineWorld([sync({ cursor: "10" }), sync({ cursor: "12" })]);
    w.engine.adoptCursor("10");
    for (let i = 0; i < 6; i++) {
      w.engine.schedule();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(w.urls).toEqual([]); // 60 ms in: nothing asked yet
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS);
    expect(w.urls).toEqual(["/api/chat/sync?after=10"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.urls).toHaveLength(1);
    expect(w.engine.cursor).toBe("10");
  });

  it("never two questions at once; a frame that arrives meanwhile makes it ask once more with the NEW cursor", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = engineWorld([() => sync({ cursor: "11" }), sync({ cursor: "12" })]);
    // hold the first answer
    const original = w.engine["deps"].fetchJson;
    let first = true;
    w.engine["deps"].fetchJson = async <T,>(url: string): Promise<T> => {
      if (first) {
        first = false;
        await gate;
      }
      return original<T>(url);
    };
    w.engine.adoptCursor("10");
    w.engine.schedule();
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS);
    w.engine.schedule();
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS); // the second burst fires while the first answer is still out
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(w.urls).toEqual(["/api/chat/sync?after=10", "/api/chat/sync?after=11"]);
    expect(w.maxInFlight()).toBe(1);
    expect(w.engine.cursor).toBe("12");
  });

  it("chains at once while the answer says `more`, and while it is as full as the limit", async () => {
    const full = sync({ cursor: "12", messages: Array.from({ length: SYNC_LIMIT }, (_, i) => msg(`f${i}`, 1)) });
    const w = engineWorld([sync({ cursor: "11", more: true }), full, sync({ cursor: "13" })]);
    w.engine.adoptCursor("10");
    await w.engine.now();
    expect(w.urls).toEqual(["/api/chat/sync?after=10", "/api/chat/sync?after=11", "/api/chat/sync?after=12"]);
    expect(w.engine.cursor).toBe("13");
    expect(w.left()).toBe(0);
  });

  it("a cold start asks without `after` and only learns where «now» is; the next question continues from it", async () => {
    const w = engineWorld([sync({ cursor: "500" }), sync({ cursor: "501", messages: [msg("m1", 10, { body: "عدّل" })] })]);
    await w.engine.ensureCursor();
    expect(w.urls).toEqual(["/api/chat/sync"]);
    expect(w.engine.cursor).toBe("500");
    w.engine.schedule();
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(w.urls[1]).toBe("/api/chat/sync?after=500");
    expect(texts(w.qc, "t1")).toEqual(["m1", "m2"]);
  });

  it("the cursor never goes back, except in a reset (whose cursor is where «now» is)", async () => {
    const w = engineWorld([sync({ cursor: "20" }), sync({ cursor: "15" }), sync({ cursor: "5", reset: true })]);
    w.engine.adoptCursor("10");
    await w.engine.now();
    expect(w.engine.cursor).toBe("20");
    await w.engine.now();
    expect(w.engine.cursor).toBe("20");
    await w.engine.now();
    expect(w.engine.cursor).toBe("5");
  });

  it("a reset answer reloads (marks stale) and the engine goes on from its cursor", async () => {
    const w = engineWorld([sync({ cursor: "40", reset: true }), sync({ cursor: "41" })]);
    w.engine.adoptCursor("1");
    await w.engine.now();
    expect(w.qc.getQueryState(chatKeys.list())!.isInvalidated).toBe(true);
    w.engine.schedule();
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    expect(w.urls[1]).toBe("/api/chat/sync?after=40");
  });

  it("a failed question is asked again after a pause; «no» (401, 403, 404) and being offline are not retried", async () => {
    const w = engineWorld([new ApiError("x", 500), sync({ cursor: "11" })]);
    w.engine.adoptCursor("10");
    await w.engine.now();
    expect(w.urls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.urls).toHaveLength(2);
    expect(w.engine.cursor).toBe("11");

    const no = engineWorld([new ApiError("auth.required", 401)]);
    no.engine.adoptCursor("10");
    await no.engine.now();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(no.urls).toHaveLength(1);

    const off = engineWorld([new TypeError("network")], { online: false });
    off.engine.adoptCursor("10");
    await off.engine.now();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(off.urls).toHaveLength(1);
  });

  it("a conversation that may lack messages is caught up with `after=<newest I know>`, in order, until it is complete", async () => {
    const w = engineWorld([
      sync({ cursor: "11", messages: [msg("m3", 30), msg("m4", 40)], rows: [row("t1", { lastMessage: last("m4", 40) })] }),
      (url) => {
        expect(url).toBe("/api/chat/conversations/t1/messages?limit=50&after=m2");
        return page([msg("m3", 30), msg("m4", 40)], { hasNewer: true }) as unknown as SyncAnswer;
      },
      (url) => {
        expect(url).toBe("/api/chat/conversations/t1/messages?limit=50&after=m4");
        return page([msg("m5", 50)]) as unknown as SyncAnswer;
      },
    ]);
    w.engine.adoptCursor("10");
    await w.engine.now();
    expect(texts(w.qc, "t1")).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("a rewind that happens while an answer is in the air is not undone when that answer lands", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = engineWorld([sync({ cursor: "13" }), sync({ cursor: "14" })]);
    const original = w.engine["deps"].fetchJson;
    let first = true;
    w.engine["deps"].fetchJson = async <T,>(url: string): Promise<T> => {
      if (first) {
        first = false;
        await gate;
      }
      return original<T>(url);
    };
    w.engine.adoptCursor("12");
    const running = w.engine.now();
    await vi.advanceTimersByTimeAsync(5);
    // a fetch that started at cursor 10 lands now: the engine goes back to 10 while its question after 12 is still out
    w.engine.rewindTo("10");
    release();
    await running;
    await vi.advanceTimersByTimeAsync(SYNC_COALESCE_MS + 10);
    // the answer (13) did not move it forward again: the next question starts from 10
    expect(w.urls).toEqual(["/api/chat/sync?after=12", "/api/chat/sync?after=10"]);
  });

  it("a conversation being caught up is «busy» until its messages are in (nothing is written to the device meanwhile)", async () => {
    let release!: (v: SyncAnswer) => void;
    const gate = new Promise<SyncAnswer>((r) => (release = r));
    const w = engineWorld([sync({ cursor: "11", messages: [msg("m3", 30), msg("m4", 40)], rows: [row("t1", { lastMessage: last("m4", 40) })] }), () => gate as never]);
    const original = w.engine["deps"].fetchJson;
    w.engine["deps"].fetchJson = async <T,>(url: string): Promise<T> => (url.includes("/messages") ? ((await gate) as unknown as T) : original<T>(url));
    w.engine.adoptCursor("10");
    expect(w.engine.busy).toBe(false);
    const running = w.engine.now();
    await vi.advanceTimersByTimeAsync(5);
    expect(w.engine.busy).toBe(true);
    release(page([msg("m3", 30), msg("m4", 40)]) as unknown as SyncAnswer);
    await running;
    expect(w.engine.busy).toBe(false);
    expect(texts(w.qc, "t1")).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("stop() ends every question and forgets the cursor", async () => {
    const w = engineWorld([sync({ cursor: "11" })]);
    w.engine.adoptCursor("10");
    w.engine.schedule();
    w.engine.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.urls).toEqual([]);
    expect(w.engine.cursor).toBeNull();
    w.engine.schedule();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.urls).toEqual([]);
  });
});
