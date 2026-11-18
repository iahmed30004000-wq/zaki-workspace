import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffMs, BACKOFF_MAX_MS, Outbox, OUTBOX_CAP, outboxKey, parseStored, sanitizeItem, type OutboxInput, type OutboxItem, type SendOutcome } from "../src/lib/chat/outbox/queue";
import { memoryOutboxStorage } from "../src/lib/chat/outbox/storage";
import { pendingToDraw } from "../src/components/chat/conversation/conversation-screen";
import type { MessageDto } from "../src/server/chat/dto";

/**
 * The outbox's state machine, with fake timers and an in-memory storage: nothing here touches a browser or a network.
 * What each test proves is the sentence in its title; the DB test (tests/db/chat-outbox-idempotency.test.ts) proves the
 * server half (the same clientId never makes a second message).
 */

const message = (clientId: string): MessageDto => ({ id: `srv-${clientId}`, kind: "TEXT", body: "x", deleted: false, edited: false, pinned: false, mine: true, authorId: "u1", authorName: "أنا", createdAt: "2026-01-01T00:00:00Z", clientId, mentions: [], attachments: [], reactions: [] });
const input = (clientId: string, conversationId = "c1", body = `نص ${clientId}`): OutboxInput => ({ clientId, conversationId, body, mentions: [] });

/** A send function whose answers the test scripts, and which remembers every attempt (clientId, at what time). */
function scripted(answers: Record<string, SendOutcome[]> = {}) {
  const attempts: Array<{ id: string; at: number }> = [];
  const send = vi.fn(async (item: OutboxItem): Promise<SendOutcome> => {
    attempts.push({ id: item.clientId, at: Date.now() });
    const queue = answers[item.clientId];
    const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    return next ?? { kind: "sent", message: message(item.clientId) };
  });
  return { send, attempts };
}

function make(userId = "u1", answers: Record<string, SendOutcome[]> = {}, storage = memoryOutboxStorage()) {
  const s = scripted(answers);
  const outbox = new Outbox({ userId, storage, send: s.send });
  return { outbox, storage, ...s };
}

const T0 = new Date("2026-01-01T10:00:00Z").getTime();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("the backoff schedule", () => {
  it("2s, 5s, 15s, 45s, then every 2 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 40].map(backoffMs)).toEqual([2_000, 5_000, 15_000, 45_000, BACKOFF_MAX_MS, BACKOFF_MAX_MS, BACKOFF_MAX_MS]);
    expect(BACKOFF_MAX_MS).toBe(120_000);
    expect(backoffMs(0)).toBe(2_000);
  });

  it("a send that keeps failing is tried at exactly those moments", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "transient" }] });
    outbox.enqueue(input("a"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const gaps = attempts.slice(1).map((x, i) => x.at - (attempts[i] as { at: number }).at);
    // the item was enqueued as failed attempt 1 → first retry after 2s (T0+2s), then 5s, 15s, 45s, 120s, 120s...
    expect(attempts[0]?.at).toBe(T0 + 2_000);
    expect(gaps.slice(0, 5)).toEqual([5_000, 15_000, 45_000, 120_000, 120_000]);
    expect(outbox.getSnapshot()[0]?.attempts).toBeGreaterThan(5);
    outbox.dispose();
  });
});

describe("enqueue, order and persistence", () => {
  it("keeps only what a send needs, small, under the person's own key", async () => {
    const { outbox, storage } = make("u1");
    outbox.enqueue({ clientId: "a", conversationId: "c1", body: "مرحبا", mentions: ["u2"], replyToId: "m9", attachmentIds: ["f1"], mentionAll: true });
    await outbox.settled();
    const raw = storage.dump()[outboxKey("u1")] as string;
    const stored = JSON.parse(raw) as { v: number; userId: string; items: Array<Record<string, unknown>> };
    expect(stored.v).toBe(1);
    expect(stored.userId).toBe("u1");
    expect(Object.keys(stored.items[0] as object).sort()).toEqual(["attachmentIds", "attempts", "body", "clientId", "conversationId", "createdAt", "mentionAll", "mentions", "replyToId"]);
    expect(raw.length).toBeLessThan(400);
    outbox.dispose();
  });

  it("enqueueing the same clientId twice is one item", () => {
    const { outbox } = make();
    outbox.enqueue(input("a"));
    outbox.enqueue(input("a"));
    expect(outbox.getSnapshot()).toHaveLength(1);
    outbox.dispose();
  });

  it("messages of one conversation leave strictly in the order they were written", async () => {
    const { outbox, attempts } = make();
    outbox.enqueue(input("a"), T0);
    outbox.enqueue(input("b"), T0 + 1);
    outbox.enqueue(input("c"), T0 + 2);
    await outbox.flush();
    expect(attempts.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(outbox.getSnapshot()).toEqual([]);
    outbox.dispose();
  });

  it("a failure of the first stops the rest of that conversation (they wait behind it), and the order holds when it comes back", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "transient" }, { kind: "sent", message: message("a") }] });
    outbox.enqueue(input("a"), T0);
    outbox.enqueue(input("b"), T0 + 1);
    await outbox.flush();
    expect(attempts.map((x) => x.id)).toEqual(["a"]); // b was never tried: a failed first
    expect(outbox.getSnapshot().map((i) => i.clientId)).toEqual(["a", "b"]);
    await outbox.flush(); // the network is back
    expect(attempts.map((x) => x.id)).toEqual(["a", "a", "b"]);
    expect(outbox.getSnapshot()).toEqual([]);
    outbox.dispose();
  });

  it("another conversation is not held up by a failing one", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "transient" }] });
    outbox.enqueue(input("a", "c1"));
    outbox.enqueue(input("x", "c2"));
    await outbox.flush();
    expect(attempts.map((x) => x.id).sort()).toEqual(["a", "x"]);
    expect(outbox.getSnapshot().map((i) => i.clientId)).toEqual(["a"]);
    outbox.dispose();
  });

  it("a backoff wait is skipped by an immediate flush (the network came back), a plain timer flush waits for it", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "transient" }, { kind: "transient" }, { kind: "transient" }] });
    outbox.enqueue(input("a"));
    await outbox.flush({ force: true }); // attempt 1 fails → 5s wait
    expect(attempts).toHaveLength(1);
    await outbox.flush({ force: false });
    expect(attempts).toHaveLength(1); // still waiting
    await outbox.flush({ force: true });
    expect(attempts).toHaveLength(2);
    outbox.dispose();
  });

  it("refuses the 201st item with a clear answer and keeps the 200 it has", async () => {
    const { outbox, storage } = make();
    for (let i = 0; i < OUTBOX_CAP; i++) expect(outbox.enqueue(input(`m${i}`)).ok).toBe(true);
    const over = outbox.enqueue(input("one-too-many"));
    expect(over).toEqual({ ok: false, reason: "full" });
    expect(outbox.getSnapshot()).toHaveLength(OUTBOX_CAP);
    await outbox.settled();
    expect(parseStored(storage.dump()[outboxKey("u1")] ?? null, "u1")).toHaveLength(OUTBOX_CAP);
    outbox.dispose();
  });
});

describe("a transient failure and a definitive one", () => {
  it("a definitive refusal marks the item «failed» with its reason, keeps it, never retries it by itself and never drops it", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "refused", failure: { status: 403, key: "outbox.reason.forbidden" } }] });
    outbox.enqueue(input("a"));
    await outbox.flush();
    const item = outbox.getSnapshot()[0];
    expect(item?.failed).toEqual({ status: 403, key: "outbox.reason.forbidden" });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await outbox.flush();
    expect(attempts).toHaveLength(1); // nothing retried it
    expect(outbox.getSnapshot()).toHaveLength(1); // nothing dropped it
    outbox.dispose();
  });

  it("a refused item does not hold back the next messages (the server answered; they are their own)", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "refused", failure: { status: 422, key: "outbox.reason.invalid" } }] });
    outbox.enqueue(input("a"), T0);
    outbox.enqueue(input("b"), T0 + 1);
    await outbox.flush();
    expect(attempts.map((x) => x.id)).toEqual(["a", "b"]);
    expect(outbox.getSnapshot().map((i) => i.clientId)).toEqual(["a"]);
    outbox.dispose();
  });

  it("«إعادة المحاولة» makes a refused item ready again and sends it now", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "refused", failure: { status: 404, key: "outbox.reason.gone" } }, { kind: "sent", message: message("a") }] });
    outbox.enqueue(input("a"));
    await outbox.flush();
    expect(outbox.getSnapshot()[0]?.failed?.status).toBe(404);
    outbox.retryNow("a");
    await outbox.flush(); // joins the pass retryNow started
    expect(attempts.map((x) => x.id)).toEqual(["a", "a"]);
    expect(outbox.getSnapshot()).toEqual([]);
    outbox.dispose();
  });

  it("429 waits for Retry-After and retries once; a second 429 marks the item failed", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "limited", retryAfterSec: 7 }, { kind: "limited", retryAfterSec: 7 }] });
    outbox.enqueue(input("a"));
    await outbox.flush();
    expect(attempts).toHaveLength(1);
    await outbox.flush({ force: true }); // «online» does not end a Retry-After
    expect(attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6_900);
    expect(attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(attempts).toHaveLength(2); // the one retry, at Retry-After
    expect(outbox.getSnapshot()[0]?.failed).toEqual({ status: 429, key: "outbox.reason.rate" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(attempts).toHaveLength(2); // and no more
    outbox.dispose();
  });

  it("429 then success: the retry after Retry-After sends it", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "limited", retryAfterSec: 3 }, { kind: "sent", message: message("a") }] });
    outbox.enqueue(input("a"));
    await outbox.flush();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(attempts).toHaveLength(2);
    expect(outbox.getSnapshot()).toEqual([]);
    outbox.dispose();
  });

  it("a first send answered 429 is queued with its Retry-After as the wait, and one more 429 refuses it", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "limited", retryAfterSec: 5 }] });
    outbox.enqueue(input("a"), T0, { retryAfterSec: 5 });
    await vi.advanceTimersByTimeAsync(4_900);
    expect(attempts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(attempts).toHaveLength(1);
    expect(outbox.getSnapshot()[0]?.failed?.status).toBe(429);
    outbox.dispose();
  });

  it("a send function that throws is a transient failure, never a lost message", async () => {
    const storage = memoryOutboxStorage();
    const outbox = new Outbox({ userId: "u1", storage, send: async () => { throw new Error("boom"); } });
    outbox.enqueue(input("a"));
    await outbox.flush();
    expect(outbox.getSnapshot()).toHaveLength(1);
    expect(outbox.getSnapshot()[0]?.failed).toBeUndefined();
    outbox.dispose();
  });
});

describe("reload, restart and the other tab", () => {
  it("what was waiting before a reload is restored by a new page and sent at once", async () => {
    const storage = memoryOutboxStorage();
    const first = make("u1", { a: [{ kind: "transient" }] }, storage);
    first.outbox.enqueue(input("a"), T0);
    first.outbox.enqueue(input("b"), T0 + 1);
    await first.outbox.settled();
    first.outbox.dispose(); // the page closes

    const second = make("u1", {}, storage); // a new page, a new queue, the same browser storage
    await second.outbox.load();
    expect(second.outbox.getSnapshot().map((i) => i.clientId)).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(second.attempts.map((x) => x.id)).toEqual(["a", "b"]);
    await second.outbox.settled();
    expect(second.outbox.getSnapshot()).toEqual([]);
    expect(storage.dump()[outboxKey("u1")]).toBeUndefined(); // an empty queue leaves nothing behind
    second.outbox.dispose();
  });

  it("a message refused for good is still there, still marked, after a reload", async () => {
    const storage = memoryOutboxStorage();
    const first = make("u1", { a: [{ kind: "refused", failure: { status: 403, key: "outbox.reason.forbidden" } }] }, storage);
    first.outbox.enqueue(input("a"));
    await first.outbox.flush();
    await first.outbox.settled();
    first.outbox.dispose();
    const second = make("u1", {}, storage);
    await second.outbox.load();
    expect(second.outbox.getSnapshot()[0]?.failed?.key).toBe("outbox.reason.forbidden");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(second.attempts).toHaveLength(0);
    second.outbox.dispose();
  });

  it("picks up what another tab of the same person queued, without sending twice what this tab already sent", async () => {
    const storage = memoryOutboxStorage();
    const tabA = make("u1", {}, storage);
    const tabB = make("u1", {}, storage);
    tabA.outbox.enqueue(input("a"));
    await tabA.outbox.settled();
    await tabB.outbox.flush(); // tab B reads the storage at the start of its pass
    expect(tabB.attempts.map((x) => x.id)).toEqual(["a"]);
    await tabB.outbox.settled();
    tabA.outbox.dispose();
    tabB.outbox.dispose();
  });
});

describe("per person", () => {
  it("the storage key carries the user id", () => {
    expect(outboxKey("u1")).not.toBe(outboxKey("u2"));
    expect(outboxKey("u1")).toContain("u1");
  });

  it("somebody else signing in on the same browser never sees or sends another's queue", async () => {
    const storage = memoryOutboxStorage();
    const mine = make("u1", { a: [{ kind: "transient" }] }, storage);
    mine.outbox.enqueue(input("a"));
    await mine.outbox.settled();
    mine.outbox.dispose();

    const theirs = make("u2", {}, storage);
    await theirs.outbox.load();
    expect(theirs.outbox.getSnapshot()).toEqual([]);
    await theirs.outbox.flush();
    expect(theirs.attempts).toHaveLength(0); // u2 never sends u1's message
    theirs.outbox.enqueue(input("z"));
    await theirs.outbox.settled();
    expect(Object.keys(storage.dump()).sort()).toEqual([outboxKey("u1"), outboxKey("u2")]);
    theirs.outbox.dispose();
  });

  it("a payload written for another user id is ignored even under this person's key", () => {
    const foreign = JSON.stringify({ v: 1, userId: "u1", items: [{ clientId: "a", conversationId: "c1", body: "x", mentions: [], createdAt: 1, attempts: 0 }] });
    expect(parseStored(foreign, "u1")).toHaveLength(1);
    expect(parseStored(foreign, "u2")).toEqual([]);
  });

  it("sign-out clears the queue and what the browser holds", async () => {
    const storage = memoryOutboxStorage();
    const mine = make("u1", { a: [{ kind: "transient" }] }, storage);
    mine.outbox.enqueue(input("a"));
    await mine.outbox.settled();
    expect(storage.dump()[outboxKey("u1")]).toBeDefined();
    await mine.outbox.clear();
    expect(mine.outbox.getSnapshot()).toEqual([]);
    expect(storage.dump()[outboxKey("u1")]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mine.attempts).toHaveLength(0);
    mine.outbox.dispose();
  });
});

describe("reconciling with the server's answer, by clientId", () => {
  it("a message the server accepted is announced with its real message, and leaves the queue", async () => {
    const { outbox } = make();
    const heard: Array<[string, string]> = [];
    outbox.onSent((item, m) => heard.push([item.clientId, m.id]));
    outbox.enqueue(input("a"));
    await outbox.flush();
    expect(heard).toEqual([["a", "srv-a"]]);
    expect(outbox.getSnapshot()).toEqual([]);
    outbox.dispose();
  });

  it("the listener hears the message BEFORE the item leaves the queue (one render shows the real message in the bubble's place)", async () => {
    const { outbox } = make();
    let queuedWhenHeard = -1;
    outbox.onSent(() => { queuedWhenHeard = outbox.getSnapshot().length; });
    outbox.enqueue(input("a"));
    await outbox.flush();
    expect(queuedWhenHeard).toBe(1);
    outbox.dispose();
  });

  it("a pending bubble and the message with the same clientId are one: the log draws only what is not a real message yet", () => {
    const items: OutboxItem[] = [
      { clientId: "a", conversationId: "c1", body: "1", mentions: [], createdAt: 1, attempts: 1 },
      { clientId: "b", conversationId: "c1", body: "2", mentions: [], createdAt: 2, attempts: 1 },
      { clientId: "x", conversationId: "c2", body: "3", mentions: [], createdAt: 3, attempts: 1 },
    ];
    // a live refetch won the race: the server's message "a" is already in the log
    expect(pendingToDraw(items, "c1", [message("a")]).map((i) => i.clientId)).toEqual(["b"]);
    expect(pendingToDraw(items, "c1", []).map((i) => i.clientId)).toEqual(["a", "b"]);
    expect(pendingToDraw(items, "c2", [message("a")]).map((i) => i.clientId)).toEqual(["x"]);
  });

  it("a message deleted while it was on its way is still announced if the server accepted it", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = false;
    const outbox = new Outbox({ userId: "u1", storage: memoryOutboxStorage(), send: async (item) => { started = true; await gate; return { kind: "sent", message: message(item.clientId) }; } });
    const heard: string[] = [];
    outbox.onSent((item) => heard.push(item.clientId));
    outbox.enqueue(input("a"));
    const flushing = outbox.flush();
    await vi.waitFor(() => expect(started).toBe(true));
    outbox.remove("a"); // the person deletes it while the request is in the air
    release();
    await flushing;
    expect(heard).toEqual(["a"]); // the message exists on the server: the screen must show it
    outbox.dispose();
  });

  it("«احذف» removes an item and it is never sent", async () => {
    const { outbox, attempts } = make("u1", { a: [{ kind: "transient" }] });
    outbox.enqueue(input("a"));
    outbox.remove("a");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(attempts).toHaveLength(0);
    expect(outbox.getSnapshot()).toEqual([]);
    outbox.dispose();
  });
});

describe("what the storage holds is only believed after a check", () => {
  it("drops a broken entry and keeps the good ones", () => {
    const good = { clientId: "a", conversationId: "c1", body: "نص", mentions: ["u2"], createdAt: 5, attempts: 2 };
    expect(sanitizeItem(good)).toEqual(good);
    for (const bad of [null, "x", {}, { ...good, clientId: "" }, { ...good, body: 5 }, { ...good, createdAt: "now" }, { ...good, body: "", attachmentIds: undefined }, { ...good, body: "x".repeat(4_001) }]) {
      expect(sanitizeItem(bad), JSON.stringify(bad).slice(0, 40)).toBeNull();
    }
    const raw = JSON.stringify({ v: 1, userId: "u1", items: [good, { nope: true }, good] });
    expect(parseStored(raw, "u1")).toHaveLength(1); // the broken one and the duplicate are gone
    expect(parseStored("not json", "u1")).toEqual([]);
    expect(parseStored(JSON.stringify({ v: 2, userId: "u1", items: [good] }), "u1")).toEqual([]);
    expect(parseStored(null, "u1")).toEqual([]);
  });

  it("keeps an attachment-only message and the failure mark", () => {
    const item = sanitizeItem({ clientId: "a", conversationId: "c1", body: "", attachmentIds: ["f1"], mentions: [], createdAt: 5, attempts: 0, failed: { status: 422, key: "outbox.reason.invalid" } });
    expect(item?.attachmentIds).toEqual(["f1"]);
    expect(item?.failed).toEqual({ status: 422, key: "outbox.reason.invalid" });
  });
});

describe("C1.8: a message that was refused at its first attempt is kept already marked", () => {
  it("enqueue with `failed` keeps it as a refused item: never sent by itself, shown with its reason, ready for «إعادة المحاولة»", async () => {
    const { outbox, attempts } = make("u1");
    const result = outbox.enqueue(input("r1"), Date.now(), { failed: { status: 403, key: "outbox.reason.forbidden" } });
    expect(result.ok && result.item.failed).toEqual({ status: 403, key: "outbox.reason.forbidden" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(attempts).toEqual([]);
    expect(outbox.getSnapshot()[0]?.failed?.key).toBe("outbox.reason.forbidden");
    outbox.retryNow("r1");
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts.map((a) => a.id)).toEqual(["r1"]);
    expect(outbox.getSnapshot()).toEqual([]);
    outbox.dispose();
  });

  it("a refused item does not hold back the messages behind it (the server answered)", async () => {
    const { outbox, attempts } = make("u1");
    outbox.enqueue(input("r1"), Date.now(), { failed: { status: 422, key: "outbox.reason.invalid" } });
    outbox.enqueue(input("r2"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(attempts.map((a) => a.id)).toEqual(["r2"]);
    outbox.dispose();
  });

  it("the failure mark survives a reload", async () => {
    const storage = memoryOutboxStorage();
    const first = make("u1", {}, storage);
    first.outbox.enqueue(input("r1"), Date.now(), { failed: { status: 403, key: "outbox.reason.forbidden" } });
    await first.outbox.settled();
    first.outbox.dispose();
    const second = make("u1", {}, storage);
    await second.outbox.load();
    expect(second.outbox.getSnapshot()[0]?.failed?.key).toBe("outbox.reason.forbidden");
    second.outbox.dispose();
  });
});
