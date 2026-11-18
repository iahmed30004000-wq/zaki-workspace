/**
 * C1.8 — the optimistic bubble in the chat cache (`src/lib/chat/cache/pending.ts`).
 *
 * The composer writes a pending copy of my message into the newest window the moment I press send; the server's answer (or the sync) replaces it IN PLACE,
 * found by its `clientId` — never a duplicate, whichever of the two arrives first; a failure marks it (red «!») and the outbox keeps the retry.
 */
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { applySync, chatKeys, LATEST, type ChatListDto, type ChatRowDto, type MessageDto, type MessagesData } from "../src/lib/chat/cache";
import {
  appendPending,
  buildPendingMessage,
  dropStalePending,
  failPending,
  isPendingMessage,
  newestConfirmedId,
  outboxItemOfPending,
  pendingIdOf,
  removePending,
  replacePending,
  resetPendingForTests,
  resumePending,
  syncPendingWithOutbox,
} from "../src/lib/chat/cache/pending";
import type { OutboxItem } from "../src/lib/chat/outbox/queue";

const ME = { id: "me", name: "أنا", avatar: null };
const CONV = "c1";

function msg(id: string, at: string, over: Partial<MessageDto> = {}): MessageDto {
  return { id, kind: "TEXT", body: `نص ${id}`, deleted: false, edited: false, pinned: false, mine: false, authorId: "other", authorName: "سارة", createdAt: at, clientId: null, mentions: [], attachments: [], reactions: [], ...over };
}
const mine = (id: string, at: string, clientId: string, over: Partial<MessageDto> = {}) => msg(id, at, { mine: true, authorId: ME.id, authorName: ME.name, clientId, ...over });

function row(over: Partial<ChatRowDto> = {}): ChatRowDto {
  return { id: CONV, kind: "DM", title: "سارة", emoji: null, lastMessage: null, unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false, ...over } as ChatRowDto;
}

function seed(messages: MessageDto[], opts: { hasNewer?: boolean; withList?: boolean } = {}): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData<MessagesData>(chatKeys.messages(CONV), { pages: [{ messages, hasOlder: false, hasNewer: opts.hasNewer ?? false, firstUnreadId: null, readers: [] }], pageParams: [LATEST] });
  if (opts.withList !== false) {
    const last = messages[messages.length - 1];
    qc.setQueryData<ChatListDto>(chatKeys.list(), {
      scope: "all",
      spaceId: null,
      canOversee: false,
      rows: [row(last ? { lastMessage: { id: last.id, authorName: last.authorName, preview: last.body, kind: last.kind, at: last.createdAt, mine: last.mine } } : {})],
    } as unknown as ChatListDto);
  }
  return qc;
}
const windowOf = (qc: QueryClient): MessageDto[] => qc.getQueryData<MessagesData>(chatKeys.messages(CONV))!.pages.flatMap((p) => p.messages);
const input = (clientId: string, body = "مرحبا") => ({ clientId, body, author: ME });

beforeEach(() => resetPendingForTests());

describe("C1.8: the pending message", () => {
  it("is mine, a plain text, marked pending, with the id the server can never issue", () => {
    const m = buildPendingMessage({ ...input("k1"), mentions: ["u2"], now: new Date("2026-03-01T10:00:00.000Z") });
    expect(m).toMatchObject({ id: pendingIdOf("k1"), kind: "TEXT", body: "مرحبا", mine: true, authorId: "me", clientId: "k1", mentions: ["u2"], deleted: false, pending: { state: "sending" } });
    expect(isPendingMessage(m)).toBe(true);
    expect(m.createdAt).toBe("2026-03-01T10:00:00.000Z");
    // nothing a pending copy could leak: no price, no card, no files, no reactions, no ticks before the server has it
    expect(m.attachments).toEqual([]);
    expect(m.reactions).toEqual([]);
    expect(m.status).toBeUndefined();
    expect(m.card).toBeUndefined();
    expect(isPendingMessage(msg("real-1", "2026-03-01T10:00:00.000Z"))).toBe(false);
  });
});

describe("C1.8: appendPending", () => {
  it("puts the bubble at the end of the newest window at once", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    expect(appendPending(qc, CONV, input("k1"))).toBe(true);
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", pendingIdOf("k1")]);
  });

  it("is idempotent: pressing send twice for one clientId shows one bubble", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    expect(appendPending(qc, CONV, input("k1"))).toBe(true);
    expect(windowOf(qc).filter(isPendingMessage)).toHaveLength(1);
  });

  it("does nothing (and says so) when the cache has no window of this conversation: the caller then sends the old way", () => {
    const qc = new QueryClient();
    expect(appendPending(qc, CONV, input("k1"))).toBe(false);
    expect(qc.getQueryData(chatKeys.messages(CONV))).toBeUndefined();
  });

  it("does nothing when the newest window is not the end of the conversation (a window opened around an old message)", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")], { hasNewer: true });
    expect(appendPending(qc, CONV, input("k1"))).toBe(false);
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1"]);
  });

  it("always sorts last, even when this device's clock is behind the server's", () => {
    const qc = seed([msg("m1", "2099-01-01T00:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    const [first, second] = windowOf(qc);
    expect(first!.id).toBe("m1");
    expect(second!.id).toBe(pendingIdOf("k1"));
    expect(Date.parse(second!.createdAt)).toBeGreaterThan(Date.parse(first!.createdAt));
  });

  it("does not touch the list's row: the row says what the SERVER knows", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    const before = qc.getQueryData<ChatListDto>(chatKeys.list());
    appendPending(qc, CONV, input("k1"));
    expect(qc.getQueryData<ChatListDto>(chatKeys.list())).toBe(before);
  });
});

describe("C1.8: replacePending — the server's answer takes the bubble's place, in place", () => {
  it("replaces by clientId, at the same index, and the list's row follows", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    const answer = mine("srv-1", "2026-03-01T10:00:05.000Z", "k1", { status: "sent" });
    replacePending(qc, CONV, answer);
    const w = windowOf(qc);
    expect(w.map((m) => m.id)).toEqual(["m1", "srv-1"]);
    expect(w[1]).toEqual(answer);
    expect(w.some(isPendingMessage)).toBe(false);
    const r = qc.getQueryData<ChatListDto>(chatKeys.list())!.rows[0]!;
    expect(r.lastMessage?.id).toBe("srv-1");
    expect(r.unread).toBe(0); // my own message never makes a number
  });

  it("when the SYNC brought the real message first, the answer after it finds it by id: still one copy", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    const answer = mine("srv-1", "2026-03-01T10:00:05.000Z", "k1");
    // the sync answer: the new message is placed through the row that names it as its newest message, and found by its clientId
    applySync(qc, { cursor: "5", messages: [answer], reads: [], delivered: [], rows: [row({ lastMessage: { id: "srv-1", authorName: ME.name, preview: answer.body, kind: "TEXT", at: answer.createdAt, mine: true } })], removed: [] });
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", "srv-1"]);
    replacePending(qc, CONV, answer);
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", "srv-1"]);
  });

  it("when the answer comes first and the sync after it, still one copy", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    const answer = mine("srv-1", "2026-03-01T10:00:05.000Z", "k1");
    replacePending(qc, CONV, answer);
    applySync(qc, { cursor: "5", messages: [answer], reads: [], delivered: [], rows: [], removed: [] });
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", "srv-1"]);
  });

  it("two messages in flight are each replaced by their own clientId, whatever order the answers come in", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1", "الأولى"));
    appendPending(qc, CONV, input("k2", "الثانية"));
    replacePending(qc, CONV, mine("srv-2", "2026-03-01T10:00:06.000Z", "k2", { body: "الثانية" }));
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", pendingIdOf("k1"), "srv-2"]);
    replacePending(qc, CONV, mine("srv-1", "2026-03-01T10:00:05.000Z", "k1", { body: "الأولى" }));
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", "srv-1", "srv-2"]);
  });

  it("a clientId is the SENDER's: somebody else's message that happens to carry it replaces nothing", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    replacePending(qc, CONV, msg("theirs", "2026-03-01T10:00:05.000Z", { clientId: "k1", mine: false }));
    expect(windowOf(qc).some((m) => m.id === pendingIdOf("k1"))).toBe(true);
  });

  it("an answer that lands AFTER a newer message of somebody else never takes the row's line backwards", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    // while mine is in flight somebody else's newer message arrived and the row says so
    qc.setQueryData<ChatListDto>(chatKeys.list(), {
      scope: "all",
      spaceId: null,
      canOversee: false,
      rows: [row({ lastMessage: { id: "m9", authorName: "سارة", preview: "أحدث", kind: "TEXT", at: "2026-03-01T10:01:00.000Z", mine: false } })],
    } as unknown as ChatListDto);
    replacePending(qc, CONV, mine("srv-1", "2026-03-01T10:00:05.000Z", "k1"));
    expect(qc.getQueryData<ChatListDto>(chatKeys.list())!.rows[0]!.lastMessage?.id).toBe("m9");
  });

  it("with no pending copy (a refetch dropped it) the answer is simply added once", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    const answer = mine("srv-1", "2026-03-01T10:00:05.000Z", "k1");
    replacePending(qc, CONV, answer);
    replacePending(qc, CONV, answer);
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", "srv-1"]);
  });
});

describe("C1.8: failures", () => {
  it("failPending marks the bubble failed with its reason, in place; resumePending puts the clock back", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    expect(failPending(qc, CONV, "k1", "outbox.reason.forbidden")).toBe(true);
    expect(windowOf(qc)[1]).toMatchObject({ id: pendingIdOf("k1"), pending: { state: "failed", reason: "outbox.reason.forbidden" } });
    expect(resumePending(qc, CONV, "k1")).toBe(true);
    expect(windowOf(qc)[1]!.pending).toEqual({ state: "sending" });
  });

  it("failing or resuming a bubble that is not there changes nothing", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    expect(failPending(qc, CONV, "nope")).toBe(false);
    expect(resumePending(qc, CONV, "nope")).toBe(false);
    expect(removePending(qc, CONV, "nope")).toBe(false);
  });

  it("removePending takes the bubble out and nothing else (the person deleted it)", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    expect(removePending(qc, CONV, "k1")).toBe(true);
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1"]);
  });

  it("syncPendingWithOutbox: a refused outbox item turns its bubble red, a retried one gets its clock back", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("k1"));
    const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({ clientId: "k1", conversationId: CONV, body: "مرحبا", mentions: [], createdAt: 1, attempts: 1, ...over });
    syncPendingWithOutbox(qc, CONV, [item({ failed: { status: 403, key: "outbox.reason.forbidden" } })]);
    expect(windowOf(qc)[1]!.pending).toEqual({ state: "failed", reason: "outbox.reason.forbidden" });
    syncPendingWithOutbox(qc, CONV, [item()]);
    expect(windowOf(qc)[1]!.pending).toEqual({ state: "sending" });
    // an item that is merely waiting for the network leaves the bubble as it is (still sending)
    syncPendingWithOutbox(qc, CONV, [item({ attempts: 3 })]);
    expect(windowOf(qc)[1]!.pending).toEqual({ state: "sending" });
  });
});

describe("C1.8: a bubble the device copy brought back is a ghost", () => {
  it("dropStalePending removes pending bubbles this page never sent (and keeps the ones the outbox holds)", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    // two pending copies as they would come back from the device after a reload
    qc.setQueryData<MessagesData>(chatKeys.messages(CONV), {
      pages: [{ messages: [msg("m1", "2026-03-01T10:00:00.000Z"), buildPendingMessage({ ...input("ghost") }), buildPendingMessage({ ...input("held") })], hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [] }],
      pageParams: [LATEST],
    });
    expect(dropStalePending(qc, CONV, ["held"])).toBe(1);
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", pendingIdOf("held")]);
  });

  it("a bubble this page sent is never swept", () => {
    const qc = seed([msg("m1", "2026-03-01T10:00:00.000Z")]);
    appendPending(qc, CONV, input("live"));
    expect(dropStalePending(qc, CONV, [])).toBe(0);
    expect(windowOf(qc).map((m) => m.id)).toEqual(["m1", pendingIdOf("live")]);
  });
});

describe("C1.8: what the screens need around a pending message", () => {
  it("newestConfirmedId never returns a pending id (a read mark or `after=` anchored on one would be a 404)", () => {
    const m1 = msg("m1", "2026-03-01T10:00:00.000Z");
    const p = buildPendingMessage({ ...input("k1") });
    expect(newestConfirmedId([m1, p])).toBe("m1");
    expect(newestConfirmedId([p])).toBeNull();
    expect(newestConfirmedId([])).toBeNull();
  });

  it("outboxItemOfPending lets the existing PendingBubble draw it: words, time, retry and the reason", () => {
    const p = { ...buildPendingMessage({ ...input("k1", "نص طويل"), replyTo: { id: "m0", preview: "الأصل", authorName: "سارة" }, now: new Date("2026-03-01T10:00:00.000Z") }), pending: { state: "failed" as const, reason: "outbox.reason.invalid" } };
    expect(outboxItemOfPending(CONV, p)).toEqual({
      clientId: "k1",
      conversationId: CONV,
      body: "نص طويل",
      mentions: [],
      replyToId: "m0",
      createdAt: Date.parse("2026-03-01T10:00:00.000Z"),
      attempts: 0,
      failed: { status: 0, key: "outbox.reason.invalid" },
    });
    expect(outboxItemOfPending(CONV, buildPendingMessage({ ...input("k2") })).failed).toBeUndefined();
  });
});
