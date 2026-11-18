/**
 * C1.8 — the first attempt of a send, optimistic (`src/lib/chat/outbox/optimistic.ts`): the bubble is in the cache BEFORE the request is answered,
 * the answer replaces it in place, and every failure is handed to the existing outbox with the SAME clientId (so a retry can never send twice).
 */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatKeys, LATEST, type MessageDto, type MessagesData } from "../src/lib/chat/cache";
import { isPendingMessage, pendingIdOf, resetPendingForTests } from "../src/lib/chat/cache/pending";
import { Outbox, OUTBOX_CAP, type OutboxItem, type SendOutcome } from "../src/lib/chat/outbox/queue";
import { memoryOutboxStorage } from "../src/lib/chat/outbox/storage";
import { discardPending, retryPending, startOptimisticSend, type OptimisticDeps } from "../src/lib/chat/outbox/optimistic";
import type { ChatSendPayload } from "../src/lib/chat/outbox/send";

const CONV = "c1";
const ME = { id: "me", name: "أنا", avatar: null };
const base = (id: string, at: string, over: Partial<MessageDto> = {}): MessageDto => ({ id, kind: "TEXT", body: `نص ${id}`, deleted: false, edited: false, pinned: false, mine: false, authorId: "other", authorName: "سارة", createdAt: at, clientId: null, mentions: [], attachments: [], reactions: [], ...over });
const answerOf = (clientId: string, over: Partial<MessageDto> = {}): MessageDto => base(`srv-${clientId}`, "2099-01-01T00:00:00.000Z", { mine: true, authorId: ME.id, authorName: ME.name, clientId, ...over });

function cache(withWindow = true): QueryClient {
  const qc = new QueryClient();
  if (withWindow) qc.setQueryData<MessagesData>(chatKeys.messages(CONV), { pages: [{ messages: [base("m1", "2026-03-01T10:00:00.000Z")], hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [] }], pageParams: [LATEST] });
  return qc;
}
const windowOf = (qc: QueryClient): MessageDto[] => qc.getQueryData<MessagesData>(chatKeys.messages(CONV))!.pages.flatMap((p) => p.messages);
const payload = (clientId: string, over: Partial<ChatSendPayload> = {}): ChatSendPayload => ({ body: "مرحبا", attachmentIds: [], mentions: [], clientId, ...over });

/** A post whose answer the test holds in its hand. */
function heldPost() {
  let resolve: (o: SendOutcome) => void = () => undefined;
  const post = vi.fn((_conversationId: string, _payload: ChatSendPayload) => new Promise<SendOutcome>((r) => (resolve = r)));
  return { post: post as unknown as NonNullable<OptimisticDeps["post"]>, spy: post, answer: (o: SendOutcome) => resolve(o) };
}
function rig(opts: { window?: boolean; online?: boolean } = {}) {
  const qc = cache(opts.window ?? true);
  const sendFn = vi.fn(async (item: OutboxItem): Promise<SendOutcome> => ({ kind: "sent", message: answerOf(item.clientId) }));
  const outbox = new Outbox({ userId: "me", storage: memoryOutboxStorage(), send: sendFn });
  const held = heldPost();
  const deps: OptimisticDeps = { qc, outbox, post: held.post, online: () => opts.online ?? true };
  return { qc, outbox, sendFn, held, deps };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T10:00:10.000Z"));
  resetPendingForTests();
});
afterEach(() => vi.useRealTimers());

const start = (deps: OptimisticDeps, clientId = "k1", over: Partial<ChatSendPayload> = {}) =>
  startOptimisticSend(deps, { conversationId: CONV, payload: payload(clientId, over), author: ME });

describe("C1.8: the bubble comes first", () => {
  it("is in the cache the moment send is pressed, before the request is answered; the answer replaces it in place", async () => {
    const r = rig();
    const started = start(r.deps);
    expect(started.shown).toBe(true);
    // synchronously: the bubble is there, the request is out, nothing has been answered
    expect(windowOf(r.qc).map((m) => m.id)).toEqual(["m1", pendingIdOf("k1")]);
    expect(r.held.spy).toHaveBeenCalledTimes(1);
    expect(r.held.spy.mock.calls[0]![1]).toMatchObject({ clientId: "k1", body: "مرحبا" });
    if (!started.shown) throw new Error("unreachable");
    r.held.answer({ kind: "sent", message: answerOf("k1", { status: "sent" }) });
    const done = await started.done;
    expect(done.kind).toBe("sent");
    expect(windowOf(r.qc).map((m) => m.id)).toEqual(["m1", "srv-k1"]);
    expect(windowOf(r.qc).some(isPendingMessage)).toBe(false);
    expect(r.outbox.getSnapshot()).toEqual([]);
    r.outbox.dispose();
  });

  it("a message with files, a voice note, or an empty text is not drawn early (the old flow, with its upload bars)", () => {
    const r = rig();
    expect(start(r.deps, "k1", { attachmentIds: ["f1"] }).shown).toBe(false);
    expect(start(r.deps, "k2", { voice: true, body: "" }).shown).toBe(false);
    expect(start(r.deps, "k3", { body: "   " }).shown).toBe(false);
    expect(windowOf(r.qc).map((m) => m.id)).toEqual(["m1"]);
    expect(r.held.spy).not.toHaveBeenCalled();
    r.outbox.dispose();
  });

  it("with no window of the conversation in the cache nothing is drawn and nothing is sent: the caller sends the old way", () => {
    const r = rig({ window: false });
    expect(start(r.deps).shown).toBe(false);
    expect(r.held.spy).not.toHaveBeenCalled();
    expect(r.outbox.getSnapshot()).toEqual([]);
    r.outbox.dispose();
  });
});

describe("C1.8: failures are handed to the outbox, with the same clientId", () => {
  it("no network answer: the message is kept for the outbox's retry, the bubble stays (sending), and it is sent once more by the SAME clientId", async () => {
    const r = rig();
    const started = start(r.deps);
    if (!started.shown) throw new Error("unreachable");
    r.held.answer({ kind: "transient" });
    expect((await started.done).kind).toBe("kept");
    expect(r.outbox.getSnapshot().map((i) => i.clientId)).toEqual(["k1"]);
    expect(windowOf(r.qc)[1]).toMatchObject({ id: pendingIdOf("k1"), pending: { state: "sending" } });
    // the outbox's own retry (2 s later) goes out with the clientId the first attempt had
    await vi.advanceTimersByTimeAsync(2_100);
    expect(r.sendFn.mock.calls.map(([item]) => item.clientId)).toEqual(["k1"]);
    expect(r.held.spy).toHaveBeenCalledTimes(1); // the composer's own attempt was ONE
    r.outbox.dispose();
  });

  it("429: kept with its Retry-After", async () => {
    const r = rig();
    const started = start(r.deps);
    if (!started.shown) throw new Error("unreachable");
    r.held.answer({ kind: "limited", retryAfterSec: 30 });
    expect((await started.done).kind).toBe("kept");
    expect(r.outbox.getSnapshot()[0]).toMatchObject({ clientId: "k1", rateLimited: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(r.sendFn).not.toHaveBeenCalled(); // still waiting for the Retry-After
    r.outbox.dispose();
  });

  it("a refusal: the bubble turns red with the reason and the outbox keeps the message, marked, never sent by itself", async () => {
    const r = rig();
    const started = start(r.deps);
    if (!started.shown) throw new Error("unreachable");
    r.held.answer({ kind: "refused", failure: { status: 403, key: "outbox.reason.forbidden" } });
    const done = await started.done;
    expect(done).toMatchObject({ kind: "refused", failure: { key: "outbox.reason.forbidden" } });
    expect(windowOf(r.qc)[1]!.pending).toEqual({ state: "failed", reason: "outbox.reason.forbidden" });
    expect(r.outbox.getSnapshot()[0]?.failed?.key).toBe("outbox.reason.forbidden");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(r.sendFn).not.toHaveBeenCalled();
    r.outbox.dispose();
  });

  it("«إعادة المحاولة» sends the refused message again with the same clientId, and the bubble gets its clock back", async () => {
    const r = rig();
    const started = start(r.deps);
    if (!started.shown) throw new Error("unreachable");
    r.held.answer({ kind: "refused", failure: { status: 422, key: "outbox.reason.invalid" } });
    await started.done;
    retryPending(r.deps, CONV, "k1");
    expect(windowOf(r.qc)[1]!.pending).toEqual({ state: "sending" });
    await vi.advanceTimersByTimeAsync(10);
    expect(r.sendFn.mock.calls.map(([item]) => item.clientId)).toEqual(["k1"]);
    r.outbox.dispose();
  });

  it("«احذف» removes the bubble and the outbox item, and nothing is ever sent", async () => {
    const r = rig();
    const started = start(r.deps);
    if (!started.shown) throw new Error("unreachable");
    r.held.answer({ kind: "refused", failure: { status: 403, key: "outbox.reason.forbidden" } });
    await started.done;
    discardPending(r.deps, CONV, "k1");
    expect(windowOf(r.qc).map((m) => m.id)).toEqual(["m1"]);
    expect(r.outbox.getSnapshot()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(r.sendFn).not.toHaveBeenCalled();
    r.outbox.dispose();
  });

  it("a full outbox turns the bubble red with «the outbox is full»; the words stay in the bubble", async () => {
    const r = rig();
    for (let i = 0; i < OUTBOX_CAP; i++) r.outbox.enqueue({ clientId: `x${i}`, conversationId: "other-conv", body: "x", mentions: [] });
    const started = start(r.deps);
    if (!started.shown) throw new Error("unreachable");
    r.held.answer({ kind: "transient" });
    expect((await started.done).kind).toBe("full");
    expect(windowOf(r.qc)[1]!.pending).toEqual({ state: "failed", reason: "outbox.full" });
    r.outbox.dispose();
  });
});

describe("C1.8: order is kept", () => {
  it("while something of this conversation waits in the outbox, a new message joins the queue behind it: no request of its own", async () => {
    const r = rig();
    r.outbox.enqueue({ clientId: "older", conversationId: CONV, body: "الأقدم", mentions: [] });
    const started = start(r.deps, "k2");
    expect(started.shown).toBe(true);
    expect(r.held.spy).not.toHaveBeenCalled();
    expect(windowOf(r.qc).map((m) => m.id)).toEqual(["m1", pendingIdOf("k2")]);
    if (!started.shown) throw new Error("unreachable");
    expect((await started.done).kind).toBe("kept");
    await vi.advanceTimersByTimeAsync(10);
    expect(r.sendFn.mock.calls.map(([item]) => item.clientId)).toEqual(["older", "k2"]);
    r.outbox.dispose();
  });

  it("offline: the bubble is drawn and the message goes to the outbox without a request", async () => {
    const r = rig({ online: false });
    const started = start(r.deps);
    expect(started.shown).toBe(true);
    expect(r.held.spy).not.toHaveBeenCalled();
    expect(r.outbox.getSnapshot().map((i) => i.clientId)).toEqual(["k1"]);
    expect(windowOf(r.qc)[1]).toMatchObject({ pending: { state: "sending" } });
    r.outbox.dispose();
  });
});
