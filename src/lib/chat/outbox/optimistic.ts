import type { QueryClient } from "@tanstack/react-query";
import type { MessageDto } from "@/server/chat/dto";
import { appendPending, failPending, removePending, replacePending, resumePending, type PendingInput } from "@/lib/chat/cache/pending";
import type { Outbox, OutboxFailure } from "@/lib/chat/outbox/queue";
import { postChatMessage, SEND_TIMEOUT_MS, type ChatSendPayload } from "@/lib/chat/outbox/send";

/**
 * C1.8 — THE FIRST ATTEMPT OF A SEND, OPTIMISTIC. The composer calls `startOptimisticSend` when the person presses send:
 *
 *  1. the bubble is written to the cache at once (`appendPending`), before anything goes over the network — the person sees their message
 *     with a clock, not a button that waits;
 *  2. the request goes out with the message's `clientId` (the server answers a repeat of it with the message it already made, and checks it BEFORE
 *     the rate limit: F0.7, `@@unique([authorId, clientId])`), and the answer replaces the bubble in place (`replacePending`);
 *  3. every failure is handed to the existing outbox (`src/lib/chat/outbox/`) with the SAME `clientId`: no network or a 5xx front door → kept for its
 *     retry (the bubble keeps its clock), a 429 → kept with its Retry-After, a refusal → kept MARKED and the bubble turns red with the reason
 *     (red «!» + «إعادة المحاولة»); a full outbox → the bubble turns red and says so.
 *
 * Order is kept: while this conversation already has a message waiting in the outbox (or the browser is offline) the new message does not make a
 * request of its own, it joins the queue behind the others.
 *
 * Only a plain text goes this way: a message with files (uploaded first, with their progress bars), a voice note and a poll keep the old flow, and
 * when the cache has no window of the conversation (or it is not the newest one) nothing is drawn and `shown` is false — nothing was sent either,
 * so the caller sends the old way.
 */

export interface OptimisticDeps {
  qc: QueryClient;
  outbox: Pick<Outbox, "enqueue" | "forConversation" | "flush" | "retryNow" | "remove">;
  /** the one request (default: `postChatMessage`); a test hands its own */
  post?: (conversationId: string, payload: ChatSendPayload, fetchImpl: undefined, timeoutMs: number) => Promise<import("@/lib/chat/outbox/queue").SendOutcome>;
  /** is the browser online (default: `navigator.onLine`) */
  online?: () => boolean;
}

export interface OptimisticSendInput {
  conversationId: string;
  payload: ChatSendPayload;
  author: PendingInput["author"];
  replyTo?: PendingInput["replyTo"];
}

export type OptimisticOutcome =
  | { kind: "sent"; message: MessageDto }
  /** handed to the outbox (waiting for the network or a Retry-After); the bubble is still «sending» */
  | { kind: "kept" }
  /** the server refused it for good: the outbox holds it marked, the bubble is red */
  | { kind: "refused"; failure: OutboxFailure }
  /** the outbox was full: the bubble is red and the words stay in it */
  | { kind: "full" };

export function startOptimisticSend(deps: OptimisticDeps, input: OptimisticSendInput): { shown: false } | { shown: true; done: Promise<OptimisticOutcome> } {
  const { payload, conversationId } = input;
  const body = payload.body.trim();
  if (payload.attachmentIds.length > 0 || payload.voice === true || body.length === 0) return { shown: false };

  const shown = appendPending(deps.qc, conversationId, {
    clientId: payload.clientId,
    body,
    author: input.author,
    mentions: payload.mentions,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
  if (!shown) return { shown: false };

  const keep = (opts: { retryAfterSec?: number; failed?: OutboxFailure } = {}): OptimisticOutcome | null => {
    const result = deps.outbox.enqueue(
      {
        clientId: payload.clientId,
        conversationId,
        body,
        mentions: payload.mentions,
        ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
        ...(payload.mentionAll ? { mentionAll: true } : {}),
        ...(payload.noPreview ? { noPreview: true } : {}),
      },
      Date.now(),
      opts,
    );
    if (result.ok) return null;
    failPending(deps.qc, conversationId, payload.clientId, "outbox.full");
    return { kind: "full" };
  };

  const online = (deps.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false))();
  const waiting = deps.outbox.forConversation(conversationId).some((i) => !i.failed);
  if (waiting || !online) {
    const full = keep();
    if (!full && waiting) void deps.outbox.flush({ force: true });
    return { shown: true, done: Promise.resolve(full ?? { kind: "kept" }) };
  }

  const post = deps.post ?? ((c, p, f, t) => postChatMessage(c, p, f, t));
  const done = post(conversationId, payload, undefined, SEND_TIMEOUT_MS).then((outcome): OptimisticOutcome => {
    if (outcome.kind === "sent") {
      replacePending(deps.qc, conversationId, outcome.message);
      return { kind: "sent", message: outcome.message };
    }
    if (outcome.kind === "transient") return keep() ?? { kind: "kept" };
    if (outcome.kind === "limited") return keep({ retryAfterSec: outcome.retryAfterSec }) ?? { kind: "kept" };
    const full = keep({ failed: outcome.failure });
    if (full) return full;
    failPending(deps.qc, conversationId, payload.clientId, outcome.failure.key);
    return { kind: "refused", failure: outcome.failure };
  });
  return { shown: true, done };
}

/** «إعادة المحاولة» on a bubble: it gets its clock back and the outbox sends it now (the same `clientId`, so never twice). */
export function retryPending(deps: Pick<OptimisticDeps, "qc" | "outbox">, conversationId: string, clientId: string): void {
  resumePending(deps.qc, conversationId, clientId);
  deps.outbox.retryNow(clientId);
}

/** «احذف» on a bubble: the bubble and the outbox's copy both go, and nothing is sent. */
export function discardPending(deps: Pick<OptimisticDeps, "qc" | "outbox">, conversationId: string, clientId: string): void {
  deps.outbox.remove(clientId);
  removePending(deps.qc, conversationId, clientId);
}
