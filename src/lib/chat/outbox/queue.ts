/**
 * THE CHAT OUTBOX: the queue state machine («الرسالة بتنحفظ وبتنبعت لما يرجع النت»).
 *
 * A message that could not be sent because the network is gone (offline, a dropped connection, a timeout,
 * a 502/503/504) is kept here instead of failing. It is held in the browser, shown in the log as «بانتظار
 * الإرسال», and sent again until the server answers.
 *
 * Pure apart from the two things it is handed (`storage` and `send`), so every rule below is proven with fake
 * timers and an in-memory storage (tests/chat-outbox-queue.test.ts):
 *
 * - ORDER: one conversation's messages leave strictly one after the other, oldest first. A transient failure of
 *   the first stops the rest of that conversation until it is retried (different conversations are independent).
 * - NO DUPLICATES: every item carries the `clientId` it will be sent with, and the server answers a second
 *   send with the same `clientId` (same author) with the message it already made. So a retry after a timeout
 *   whose first attempt DID reach the server cannot create a second message.
 * - A DEFINITIVE refusal (403, 404, 422 ...) is never retried and never dropped: the item turns «تعذّر الإرسال»
 *   and stays for the person to edit, copy or delete. A 429 waits for Retry-After and retries once.
 * - PER USER: the storage key carries the user id and the payload repeats it; a payload of somebody else is ignored.
 * - SMALL: only what a send needs is stored (never a file, never the sender's name), and at most OUTBOX_CAP items.
 *
 * Message bodies are never logged here.
 */
import type { MessageDto } from "@/server/chat/dto";
import type { OutboxStorage } from "@/lib/chat/outbox/storage";
import { QUOTE_MAX } from "@/lib/chat/v2/menu/gestures";

/** At most this many items wait at once; the 201st is refused with a clear error. */
export const OUTBOX_CAP = 200;
/** After the n-th failed attempt: 2s, 5s, 15s, 45s, then every 2 minutes. */
export const BACKOFF_MS: readonly number[] = [2_000, 5_000, 15_000, 45_000];
export const BACKOFF_MAX_MS = 120_000;

/** How long to wait after `attempts` failed attempts (1 = the first failure). */
export function backoffMs(attempts: number): number {
  if (!Number.isFinite(attempts) || attempts < 1) return BACKOFF_MS[0] as number;
  return BACKOFF_MS[attempts - 1] ?? BACKOFF_MAX_MS;
}

export interface OutboxFailure {
  /** the HTTP status of the refusal (0: none) */
  status: number;
  /** a dictionary key naming the reason (`outbox.reason.*` or a server `chat.e.*`) */
  key: string;
}

export interface OutboxItem {
  clientId: string;
  conversationId: string;
  body: string;
  /** the ids of the people mentioned */
  mentions: string[];
  replyToId?: string;
  /** S5.7 «رد بالاقتباس»: the piece of the original the person picked (at most 280 characters; only with `replyToId`) — a retry, even after a reload, still quotes */
  replyQuote?: string;
  /** files already uploaded (their ids only; the bytes are on the server) */
  attachmentIds?: string[];
  mentionAll?: boolean;
  /** C3b.2: ✕ was pressed on the link's preview: a retry (even after a reload) must not make the server visit the link */
  noPreview?: boolean;
  /** C3c.2: «ابعت بدون صوت»: every retry (even after a reload) is still silent */
  silent?: boolean;
  /** epoch ms of the moment the person pressed send (the order of the log) */
  createdAt: number;
  /** failed attempts so far */
  attempts: number;
  /** a definitive refusal: the item is no longer sent */
  failed?: OutboxFailure;
  /** a 429 was already waited out once */
  rateLimited?: boolean;
}

export type OutboxInput = Pick<OutboxItem, "clientId" | "conversationId" | "body" | "mentions"> & Partial<Pick<OutboxItem, "replyToId" | "replyQuote" | "attachmentIds" | "mentionAll" | "noPreview" | "silent">>;

/** What one attempt to send an item came to. */
export type SendOutcome =
  | { kind: "sent"; message: MessageDto }
  /** the network or the server's front door failed: try again later */
  | { kind: "transient" }
  /** 429: wait this many seconds, once */
  | { kind: "limited"; retryAfterSec: number }
  /** the server said no and meant it */
  | { kind: "refused"; failure: OutboxFailure };

export type SendFn = (item: OutboxItem) => Promise<SendOutcome>;

export interface OutboxOptions {
  userId: string;
  storage: OutboxStorage;
  send: SendFn;
}

export type EnqueueResult = { ok: true; item: OutboxItem } | { ok: false; reason: "full" };

interface Wait {
  at: number;
  /** a Retry-After: only its time ends it (the online event does not) */
  hard: boolean;
}

const MAX_BODY = 4_000;

/** The key one person's queue is stored under. */
export function outboxKey(userId: string): string {
  return `zaki.outbox.v1.${userId}`;
}
/** Every key of the outbox starts with this (sign-out clears them all). */
export const OUTBOX_KEY_PREFIX = "zaki.outbox.v1.";

/** What the storage holds is only believed after this: a broken entry is dropped, never thrown on. */
export function sanitizeItem(raw: unknown): OutboxItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
  const clientId = str(r["clientId"], 64);
  const conversationId = str(r["conversationId"], 64);
  if (!clientId || !conversationId) return null;
  const body = typeof r["body"] === "string" && r["body"].length <= MAX_BODY ? r["body"] : null;
  if (body === null) return null;
  const ids = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64) ? (v as string[]).slice(0, 50) : null);
  const mentions = ids(r["mentions"]) ?? [];
  const attachmentIds = r["attachmentIds"] === undefined ? undefined : (ids(r["attachmentIds"]) ?? undefined);
  const createdAt = typeof r["createdAt"] === "number" && Number.isFinite(r["createdAt"]) ? r["createdAt"] : null;
  if (createdAt === null) return null;
  const attempts = typeof r["attempts"] === "number" && Number.isFinite(r["attempts"]) && r["attempts"] >= 0 ? Math.floor(r["attempts"]) : 0;
  if (body.trim().length === 0 && !(attachmentIds && attachmentIds.length)) return null;
  const item: OutboxItem = { clientId, conversationId, body, mentions, createdAt, attempts };
  const replyToId = str(r["replyToId"], 64);
  if (replyToId) {
    item.replyToId = replyToId;
    const replyQuote = str(r["replyQuote"], QUOTE_MAX);
    if (replyQuote) item.replyQuote = replyQuote;
  }
  if (attachmentIds && attachmentIds.length) item.attachmentIds = attachmentIds;
  if (r["mentionAll"] === true) item.mentionAll = true;
  if (r["noPreview"] === true) item.noPreview = true;
  if (r["silent"] === true) item.silent = true;
  if (r["rateLimited"] === true) item.rateLimited = true;
  const f = r["failed"];
  if (typeof f === "object" && f !== null) {
    const key = str((f as Record<string, unknown>)["key"], 80);
    const status = (f as Record<string, unknown>)["status"];
    if (key) item.failed = { key, status: typeof status === "number" && Number.isFinite(status) ? status : 0 };
  }
  return item;
}

/** The stored text → items, for ONE person (a payload written for another user id is ignored). */
export function parseStored(raw: string | null, userId: string): OutboxItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    const p = parsed as { v?: unknown; userId?: unknown; items?: unknown };
    if (p.v !== 1 || p.userId !== userId || !Array.isArray(p.items)) return [];
    const seen = new Set<string>();
    const out: OutboxItem[] = [];
    for (const entry of p.items) {
      const item = sanitizeItem(entry);
      if (!item || seen.has(item.clientId)) continue;
      seen.add(item.clientId);
      out.push(item);
      if (out.length >= OUTBOX_CAP) break;
    }
    return out;
  } catch {
    return [];
  }
}

const byAge = (a: OutboxItem, b: OutboxItem) => a.createdAt - b.createdAt;

export class Outbox {
  readonly userId: string;
  private readonly storage: OutboxStorage;
  private readonly sendFn: SendFn;
  private items: OutboxItem[] = [];
  /** clientIds sent or removed in this page's life: never brought back from the storage by a merge */
  private readonly gone = new Set<string>();
  private readonly waits = new Map<string, Wait>();
  private readonly listeners = new Set<() => void>();
  private readonly sentListeners = new Set<(item: OutboxItem, message: MessageDto) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private rerun: { force: boolean } | null = null;
  private writing: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: OutboxOptions) {
    this.userId = options.userId;
    this.storage = options.storage;
    this.sendFn = options.send;
  }

  // ---------- reading ----------

  /** The queue, oldest first. A NEW array after every change (a React external-store snapshot). */
  getSnapshot(): readonly OutboxItem[] {
    return this.items;
  }

  /** The items of one conversation, in the order they will be sent. */
  forConversation(conversationId: string): OutboxItem[] {
    return this.items.filter((i) => i.conversationId === conversationId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** `listener` hears every item the server accepted, with the message it made (called before the item leaves the queue). */
  onSent(listener: (item: OutboxItem, message: MessageDto) => void): () => void {
    this.sentListeners.add(listener);
    return () => this.sentListeners.delete(listener);
  }

  // ---------- restoring ----------

  /** Read what a previous page (or tab) left, merge it with what this page already holds, and arm the retry. */
  async load(): Promise<void> {
    await this.mergeFromStorage();
    this.arm();
  }

  private async mergeFromStorage(): Promise<void> {
    await this.writing;
    let stored: OutboxItem[] = [];
    try {
      stored = parseStored(await this.storage.load(outboxKey(this.userId)), this.userId);
    } catch {
      stored = [];
    }
    const have = new Set(this.items.map((i) => i.clientId));
    const fresh = stored.filter((i) => !have.has(i.clientId) && !this.gone.has(i.clientId));
    if (!fresh.length) return;
    this.items = [...this.items, ...fresh].sort(byAge).slice(0, OUTBOX_CAP);
    // a restored item is retried as soon as the page is up (its backoff belongs to the page that failed it)
    this.emit();
  }

  // ---------- writing ----------

  /**
   * Keep a message that could not be sent. It counts as a failed attempt already (the caller tried, or knows it is offline),
   * so the first retry comes after 2 seconds, in order behind whatever is already waiting in this conversation. With `failed` (the
   * server refused it for good at the first attempt) it is kept marked and is never sent by itself.
   */
  enqueue(input: OutboxInput, now: number = Date.now(), opts: { retryAfterSec?: number; failed?: OutboxFailure } = {}): EnqueueResult {
    const existing = this.items.find((i) => i.clientId === input.clientId);
    if (existing) return { ok: true, item: existing };
    if (this.items.length >= OUTBOX_CAP) return { ok: false, reason: "full" };
    const item: OutboxItem = {
      clientId: input.clientId,
      conversationId: input.conversationId,
      body: input.body,
      mentions: [...input.mentions],
      createdAt: now,
      attempts: 1,
      ...(input.replyToId ? { replyToId: input.replyToId, ...(input.replyQuote ? { replyQuote: input.replyQuote } : {}) } : {}),
      ...(input.attachmentIds?.length ? { attachmentIds: [...input.attachmentIds] } : {}),
      ...(input.mentionAll ? { mentionAll: true } : {}),
      ...(input.noPreview ? { noPreview: true } : {}),
      ...(input.silent ? { silent: true } : {}),
      ...(opts.retryAfterSec !== undefined ? { rateLimited: true } : {}),
      // C1.8: the first attempt was refused for good (the optimistic bubble already shows it red): kept marked, never sent by itself
      ...(opts.failed ? { failed: opts.failed } : {}),
    };
    this.items = [...this.items, item];
    if (opts.failed) {
      // nothing to wait for: only «إعادة المحاولة» sends it again
    } else if (opts.retryAfterSec !== undefined) {
      // the first send was answered 429: wait for its Retry-After, once (a second 429 refuses the item)
      const seconds = Math.min(Math.max(Math.ceil(opts.retryAfterSec), 1), 600);
      this.waits.set(item.conversationId, { at: Date.now() + seconds * 1000, hard: true });
    } else if (!this.waits.has(item.conversationId)) {
      this.waits.set(item.conversationId, { at: Date.now() + backoffMs(1), hard: false });
    }
    this.changed();
    return { ok: true, item };
  }

  /** «احذف»: the item leaves the queue (a message already on its way may still arrive: the screen shows it when it does). */
  remove(clientId: string): void {
    if (!this.items.some((i) => i.clientId === clientId)) return;
    this.gone.add(clientId);
    this.items = this.items.filter((i) => i.clientId !== clientId);
    this.changed();
  }

  /** «إعادة المحاولة»: a refused item is made ready again, and the queue is flushed now. */
  retryNow(clientId: string): void {
    const item = this.items.find((i) => i.clientId === clientId);
    if (!item) return;
    if (item.failed || item.rateLimited) {
      const ready: OutboxItem = { ...item, attempts: 0 };
      delete ready.failed;
      delete ready.rateLimited;
      this.items = this.items.map((i) => (i.clientId === clientId ? ready : i));
      this.waits.delete(item.conversationId);
      this.changed();
    }
    void this.flush({ force: true });
  }

  /** Sign-out: nothing of this person stays in the browser. */
  async clear(): Promise<void> {
    for (const i of this.items) this.gone.add(i.clientId);
    this.items = [];
    this.waits.clear();
    this.disarm();
    this.emit();
    this.writing = this.writing.then(() => this.storage.remove(outboxKey(this.userId))).catch(() => undefined);
    await this.writing;
  }

  dispose(): void {
    this.disposed = true;
    this.disarm();
    this.listeners.clear();
    this.sentListeners.clear();
  }

  // ---------- sending ----------

  /**
   * Try to send. `force` (the network came back, the page came back, the person pressed «إعادة المحاولة») skips a
   * backoff wait but never a Retry-After wait. A flush asked for while one runs is folded into one more pass.
   */
  flush(opts: { force?: boolean } = {}): Promise<void> {
    const force = opts.force ?? true;
    if (this.disposed) return Promise.resolve();
    if (this.running) {
      this.rerun = { force: (this.rerun?.force ?? false) || force };
      return this.running;
    }
    this.running = (async () => {
      let next: { force: boolean } | null = { force };
      while (next) {
        this.rerun = null;
        await this.pass(next.force);
        next = this.rerun;
      }
    })().finally(() => {
      this.running = null;
      this.arm();
    });
    return this.running;
  }

  private async pass(force: boolean): Promise<void> {
    await this.mergeFromStorage();
    const conversations = [...new Set(this.items.filter((i) => !i.failed).map((i) => i.conversationId))];
    await Promise.all(conversations.map((c) => this.drain(c, force)));
  }

  private async drain(conversationId: string, force: boolean): Promise<void> {
    const wait = this.waits.get(conversationId);
    if (wait && Date.now() < wait.at && !(force && !wait.hard)) return;
    this.waits.delete(conversationId);
    for (;;) {
      if (this.disposed) return;
      const item = this.items.find((i) => i.conversationId === conversationId && !i.failed);
      if (!item) return;
      let outcome: SendOutcome;
      try {
        outcome = await this.sendFn(item);
      } catch {
        outcome = { kind: "transient" };
      }
      if (this.disposed) return;
      if (outcome.kind === "sent") {
        // the message exists on the server whether or not the person deleted the item meanwhile
        this.gone.add(item.clientId);
        for (const l of this.sentListeners) {
          try {
            l(item, outcome.message);
          } catch {
            /* a screen's listener must not stop the queue */
          }
        }
        this.items = this.items.filter((i) => i.clientId !== item.clientId);
        this.changed();
        continue;
      }
      const stillThere = this.items.some((i) => i.clientId === item.clientId);
      if (outcome.kind === "transient") {
        if (!stillThere) continue;
        const attempts = item.attempts + 1;
        this.patch(item.clientId, { attempts });
        this.waits.set(conversationId, { at: Date.now() + backoffMs(attempts), hard: false });
        return;
      }
      if (outcome.kind === "limited") {
        if (!stillThere) continue;
        if (item.rateLimited) {
          this.patch(item.clientId, { failed: { status: 429, key: "outbox.reason.rate" } });
          continue;
        }
        const seconds = Math.min(Math.max(Math.ceil(outcome.retryAfterSec), 1), 600);
        this.patch(item.clientId, { rateLimited: true, attempts: item.attempts + 1 });
        this.waits.set(conversationId, { at: Date.now() + seconds * 1000, hard: true });
        return;
      }
      // refused: the server said no and meant it. It is kept, marked, and never retried by itself.
      if (stillThere) this.patch(item.clientId, { failed: outcome.failure });
    }
  }

  private patch(clientId: string, change: Partial<OutboxItem>): void {
    this.items = this.items.map((i) => (i.clientId === clientId ? { ...i, ...change } : i));
    this.changed();
  }

  /** The timer for the earliest wait; nothing is armed while nothing waits. */
  private arm(): void {
    this.disarm();
    if (this.disposed) return;
    let at: number | null = null;
    for (const c of new Set(this.items.filter((i) => !i.failed).map((i) => i.conversationId))) {
      const w = this.waits.get(c);
      const when = w ? w.at : Date.now();
      if (at === null || when < at) at = when;
    }
    if (at === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush({ force: false });
    }, Math.max(0, at - Date.now()));
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---------- persistence ----------

  private changed(): void {
    this.persist();
    this.emit();
    if (!this.running) this.arm();
  }

  private emit(): void {
    // a new array, so an external-store snapshot comparison sees the change
    this.items = [...this.items];
    for (const l of this.listeners) l();
  }

  private persist(): void {
    const payload = JSON.stringify({ v: 1, userId: this.userId, items: this.items });
    const key = outboxKey(this.userId);
    const empty = this.items.length === 0;
    this.writing = this.writing
      .then(() => (empty ? this.storage.remove(key) : this.storage.save(key, payload)))
      .catch(() => undefined); // storage refused (private window, full): the queue still works while the page lives
  }

  /** Resolves when every write so far reached the storage (tests, and sign-out). */
  async settled(): Promise<void> {
    await this.writing;
  }
}
