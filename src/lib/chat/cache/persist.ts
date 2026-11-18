import type { QueryClient } from "@tanstack/react-query";
import { chatKeys, convIdOfKey, isChatKey, isHeaderKey, isMessagesKey } from "@/lib/chat/cache/keys";
import { normalizeMessage } from "@/lib/chat/cache/reducers";
import { seedFromDevice, type DeviceConversation } from "@/lib/chat/cache/writer";
import { onChatWipe } from "@/lib/chat/cache/registry";
import { markConversationOpened, onOpened, openedAtOf } from "@/lib/chat/cache/opened";
import { deviceMarkerAvailable, readDeviceMarker, writeDeviceMarker, type StartStore } from "@/lib/chat/cache/device-store";
import type { ChatListDto, ChatRowDto, ConversationHeaderDto, MessageDto, MessagesData } from "@/lib/chat/cache/types";

/**
 * C1.5 — the start cache on the device. What is kept (so the list paints at once, then the feed catches up):
 *   `list`    the chat list (`ChatListDto`)
 *   `conv:id` the header and the LAST 50 MESSAGES of each of the 30 most recently opened conversations
 *   `cursor`  the sync cursor the data above is current to
 *   `meta`    `{ v, userId, savedAt }` — a database that names somebody else is never read
 *
 * Rules (each one has a test, `tests/chat-start-cache-*.test.ts`):
 *  - Written only after the feed has answered once in this page (the stored data and the stored cursor then belong together), and
 *    never for an external partner (the runtime does not even create a persister for one).
 *  - A deleted message is stored as a tombstone — no text, no files, no reactions — whatever the cache held; the owner-only extras
 *    of a message (`history`, `original`, `notes`) are never stored at all.
 *  - Only data that is CURRENT is written: what the server confirmed in this page, or what came from the device and the feed has
 *    caught up from the stored cursor (no `reset` in between). A window a `reset` made stale is dropped from the store, not renewed.
 *  - At most 30 conversations and 20 MB; the least recently OPENED goes first.
 *  - Every write replaces the WHOLE copy in ONE transaction, a moment after the last change: what is on the device is always one
 *    page's consistent snapshot (its list, its cursor, its conversations), never a mix of two tabs'. It is not made again when
 *    nothing changed, after a wipe, or when another tab's wipe took the marker away.
 */

export const DEVICE_FORMAT = 1;
export const DEVICE_CONVERSATIONS = 30;
export const DEVICE_MESSAGES = 50;
export const DEVICE_CAP_BYTES = 20 * 1024 * 1024;
export const PERSIST_DEBOUNCE_MS = 1_500;
/** A copy older than this is not painted (and is emptied): nobody should find last month's messages on a device. */
export const DEVICE_MAX_AGE_MS = 30 * 86_400_000;

export { markConversationOpened, openedAtOf };

// ───────────────────────────────────────── what is stored ─────────────────────────────────────────

/** A message as the device keeps it: a tombstone has no text, and the owner-only extras are left out. */
export function storableMessage(m: MessageDto): MessageDto {
  const { history: _history, original: _original, notes: _notes, ...rest } = normalizeMessage(m);
  void [_history, _original, _notes];
  return rest;
}

interface ConvRecord extends DeviceConversation {
  v: number;
  openedAt: number;
}

export interface DeviceSnapshot {
  list: ChatListDto;
  cursor: string;
  conversations: ConvRecord[];
}

const textBytes = (s: string): number => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length * 2);

/** The conversations the cache holds that are worth keeping, newest-opened first, at most 30. */
function conversationRecords(qc: QueryClient, list: ChatListDto, deviceCurrent: boolean): ConvRecord[] {
  const found = new Map<string, { header: ConversationHeaderDto | null; data: MessagesData | null }>();
  for (const q of qc.getQueryCache().findAll({ queryKey: chatKeys.convs() })) {
    const id = convIdOfKey(q.queryKey);
    // data that is not current (from the device and not caught up, or made stale by a reset) is not written again
    if (!id || q.state.status !== "success" || q.state.isInvalidated || (q.state.dataUpdatedAt === 0 && !deviceCurrent)) continue;
    const entry = found.get(id) ?? { header: null, data: null };
    if (isHeaderKey(q.queryKey)) entry.header = (q.state.data as ConversationHeaderDto) ?? null;
    else if (isMessagesKey(q.queryKey)) entry.data = (q.state.data as MessagesData) ?? null;
    found.set(id, entry);
  }
  const rowAt = new Map<string, ChatRowDto>(list.rows.map((r) => [r.id, r]));
  const records: ConvRecord[] = [];
  for (const [id, { header, data }] of found) {
    const last = data?.pages[data.pages.length - 1];
    // a window opened around an old message does not reach the newest: its messages are not «the last 50», so only the header is kept
    const reaches = !!data && !!last && !last.hasNewer;
    const all: MessageDto[] = [];
    if (data && reaches) {
      const seen = new Set<string>();
      for (const p of data.pages) for (const m of p.messages) if (!seen.has(m.id)) (seen.add(m.id), all.push(m));
    }
    if (!header && !all.length) continue;
    const kept = all.slice(-DEVICE_MESSAGES).map(storableMessage);
    records.push({
      v: DEVICE_FORMAT,
      id,
      openedAt: openedAtOf(id),
      header,
      messages: kept,
      hasOlder: all.length > kept.length || (data?.pages[0]?.hasOlder ?? false),
      readers: reaches && last ? last.readers : [],
    });
  }
  const recency = (r: ConvRecord) => Date.parse(r.messages[r.messages.length - 1]?.createdAt ?? rowAt.get(r.id)?.lastMessage?.at ?? "") || 0;
  return records.sort((a, b) => b.openedAt - a.openedAt || recency(b) - recency(a)).slice(0, DEVICE_CONVERSATIONS);
}

/** What the device should hold now, or null when there is nothing worth writing (no list yet). */
export function buildSnapshot(qc: QueryClient, cursor: string | null, deviceCurrent = false): DeviceSnapshot | null {
  const listState = qc.getQueryState<ChatListDto>(chatKeys.list());
  if (!cursor || !listState?.data || listState.status !== "success" || listState.isInvalidated || (listState.dataUpdatedAt === 0 && !deviceCurrent)) return null;
  return { list: listState.data, cursor, conversations: conversationRecords(qc, listState.data, deviceCurrent) };
}

/** The records to write, and the 20 MB cap applied: the least recently opened conversation goes first, then the next, until it fits. */
export function serializeSnapshot(snap: DeviceSnapshot, userId: string, now: number, capBytes: number = DEVICE_CAP_BYTES): Record<string, string> {
  const fixed: Record<string, string> = {
    meta: JSON.stringify({ v: DEVICE_FORMAT, userId, savedAt: now }),
    list: JSON.stringify(snap.list),
    cursor: snap.cursor,
  };
  let total = Object.values(fixed).reduce((n, s) => n + textBytes(s), 0);
  const convs = snap.conversations.map((c) => {
    const json = JSON.stringify(c);
    return { id: c.id, json, bytes: textBytes(json), openedAt: c.openedAt };
  });
  total += convs.reduce((n, c) => n + c.bytes, 0);
  // oldest-opened first out
  const byAge = [...convs].sort((a, b) => a.openedAt - b.openedAt);
  const dropped = new Set<string>();
  for (const c of byAge) {
    if (total <= capBytes) break;
    dropped.add(c.id);
    total -= c.bytes;
  }
  const out = { ...fixed };
  for (const c of convs) if (!dropped.has(c.id)) out[`conv:${c.id}`] = c.json;
  return out;
}

// ───────────────────────────────────────── reading it back ─────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function parseJson(text: string | undefined): unknown {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validMessage(m: unknown): m is MessageDto {
  return (
    isObject(m) &&
    typeof m["id"] === "string" &&
    typeof m["createdAt"] === "string" &&
    typeof m["authorId"] === "string" &&
    typeof m["kind"] === "string" &&
    typeof m["deleted"] === "boolean" &&
    Array.isArray(m["attachments"]) &&
    Array.isArray(m["reactions"]) &&
    Array.isArray(m["mentions"])
  );
}

export interface ParsedDevice {
  list: ChatListDto;
  cursor: string;
  conversations: DeviceConversation[];
  savedAt: number;
}

/**
 * Reads the records back. `null` when the copy is not this person's, not this format, or has no list or cursor (then nothing is
 * painted); a damaged conversation record is skipped, the rest is used.
 */
export function parseDevice(records: Record<string, string>, userId: string, now: number = Date.now()): ParsedDevice | null {
  try {
    return parseRecords(records, userId, now);
  } catch {
    return null; // a copy that cannot be read is not one
  }
}

function parseRecords(records: Record<string, string>, userId: string, now: number): ParsedDevice | null {
  const meta = parseJson(records["meta"]);
  if (!isObject(meta) || meta["v"] !== DEVICE_FORMAT || meta["userId"] !== userId) return null;
  if (typeof meta["savedAt"] !== "number" || now - meta["savedAt"] > DEVICE_MAX_AGE_MS) return null;
  const list = parseJson(records["list"]);
  const cursor = records["cursor"];
  if (!isObject(list) || !Array.isArray(list["rows"]) || !list["rows"].every((r) => isObject(r) && typeof r["id"] === "string" && typeof r["kind"] === "string" && typeof r["title"] === "string")) return null;
  if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) return null;
  const conversations: DeviceConversation[] = [];
  for (const [key, text] of Object.entries(records)) {
    if (!key.startsWith("conv:")) continue;
    try {
      const c = parseJson(text);
      const id = key.slice(5);
      if (!isObject(c) || c["id"] !== id || !Array.isArray(c["messages"]) || !c["messages"].every(validMessage)) continue;
      const header = isObject(c["header"]) && c["header"]["id"] === id ? (c["header"] as unknown as ConversationHeaderDto) : null;
      conversations.push({
        id,
        header,
        messages: c["messages"].map(storableMessage),
        hasOlder: c["hasOlder"] === true,
        readers: Array.isArray(c["readers"]) ? (c["readers"] as DeviceConversation["readers"]) : [],
        openedAt: typeof c["openedAt"] === "number" && Number.isFinite(c["openedAt"]) ? c["openedAt"] : 0,
      });
    } catch {
      /* one damaged conversation costs only itself */
    }
  }
  return { list: list as unknown as ChatListDto, cursor, conversations, savedAt: meta["savedAt"] };
}

/**
 * Reads the device copy. `null` when there is nothing usable; a copy that is not this person's, or is damaged, is emptied on the way.
 * Nothing is put into the cache here: the caller decides (it must not paint a copy older than a cursor it already learned).
 */
export async function loadDevice(store: StartStore, userId: string): Promise<{ parsed: ParsedDevice; records: Record<string, string> } | null> {
  let records: Record<string, string>;
  try {
    records = await store.readAll();
  } catch {
    return null;
  }
  const parsed = parseDevice(records, userId);
  if (!parsed) {
    if (Object.keys(records).length) await store.replaceAll({}).catch(() => undefined);
    return null;
  }
  return { parsed, records };
}

// ───────────────────────────────────────── writing it ─────────────────────────────────────────

export interface PersisterDeps {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

const browserPersisterDeps: PersisterDeps = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/**
 * Watches the chat queries and writes the device copy a moment after the last change. `cursor()` is read at the moment of the
 * write, together with the data, so the two always belong together. `ready()` is false until the feed has answered once in this page.
 * Writes run one at a time, in the order they were asked for.
 */
/** A small fingerprint of a text (its length and a 32-bit FNV-1a): what the last write looked like, without keeping 20 MB of it alive. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(16)}`;
}

export class StartCachePersister {
  private timer: unknown = null;
  private stopped = false;
  private queue: Promise<void> = Promise.resolve();
  private last: string | null = null;
  private offCache: (() => void) | null = null;
  private offOpened: (() => void) | null = null;
  private offWipe: (() => void) | null = null;
  private wrote = false;
  /** the marker named this person when the writer started: its disappearance is a wipe by another tab, even before the first write */
  private markerAtStart = false;

  constructor(
    private readonly qc: QueryClient,
    private readonly store: StartStore,
    private readonly userId: string,
    private readonly source: { cursor(): string | null; ready(): boolean; deviceCurrent(): boolean },
    private readonly deps: PersisterDeps = browserPersisterDeps,
    private readonly cap: number = DEVICE_CAP_BYTES,
  ) {}

  start(): void {
    this.markerAtStart = readDeviceMarker() === this.userId;
    this.offCache = this.qc.getQueryCache().subscribe((event) => {
      if (isChatKey(event.query.queryKey) && event.type !== "observerAdded" && event.type !== "observerRemoved") this.schedule();
    });
    this.offOpened = onOpened(() => this.schedule());
    // a wipe stops this writer before it deletes anything: nothing is written back afterwards
    this.offWipe = onChatWipe(() => this.stop());
    this.schedule();
  }

  /** Changed something: write in a moment. */
  schedule(): void {
    if (this.stopped || this.timer !== null) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * The feed said «start over»: every record is stale and, when nothing on screen can write a fresh copy soon, would stay on the
   * device for as long as the page lives. The copy is emptied now; the next write (a screen that refetched) builds a new one.
   */
  dropCopy(): void {
    if (this.stopped) return;
    this.queue = this.queue
      .then(async () => {
        if (this.stopped) return;
        try {
          await this.store.replaceAll({});
          this.last = null;
        } catch {
          /* refused: the next write replaces it anyway */
        }
      })
      .catch(() => undefined);
  }

  /** Write now (tests, and the page being hidden). Resolves when this write — after every one asked for before it — is done. */
  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    this.queue = this.queue.then(() => this.write()).catch(() => undefined);
    return this.queue;
  }

  private async write(): Promise<void> {
    if (this.stopped || !this.source.ready()) return;
    // another tab wiped (sign-out, a different person): its marker is gone and so is the permission to write
    if ((this.wrote || this.markerAtStart) && deviceMarkerAvailable() && readDeviceMarker() !== this.userId) {
      this.stop();
      return;
    }
    // the data and the cursor are read in the same breath
    const snap = buildSnapshot(this.qc, this.source.cursor(), this.source.deviceCurrent());
    if (!snap) return;
    const records = serializeSnapshot(snap, this.userId, this.deps.now(), this.cap);
    // `meta` carries the time: it is not a change
    const { meta: _meta, ...content } = records;
    void _meta;
    const fingerprint = digest(Object.keys(content).sort().map((k) => k + "\u0000" + content[k]).join("\u0001"));
    if (fingerprint === this.last) return;
    if (this.stopped) return;
    try {
      await this.store.replaceAll(records);
    } catch {
      return; // refused or full: the screen works the same, the next change tries again
    }
    if (this.stopped) return;
    this.last = fingerprint;
    if (!this.wrote) writeDeviceMarker(this.userId);
    this.wrote = true;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.offCache?.();
    this.offOpened?.();
    this.offWipe?.();
    this.offCache = this.offOpened = this.offWipe = null;
  }
}
