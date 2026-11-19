/**
 * One attempt to POST a chat message, and what its answer means for the outbox.
 *
 * TRANSIENT (keep it, try again): the request never got an answer (offline, a dropped connection, a timeout), or the
 * server's front door failed: 502 / 503 / 504, 408, 409 (two sends of the same `clientId` crossed: the next one finds the
 * first), and 401 (the session ended: the person signs in again, and the message is still there).
 * 429: wait for `Retry-After`, once. Anything else is a DEFINITIVE refusal: 403 (no longer allowed to post), 404 (the
 * conversation is gone), 422 (the message itself is refused), 5xx other than the three above.
 *
 * The same `clientId` goes with every attempt: the server answers a repeat with the message it already made.
 */
import type { MessageDto } from "@/server/chat/dto";
import { AR } from "@/lib/i18n/dict";
import { buildChatMessagePayload } from "@/lib/chat/conversation/client";
import type { OutboxItem, SendOutcome } from "@/lib/chat/outbox/queue";

/** A request that has not been answered after this long is given up on (the queue tries again). */
export const SEND_TIMEOUT_MS = 20_000;

/** The statuses that mean «not now», not «no». */
export const TRANSIENT_STATUSES: readonly number[] = [401, 408, 409, 502, 503, 504];

/** The dictionary key naming why a refusal happened: the server's own `chat.e.*` line when it has one, else a generic one. */
export function reasonKey(status: number, serverMessage: unknown): string {
  if (typeof serverMessage === "string" && serverMessage.startsWith("chat.") && AR[serverMessage]) return serverMessage;
  if (status === 403) return "outbox.reason.forbidden";
  if (status === 404) return "outbox.reason.gone";
  if (status === 422) return "outbox.reason.invalid";
  if (status === 429) return "outbox.reason.rate";
  return "outbox.reason.other";
}

/** `Retry-After` in seconds (a number of seconds, or an HTTP date); 30 when it is missing or unreadable. */
export function retryAfterSeconds(header: string | null | undefined, now: number = Date.now()): number {
  if (!header) return 30;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return n;
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - now) / 1000));
  return 30;
}

/** An answer that was not a 2xx → what the queue should do. Pure. */
export function classifyFailure(status: number, retryAfter: string | null | undefined, serverMessage?: unknown, now: number = Date.now()): SendOutcome {
  if (TRANSIENT_STATUSES.includes(status)) return { kind: "transient" };
  if (status === 429) return { kind: "limited", retryAfterSec: retryAfterSeconds(retryAfter, now) };
  return { kind: "refused", failure: { status, key: reasonKey(status, serverMessage) } };
}

export interface ChatSendPayload {
  body: string;
  attachmentIds: string[];
  mentions: string[];
  replyToId?: string;
  clientId: string;
  mentionAll?: boolean;
  voice?: boolean;
  /** C3b.2: ✕ on the link's preview was pressed before sending */
  noPreview?: boolean;
}

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> }>;

/**
 * POST the message once (`timeoutMs` 0: no time limit, the browser's own). Never throws: a network error, a timeout and a bad answer all come back as an outcome. The body of
 * the message is never logged.
 */
export async function postChatMessage(conversationId: string, payload: ChatSendPayload, fetchImpl: FetchLike = (input, init) => fetch(input, init), timeoutMs: number = SEND_TIMEOUT_MS): Promise<SendOutcome> {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildChatMessagePayload(payload)),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (response.ok) {
      try {
        return { kind: "sent", message: (await response.json()) as MessageDto };
      } catch {
        // the answer was cut off after the server accepted it: the same clientId finds the message on the next attempt
        return { kind: "transient" };
      }
    }
    let serverMessage: unknown;
    try {
      serverMessage = ((await response.json()) as { message?: unknown } | null)?.message;
    } catch {
      serverMessage = undefined;
    }
    return classifyFailure(response.status, response.headers?.get?.("retry-after"), serverMessage);
  } catch {
    // no answer at all (offline, a dropped connection, the timeout's abort): the message is kept, never dropped
    return { kind: "transient" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The queue's send function: one item → one attempt. */
export function sendOutboxItem(item: OutboxItem): Promise<SendOutcome> {
  return postChatMessage(item.conversationId, {
    body: item.body,
    attachmentIds: item.attachmentIds ?? [],
    mentions: item.mentions,
    ...(item.replyToId ? { replyToId: item.replyToId } : {}),
    clientId: item.clientId,
    ...(item.mentionAll ? { mentionAll: true } : {}),
    ...(item.noPreview ? { noPreview: true } : {}),
  });
}
