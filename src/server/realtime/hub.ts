import type { RealtimeIds, RealtimeKind } from "./emit";
import { readersOf } from "./policy-gate";
import { dropPresence, touchPresence } from "./presence";

/**
 * The fan-out registry of connected SSE clients and the in-memory typing state.
 *
 * Every payload to a client carries IDS ONLY, never message content: the client
 * refetches through the normal APIs, where authorization applies again.
 *
 * C1.3 — the fan-out of one event is: one list of the connected people of its company, ONE question about who of them may
 * read the conversation (`readersOf`, remembered per person for 30 s), then plain writes to every stream. Nothing is asked per
 * stream, and the delivered ticks of a DM are written later, once per person per second, never inside the loop.
 */

export interface RtEvent {
  id: string;
  orgId: string;
  /** `typing` and `presence.changed` are STREAM-ONLY: never a stored row, never replayed (and not in REALTIME_KINDS). */
  kind: RealtimeKind | "typing" | "reload" | "presence.changed";
  ids: RealtimeIds;
}

export interface RtClient {
  userId: string;
  orgId: string;
  /** Write one SSE frame ("data: {...}\n\n") to this client's stream. */
  send: (frame: string) => void;
  /** Close the stream (the route's abort handler does the rest). */
  close: () => void;
  /** The browser tab that opened the stream (a random id it sends with the stream and with its visibility reports). */
  tabId?: string;
  /** The person's rank in the company: only an OWNER's presence can be hidden (`ownerHiddenOnline`). */
  role?: string;
  /** The person may see the people dock (not a guest, holds `directory.view`): only they are nudged by `presence.changed`. */
  seesPresence?: boolean;
  /** Serial number, for "close the OLDEST stream" decisions. */
  cid: number;
}

interface RegistryEntry {
  client: RtClient;
  /** Is the tab looking at the app (`document.visibilityState`)? It says so itself; a new stream is taken as visible until it says otherwise. */
  viewing: boolean;
  /** When the tab last said it was visible, or the heartbeat last found it so: a stuck «visible» goes stale after 60 s (F0.5). */
  viewingAt: number;
}

const VISIBILITY_CACHE_MS = 30_000;
export { VISIBILITY_CACHE_MS };
export const MAX_STREAMS_PER_USER = 5;
export const TYPING_TTL_MS = 6_000;
/** The delivered ticks of a DM are written once per person per this long (the first message opens the window). */
export const DELIVERED_DEBOUNCE_MS = 1_000;
/** A person whose last stream closes is «gone» only after this long: a reload or a hand-over between tabs reopens one at once. */
export const PRESENCE_GRACE_MS = 4_000;
/** Postgres advisory lock key for the hourly purge job (any constant bigint). */
export const PURGE_LOCK_KEY = 742271;

/** What is remembered about a person's right to read a conversation. */
type Verdict = { ok: boolean; at: number };

/**
 * The hub's state lives on `globalThis`, like the LISTEN client (listener.ts). Next loads this module
 * more than once in one process: the listener is started from `instrumentation.ts` and the streams
 * register through `/api/rt`, each with its own copy of the module. With module-level state the
 * listener handed every event to its own, EMPTY registry, and nothing ever reached a browser.
 */
interface HubState {
  registry: RegistryEntry[];
  nextCid: number;
  typingUntil: Map<string, { userId: string; name: string; until: number }>;
  typingLastSent: Map<string, number>;
  /** company -> conversation -> person -> may they read it (30 s). Cleared per company by `membership.changed`. */
  readable: Map<string, Map<string, Map<string, Verdict>>>;
  /** questions in flight, so two events of one conversation at the same moment share one lookup. Key: `org|conversation|person`. */
  inflight: Map<string, Promise<boolean>>;
  /** bumped whenever a company's answers are forgotten: an answer that was asked BEFORE is not remembered AFTER. */
  generation: Map<string, number>;
  /** a conversation's kind never changes: remembered, so a DM is recognised without a read per message. */
  kinds: Map<string, { kind: string; at: number }>;
  /** DMs that reached a person while they were connected, waiting for the delivered ticks (`DELIVERED_DEBOUNCE_MS`). */
  delivered: Map<string, { conversations: Set<string>; timer: ReturnType<typeof setTimeout> }>;
  /** a person's last stream closed: the nudge «gone» waits for the grace and is cancelled if a stream opens meanwhile. */
  presenceGone: Map<string, ReturnType<typeof setTimeout>>;
}

declare global {
  // eslint-disable-next-line no-var
  var __zkRtHub: HubState | undefined;
}

function hub(): HubState {
  const existing = globalThis.__zkRtHub;
  if (existing) {
    // a process that was started before this shape grew (hot reload): fill what is missing
    existing.readable ??= new Map();
    existing.inflight ??= new Map();
    existing.generation ??= new Map();
    existing.kinds ??= new Map();
    existing.delivered ??= new Map();
    existing.presenceGone ??= new Map();
    return existing;
  }
  globalThis.__zkRtHub = {
    registry: [],
    nextCid: 1,
    typingUntil: new Map(),
    typingLastSent: new Map(),
    readable: new Map(),
    inflight: new Map(),
    generation: new Map(),
    kinds: new Map(),
    delivered: new Map(),
    presenceGone: new Map(),
  };
  return globalThis.__zkRtHub;
}

/** Test hook: clears the registry and typing state (never call from server code). */
export function resetHubForTests(): void {
  const s = hub();
  s.registry = [];
  s.typingUntil.clear();
  s.typingLastSent.clear();
  s.readable.clear();
  s.inflight.clear();
  s.generation.clear();
  s.kinds.clear();
  for (const d of s.delivered.values()) clearTimeout(d.timer);
  s.delivered.clear();
  for (const t of s.presenceGone.values()) clearTimeout(t);
  s.presenceGone.clear();
}

export function clientCount(): number {
  return hub().registry.length;
}

export function clientsOfOrg(orgId: string): RtClient[] {
  return hub()
    .registry.filter((r) => r.client.orgId === orgId)
    .map((r) => r.client);
}

export function addClient(client: Omit<RtClient, "cid">): RtClient {
  const full: RtClient = { ...client, cid: hub().nextCid++ };
  // A user holds at most MAX_STREAMS_PER_USER streams; a newer connection closes the oldest.
  const mine = hub().registry.filter((r) => r.client.userId === client.userId);
  if (mine.length >= MAX_STREAMS_PER_USER) {
    const oldest = mine.reduce((a, b) => (a.client.cid <= b.client.cid ? a : b));
    removeClient(oldest.client);
    try {
      oldest.client.close();
    } catch {
      // already gone
    }
  }
  const first = !hub().registry.some((r) => r.client.userId === client.userId);
  hub().registry.push({ client: full, viewing: true, viewingAt: Date.now() });
  touchPresence(client.userId, undefined, client.orgId);
  if (first) presenceCameBack(full);
  return full;
}

/**
 * A tab says whether it is being looked at (F0.5). With a `tabId` only that tab's streams change; without one (an old page),
 * all of the person's. Memory only — nothing is written anywhere.
 *
 * With one stream per browser (C1.3) the tab id is the LEADER tab's, and the visibility it reports is the OR of every tab of that
 * browser (the leader collects it over the channel): a hidden leader with a visible follower says «visible».
 */
export function setStreamViewing(userId: string, viewing: boolean, tabId?: string, now: number = Date.now()): void {
  const mine = hub().registry.filter((r) => r.client.userId === userId);
  // a tab that names itself changes ITS streams only: an evicted or paused tab (no stream) must not change another tab's state
  const target = tabId ? mine.filter((r) => r.client.tabId === tabId) : mine;
  for (const r of target) {
    r.viewing = viewing;
    if (viewing) r.viewingAt = now;
  }
}

/** The heartbeat of an open stream: a tab that is still visible stays fresh for the push check. */
export function refreshStreamViewing(client: RtClient, now: number = Date.now()): void {
  const entry = hub().registry.find((r) => r.client.cid === client.cid);
  if (entry?.viewing) entry.viewingAt = now;
}

/** The person's streams as the push check needs them (read-only). */
export function streamsViewingOf(userId: string): { viewing: boolean; viewingAt: number }[] {
  return hub()
    .registry.filter((r) => r.client.userId === userId)
    .map((r) => ({ viewing: r.viewing, viewingAt: r.viewingAt }));
}

export function removeClient(client: RtClient): void {
  const before = hub().registry.length;
  hub().registry = hub().registry.filter((r) => r.client !== client && r.client.cid !== client.cid);
  if (hub().registry.length === before) return; // already removed: nothing more to say
  if (!hub().registry.some((r) => r.client.userId === client.userId)) {
    dropPresence(client.userId, client.orgId);
    presenceWentAway(client);
  }
}

/** The per-user throttle of POST /api/rt/typing: one emission per 2 s per user+conversation. */
export function allowTyping(key: string, now: number = Date.now()): boolean {
  const last = hub().typingLastSent.get(key);
  if (typeof last === "number" && now - last < 2000) return false;
  hub().typingLastSent.set(key, now);
  return true;
}

/** Records an in-memory typing state (6 s expiry); never stored anywhere. */
export function setTyping(conversationId: string, userId: string, name: string, now: number = Date.now()): void {
  hub().typingUntil.set(`${conversationId}|${userId}`, { userId, name, until: now + TYPING_TTL_MS });
}

export function typingIn(conversationId: string, now: number = Date.now()): { userId: string; name: string }[] {
  const out: { userId: string; name: string }[] = [];
  for (const [key, v] of hub().typingUntil) {
    if (v.until <= now) {
      hub().typingUntil.delete(key);
      continue;
    }
    if (key.startsWith(`${conversationId}|`)) out.push({ userId: v.userId, name: v.name });
  }
  return out;
}

/**
 * One SSE frame. A real event carries its id (`id:` moves the client's resume point); a stream-only one (typing, presence) has none:
 * an empty `id:` line would reset the resume point, and a frame that is never replayed must not move it.
 */
export function frameOf(event: RtEvent, extra: Record<string, unknown> = {}): string {
  const payload: Record<string, unknown> = { kind: event.kind };
  for (const key of ["conversationId", "messageId", "spaceId", "userId", "callId"] as const) {
    const v = event.ids[key];
    if (v !== undefined) payload[key] = v;
  }
  Object.assign(payload, extra);
  return `${event.id ? `id: ${event.id}\n` : ""}data: ${JSON.stringify(payload)}\n\n`;
}

// ───────────────────────────── who may read what: remembered per person ─────────────────────────────

function bump(orgId: string): void {
  const s = hub();
  s.generation.set(orgId, (s.generation.get(orgId) ?? 0) + 1);
}

function forgetOrg(orgId: string): void {
  const s = hub();
  bump(orgId);
  s.readable.delete(orgId);
  for (const key of s.inflight.keys()) if (key.startsWith(`${orgId}|`)) s.inflight.delete(key);
}

function forgetConversation(orgId: string, conversationId: string): void {
  const s = hub();
  bump(orgId);
  s.readable.get(orgId)?.delete(conversationId);
  for (const key of s.inflight.keys()) if (key.startsWith(`${orgId}|${conversationId}|`)) s.inflight.delete(key);
}

/** `membership.changed` forgets the answers of THAT company only; `conversation.changed` forgets that one conversation. */
function invalidateCache(event: RtEvent): void {
  if (event.kind === "membership.changed") forgetOrg(event.orgId);
  else if (event.kind === "conversation.changed" && event.ids.conversationId) forgetConversation(event.orgId, event.ids.conversationId);
}

const READABLE_SWEEP_AT = 2000;

function remember(orgId: string, conversationId: string, userId: string, ok: boolean, now: number): void {
  const s = hub();
  let org = s.readable.get(orgId);
  if (!org) s.readable.set(orgId, (org = new Map()));
  if (org.size > READABLE_SWEEP_AT) {
    for (const [cv, people] of org) {
      for (const [uid, v] of people) if (now - v.at >= VISIBILITY_CACHE_MS) people.delete(uid);
      if (people.size === 0) org.delete(cv);
    }
  }
  let people = org.get(conversationId);
  if (!people) org.set(conversationId, (people = new Map()));
  people.set(userId, { ok, at: now });
}

function rememberKind(conversationId: string, kind: string, now: number): void {
  const kinds = hub().kinds;
  if (kinds.size > 5000) kinds.clear();
  kinds.set(conversationId, { kind, at: now });
}

/**
 * Of these people, who may read the conversation? Remembered answers are used as they are; everybody else is asked about in ONE
 * `readersOf` (people already being asked about by another event are waited for, not asked twice). A lookup that fails answers «no»
 * for everybody and is not remembered — never a leak, and the next event asks again.
 */
async function readableBy(orgId: string, conversationId: string, userIds: string[]): Promise<Map<string, boolean>> {
  const s = hub();
  const now = Date.now();
  const out = new Map<string, boolean>();
  const waiting: Promise<void>[] = [];
  const fresh: string[] = [];
  const cached = s.readable.get(orgId)?.get(conversationId);
  for (const userId of userIds) {
    const v = cached?.get(userId);
    if (v && now - v.at < VISIBILITY_CACHE_MS) {
      out.set(userId, v.ok);
      continue;
    }
    const pending = s.inflight.get(`${orgId}|${conversationId}|${userId}`);
    if (pending) waiting.push(pending.then((ok) => void out.set(userId, ok)));
    else fresh.push(userId);
  }
  if (fresh.length > 0) {
    const generation = s.generation.get(orgId) ?? 0;
    const batch = (async () => {
      try {
        const res = await readersOf(conversationId, fresh);
        if (res.kind) rememberKind(conversationId, res.kind, Date.now());
        return res.readers;
      } catch {
        // The policy module is unavailable (mid-wave) or the DB hiccupped: never leak.
        return null;
      }
    })();
    for (const userId of fresh) {
      const key = `${orgId}|${conversationId}|${userId}`;
      const answer: Promise<boolean> = batch.then((readers) => {
        if (s.inflight.get(key) === answer) s.inflight.delete(key);
        if (!readers) return false;
        const ok = readers.has(userId);
        // only if nobody forgot this company's answers while we were asking: that answer may already be stale
        if ((s.generation.get(orgId) ?? 0) === generation) remember(orgId, conversationId, userId, ok, Date.now());
        return ok;
      });
      s.inflight.set(key, answer);
      waiting.push(answer.then((ok) => void out.set(userId, ok)));
    }
  }
  await Promise.all(waiting);
  return out;
}

async function isDmConversation(conversationId: string): Promise<boolean> {
  const known = hub().kinds.get(conversationId);
  if (known && Date.now() - known.at < 10 * VISIBILITY_CACHE_MS) return known.kind === "DM";
  try {
    const { db } = await import("@/server/db");
    const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { kind: true } });
    if (conv?.kind) rememberKind(conversationId, conv.kind, Date.now());
    return conv?.kind === "DM";
  } catch {
    return false;
  }
}

// ───────────────────────────── the delivered ticks of a DM, batched ─────────────────────────────

/** One import shared by every flush that runs at once (two timers firing in the same tick must not import the module twice). */
let readStateModule: Promise<typeof import("@/server/chat/read-state")> | null = null;
function loadReadState(): Promise<typeof import("@/server/chat/read-state")> {
  readStateModule ??= import("@/server/chat/read-state").catch((err) => {
    readStateModule = null;
    throw err;
  });
  return readStateModule;
}

/** A connected person who may read a DM counts its message as delivered — written once per person per second, not inside the fan-out. */
function queueDelivered(userId: string, conversationId: string): void {
  const s = hub();
  let entry = s.delivered.get(userId);
  if (!entry) {
    const timer = setTimeout(() => void flushDelivered(userId), DELIVERED_DEBOUNCE_MS);
    timer.unref?.();
    entry = { conversations: new Set(), timer };
    s.delivered.set(userId, entry);
  }
  entry.conversations.add(conversationId);
}

async function flushDelivered(userId: string): Promise<void> {
  const s = hub();
  const entry = s.delivered.get(userId);
  if (!entry) return;
  clearTimeout(entry.timer);
  s.delivered.delete(userId);
  try {
    const { markDeliveredForUser } = await loadReadState();
    for (const conversationId of entry.conversations) {
      try {
        await markDeliveredForUser(userId, conversationId);
      } catch {
        // delivery ticks are best-effort; the next connect marks them
      }
    }
  } catch {
    // the module is unavailable: the next connect marks them
  }
}

/** Test hook: write every waiting delivered tick now (never call from server code). */
export async function flushDeliveredForTests(): Promise<void> {
  await Promise.all([...hub().delivered.keys()].map((userId) => flushDelivered(userId)));
}

// ───────────────────────────── presence.changed: a stream-only nudge ─────────────────────────────

/**
 * Tells the people who may see the people dock that somebody came or went. The frame carries NO id and NO person: the page asks
 * `/api/presence` again, where the roster's own rules apply (the space, the guests, the owner who hides himself). It has no `id:`
 * line: it is never stored, never replayed and never moves a client's resume point.
 */
async function announcePresence(client: RtClient): Promise<void> {
  if (client.role === "GUEST") return; // an external partner is on no roster: nothing to refresh
  if (client.role === "OWNER") {
    // «إخفاء المالك من متصل»: an owner who hides himself must not be given away by the timing of a nudge either
    let hidden = true;
    try {
      const { isFeatureOn } = await import("@/server/services/features");
      hidden = await isFeatureOn(client.orgId, "ownerHiddenOnline");
    } catch {
      hidden = true;
    }
    if (hidden) return;
  }
  const frame = `data: ${JSON.stringify({ kind: "presence.changed" })}\n\n`;
  for (const entry of [...hub().registry]) {
    const c = entry.client;
    if (c.orgId !== client.orgId || c.userId === client.userId || !c.seesPresence) continue;
    try {
      c.send(frame);
    } catch {
      removeClient(c);
    }
  }
}

/** The person's first stream opened: nudge, unless they only reopened inside the grace (then nobody saw them go). */
function presenceCameBack(client: RtClient): void {
  const s = hub();
  const gone = s.presenceGone.get(client.userId);
  if (gone) {
    clearTimeout(gone);
    s.presenceGone.delete(client.userId);
    return;
  }
  void announcePresence(client);
}

/** The person's last stream closed: nudge after the grace, if they are still away. */
function presenceWentAway(client: RtClient): void {
  const s = hub();
  if (s.presenceGone.has(client.userId)) return;
  const timer = setTimeout(() => {
    s.presenceGone.delete(client.userId);
    if (hub().registry.some((r) => r.client.userId === client.userId)) return;
    void announcePresence(client);
  }, PRESENCE_GRACE_MS);
  timer.unref?.();
  s.presenceGone.set(client.userId, timer);
}

// ───────────────────────────── the fan-out ─────────────────────────────

/**
 * Fans one loaded event out to the connected clients of its organization.
 * Resolves after every eligible send has been attempted (send itself is sync).
 */
export async function deliverEvent(event: RtEvent): Promise<void> {
  invalidateCache(event);
  // `userId` says who the event is ABOUT (the reader of `conversation.read`, the person who joined):
  // it goes to everybody allowed to see the conversation, so the OTHER side's ticks and reader
  // avatars move live. Only `targetUserId` narrows an event to one person.
  const target = event.ids.targetUserId;
  const targets = hub().registry.filter((r) => r.client.orgId === event.orgId && (target === undefined || target === r.client.userId));
  if (targets.length === 0) return;
  const conversationId = event.ids.conversationId;
  let may: (userId: string) => boolean = () => true;
  if (conversationId) {
    const verdicts = await readableBy(event.orgId, conversationId, [...new Set(targets.map((r) => r.client.userId))]);
    may = (userId) => verdicts.get(userId) === true;
  }
  // `conversation.read` also tells the reader's OWN other tabs and devices that it was them (their badge follows)
  const selfAware = event.kind === "conversation.read" && event.ids.userId !== undefined;
  const plain = frameOf(event);
  const mine = selfAware ? frameOf(event, { self: true }) : plain;
  const reached = new Set<string>();
  for (const entry of targets) {
    const c = entry.client;
    if (!may(c.userId)) continue;
    try {
      c.send(selfAware && c.userId === event.ids.userId ? mine : plain);
      reached.add(c.userId);
    } catch {
      removeClient(c);
    }
  }
  // DM delivery ticks: a connected recipient who may see the DM counts its message as delivered (once per person, however many
  // tabs; the author's own mark never moves for it) — queued, and written after the fan-out, never inside it
  if (event.kind === "message.created" && conversationId && reached.size > 0 && (await isDmConversation(conversationId))) {
    for (const userId of reached) queueDelivered(userId, conversationId);
  }
}

/**
 * Broadcasts a typing event to the OTHER viewers of the conversation who may read
 * it (never to the sender). Never stored; the owner in oversight cannot emit it
 * (the route refuses for a non-joined owner before calling this).
 */
export async function broadcastTyping(
  orgId: string,
  conversationId: string,
  userId: string,
  name: string,
): Promise<number> {
  const event: RtEvent = { id: "", orgId, kind: "typing", ids: { conversationId, userId } };
  let sent = 0;
  const targets = hub().registry.filter((r) => r.client.orgId === orgId && r.client.userId !== userId);
  if (targets.length > 0) {
    const verdicts = await readableBy(orgId, conversationId, [...new Set(targets.map((r) => r.client.userId))]);
    const frame = frameOf(event, { name });
    for (const entry of targets) {
      if (verdicts.get(entry.client.userId) !== true) continue;
      try {
        entry.client.send(frame);
        sent++;
      } catch {
        removeClient(entry.client);
      }
    }
  }
  setTyping(conversationId, userId, name);
  return sent;
}

/**
 * Filters replay rows down to what this person may see, used by GET /api/rt for
 * Last-Event-ID replay: conversation events by the policy, targetUserId events
 * only for that user, everything else by organization membership (the route only
 * serves the person's own org). The same rules as live delivery (deliverEvent).
 * One question per conversation, never one per row.
 */
export async function filterVisible(
  userId: string,
  rows: { id: string; kind: string; ids: RealtimeIds }[],
): Promise<{ id: string; kind: string; ids: RealtimeIds }[]> {
  const mine = rows.filter((row) => !(row.ids.targetUserId && row.ids.targetUserId !== userId));
  const conversations = [...new Set(mine.map((r) => r.ids.conversationId).filter((cv): cv is string => !!cv))];
  const verdict = new Map<string, boolean>();
  // a few at a time: a long replay may name many conversations, each a handful of reads
  for (let i = 0; i < conversations.length; i += 8) {
    await Promise.all(
      conversations.slice(i, i + 8).map(async (cv) => {
        try {
          verdict.set(cv, (await readersOf(cv, [userId])).readers.has(userId));
        } catch {
          verdict.set(cv, false);
        }
      }),
    );
  }
  return mine.filter((row) => !row.ids.conversationId || verdict.get(row.ids.conversationId) === true);
}
