import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { chatSyncUrl, conversationMessagesUrl } from "@/lib/chat/conversation/client";
import { applyCatchUp, applySync, newestKnownId, refreshMessages } from "@/lib/chat/cache/writer";
import { fetchChatJson } from "@/lib/chat/cache/http";
import type { MessagesPageDto, SyncAnswer } from "@/lib/chat/cache/types";

/**
 * C1.4 — `scheduleSync`: the live line's frames carry ids only, so the cache asks the feed «what changed?» (`GET /api/chat/sync?after=`).
 *
 *  - Frames are folded for 120 ms into ONE question; there is never more than one question in flight, and a frame that arrives
 *    meanwhile makes the engine ask once more when the answer is in.
 *  - The answer is applied by the writer (`applySync`), and the engine asks again at once while the answer was full
 *    (`more`, or as many messages as the limit) — a long absence is replayed in a few quick steps.
 *  - `reset`: the writer marks everything stale (the list, the headers and the windows on screen reload); the engine continues
 *    from the cursor the answer carried.
 *  - A failed question is asked again after a growing pause (never when the server said «no» to this person, never while offline:
 *    the `online` event asks), and every later frame, focus after a long sleep, or reconnect asks as well.
 *
 * No cursor yet (a cold start): the first question has no `after`, and only learns where «now» is. The list is read AFTER that, so
 * whatever happens in between is replayed; a replay is harmless (a message already there is replaced by itself).
 */

/** Frames of one burst are folded for this long. */
export const SYNC_COALESCE_MS = 120;
/** The most events a sync answer carries; a full answer means «ask again at once». */
export const SYNC_LIMIT = 500;
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const RETRY_TRIES = 6;
const CATCH_UP_STEPS = 6;

export interface SyncDeps {
  fetchJson<T>(url: string): Promise<T>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  isOnline(): boolean;
}

export const browserSyncDeps: SyncDeps = {
  fetchJson: (url) => fetchChatJson(url),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
};

/** Event ids are numbers kept as text; compare them as numbers. */
export function compareCursor(a: string, b: string): number {
  try {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  } catch {
    return a === b ? 0 : a < b ? -1 : 1;
  }
}

export class ChatSyncEngine {
  private cursorValue: string | null = null;
  private timer: unknown = null;
  private flight: Promise<void> | null = null;
  private again = false;
  private retryTimer: unknown = null;
  private tries = 0;
  private stopped = false;
  private answeredOnce = false;
  /** a rewind asked for while a question was in the air: it must survive that answer */
  private rewindTarget: string | null = null;
  private catchingUp = 0;
  private listeners = new Set<() => void>();
  private resetListeners = new Set<() => void>();

  constructor(
    private readonly qc: QueryClient,
    private readonly deps: SyncDeps = browserSyncDeps,
    private readonly meId: () => string | undefined = () => undefined,
  ) {}

  get cursor(): string | null {
    return this.cursorValue;
  }

  /** The feed has answered at least once since the engine started: what the cache holds and the cursor belong together. */
  get answered(): boolean {
    return this.answeredOnce;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /** A conversation is being caught up: the window lacks messages the cursor has already passed, so nothing may be written to the device. */
  get busy(): boolean {
    return this.catchingUp > 0;
  }

  /** The device copy brought a cursor (C1.5): a cursor already learned from the server is newer and is kept. */
  adoptCursor(cursor: string): boolean {
    if (this.stopped || this.cursorValue !== null) return false;
    this.cursorValue = cursor;
    return true;
  }

  /**
   * A fetch that was in the air while this engine applied events has just landed: it was read BEFORE them, so it may have overwritten
   * what they said. Go back to where that fetch started and ask again; a replay is harmless. Never moves forward.
   */
  rewindTo(cursor: string): void {
    if (this.stopped || this.cursorValue === null) return;
    if (compareCursor(cursor, this.cursorValue) < 0) {
      this.cursorValue = cursor;
      // a question already in the air will land with a cursor ahead of this: it must not undo the rewind
      if (this.flight && (this.rewindTarget === null || compareCursor(cursor, this.rewindTarget) < 0)) this.rewindTarget = cursor;
      this.schedule();
    }
  }

  /** Called when an answer said «start over» (`reset`): everything the cache holds is stale, on the device too. */
  onReset(fn: () => void): () => void {
    this.resetListeners.add(fn);
    return () => this.resetListeners.delete(fn);
  }

  /** Called after every answer that was applied (the device copy listens: its cursor and its data move together). */
  onApplied(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A frame, a focus, a reconnect: ask in 120 ms (one question for the whole burst). */
  schedule(): void {
    if (this.stopped || this.timer !== null) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.run();
    }, SYNC_COALESCE_MS);
  }

  /** Ask now (after my own send, or to learn the cursor before a list is read). Resolves when the engine is idle again. */
  now(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    return this.run();
  }

  /**
   * Learn where «now» is when nothing is known (a cold start), once. A question that was in the air when the engine was stopped and
   * started again (a wipe) ends without a cursor, so it is asked once more. Failing is fine: the list is read anyway.
   */
  async ensureCursor(): Promise<void> {
    for (let attempt = 0; attempt < 2 && this.cursorValue === null && !this.stopped; attempt++) {
      if (this.flight) await this.flight;
      else await this.run();
    }
  }

  /** The wipe, or leaving: forget the cursor and every pending question. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    if (this.retryTimer !== null) this.deps.clearTimer(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    this.cursorValue = null;
    this.again = false;
    this.answeredOnce = false;
  }

  /** A new person (or the first use after a stop): the engine works again, from nothing. */
  start(): void {
    this.stopped = false;
    this.tries = 0;
  }

  private run(): Promise<void> {
    if (this.flight) {
      this.again = true;
      return this.flight;
    }
    this.flight = this.loop().finally(() => {
      this.flight = null;
    });
    return this.flight;
  }

  private async loop(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      this.again = false;
      this.rewindTarget = null; // a rewind only concerns the question that was out when it was asked
      const asked = this.cursorValue;
      let answer: SyncAnswer;
      try {
        answer = await this.deps.fetchJson<SyncAnswer>(chatSyncUrl(asked ?? undefined));
      } catch (error) {
        this.failed(error);
        return;
      }
      if (this.stopped) return;
      this.tries = 0;
      this.answeredOnce = true;
      if (asked === null) {
        // «where is now?»: nothing to apply
        if (this.cursorValue === null) this.cursorValue = answer.cursor;
        for (const l of this.listeners) l();
      } else {
        let catchUp: string[] = [];
        try {
          catchUp = applySync(this.qc, answer, { meId: this.meId() }).catchUp;
        } catch {
          // an answer the writer could not apply must not stop the line: everything is asked for again instead
          void this.qc.invalidateQueries({ queryKey: ["chat"] });
        }
        // a reset answer carries where «now» is (it can be BEHIND the old cursor when that was ahead of anything issued)
        if (answer.reset) {
          this.cursorValue = answer.cursor;
          this.rewindTarget = null;
        } else if (this.rewindTarget !== null) {
          // a fetch that was in the air while this question was out wants the events after ITS start replayed: keep the lower cursor
          this.cursorValue = this.rewindTarget;
          this.rewindTarget = null;
        } else if (this.cursorValue === null || compareCursor(answer.cursor, this.cursorValue) > 0) {
          this.cursorValue = answer.cursor;
        }
        if (catchUp.length) this.catchingUp += catchUp.length;
        for (const l of this.listeners) l();
        if (answer.reset) for (const l of this.resetListeners) l();
        for (const id of catchUp) {
          try {
            await this.catchUp(id);
          } finally {
            this.catchingUp--;
          }
        }
        if (catchUp.length) for (const l of this.listeners) l();
      }
      if (answer.more || answer.messages.length >= SYNC_LIMIT) continue;
      if (this.again) continue;
      return;
    }
  }

  /** A window that may lack some messages: fetch what is newer than its newest one, in order, a few steps at most. */
  private async catchUp(conversationId: string): Promise<void> {
    try {
      for (let step = 0; step < CATCH_UP_STEPS; step++) {
        const after = newestKnownId(this.qc, conversationId);
        if (!after) return;
        const page = await this.deps.fetchJson<MessagesPageDto>(conversationMessagesUrl(conversationId, { after, limit: 50 }));
        applyCatchUp(this.qc, conversationId, page);
        if (!page.hasNewer || page.messages.length === 0) return;
      }
      refreshMessages(this.qc, conversationId);
    } catch {
      refreshMessages(this.qc, conversationId);
    }
  }

  private failed(error: unknown): void {
    const status = error instanceof ApiError ? error.status : 0;
    // signed out, or no right: asking again changes nothing (the stream's own «signed out» takes the person to the sign-in page)
    if (status === 401 || status === 403 || status === 404) return;
    if (!this.deps.isOnline()) return; // the `online` event asks again
    if (this.tries >= RETRY_TRIES || this.retryTimer !== null) return;
    const wait = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** this.tries);
    this.tries++;
    this.retryTimer = this.deps.setTimer(() => {
      this.retryTimer = null;
      void this.run();
    }, wait);
  }
}
