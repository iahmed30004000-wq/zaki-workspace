import type { RealtimeIds, RealtimeKind } from "./emit";
import { canReadConversation } from "./policy-gate";
import { dropPresence, touchPresence } from "./presence";

/**
 * The fan-out registry of connected SSE clients and the in-memory typing state.
 *
 * Every payload to a client carries IDS ONLY, never message content: the client
 * refetches through the normal APIs, where authorization applies again.
 */

export interface RtEvent {
  id: string;
  orgId: string;
  kind: RealtimeKind | "typing" | "reload";
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
  /** Serial number, for "close the OLDEST stream" decisions. */
  cid: number;
}

interface RegistryEntry {
  client: RtClient;
  /** Per-client visibility cache: conversationId -> allowed (30 s TTL). */
  cache: Map<string, { ok: boolean; at: number }>;
  /** Is the tab looking at the app (`document.visibilityState`)? It says so itself; a new stream is taken as visible until it says otherwise. */
  viewing: boolean;
  /** When the tab last said it was visible, or the heartbeat last found it so: a stuck «visible» goes stale after 60 s (F0.5). */
  viewingAt: number;
}

const VISIBILITY_CACHE_MS = 30_000;
export { VISIBILITY_CACHE_MS };
export const MAX_STREAMS_PER_USER = 5;
export const TYPING_TTL_MS = 6_000;
/** Postgres advisory lock key for the hourly purge job (any constant bigint). */
export const PURGE_LOCK_KEY = 742271;

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
}

declare global {
  // eslint-disable-next-line no-var
  var __zkRtHub: HubState | undefined;
}

function hub(): HubState {
  if (!globalThis.__zkRtHub) {
    globalThis.__zkRtHub = { registry: [], nextCid: 1, typingUntil: new Map(), typingLastSent: new Map() };
  }
  return globalThis.__zkRtHub;
}

/** Test hook: clears the registry and typing state (never call from server code). */
export function resetHubForTests(): void {
  hub().registry = [];
  hub().typingUntil.clear();
  hub().typingLastSent.clear();
}

export function clientCount(): number {
  return hub().registry.length;
}

export function clientsOfOrg(orgId: string): RtClient[] {
  return hub().registry.filter((r) => r.client.orgId === orgId).map((r) => r.client);
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
  hub().registry.push({ client: full, cache: new Map(), viewing: true, viewingAt: Date.now() });
  touchPresence(client.userId, undefined, client.orgId);
  return full;
}

/**
 * A tab says whether it is being looked at (F0.5). With a `tabId` only that tab's streams change; without one (an old page),
 * all of the person's. Memory only — nothing is written anywhere.
 */
export function setStreamViewing(userId: string, viewing: boolean, tabId?: string, now: number = Date.now()): void {
  const mine = hub().registry.filter((r) => r.client.userId === userId);
  const target = tabId && mine.some((r) => r.client.tabId === tabId) ? mine.filter((r) => r.client.tabId === tabId) : mine;
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
  hub().registry = hub().registry.filter((r) => r.client !== client && r.client.cid !== client.cid);
  if (!hub().registry.some((r) => r.client.userId === client.userId)) dropPresence(client.userId, client.orgId);
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

export function frameOf(event: RtEvent, extra: Record<string, unknown> = {}): string {
  const payload: Record<string, unknown> = { kind: event.kind };
  for (const key of ["conversationId", "messageId", "spaceId", "userId", "callId"] as const) {
    const v = event.ids[key];
    if (v !== undefined) payload[key] = v;
  }
  Object.assign(payload, extra);
  return `id: ${event.id}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function invalidateCache(event: RtEvent): void {
  if (event.kind === "membership.changed") {
    for (const r of hub().registry) r.cache.clear();
  } else if (event.kind === "conversation.changed" && event.ids.conversationId) {
    const cv = event.ids.conversationId;
    for (const r of hub().registry) r.cache.delete(cv);
  }
}

async function maySee(entry: RegistryEntry, event: RtEvent): Promise<boolean> {
  // Events without a conversation go by target user, or to the whole org.
  if (!event.ids.conversationId) return true;
  const cv = event.ids.conversationId;
  const cached = entry.cache.get(cv);
  const now = Date.now();
  if (cached && now - cached.at < VISIBILITY_CACHE_MS) return cached.ok;
  let ok: boolean;
  try {
    ok = await canReadConversation(entry.client.userId, cv);
  } catch {
    // The policy module is unavailable (mid-wave) or the DB hiccupped: never leak.
    ok = false;
  }
  entry.cache.set(cv, { ok, at: now });
  return ok;
}

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
  const delivered = new Set<string>();
  const isDm = event.kind === "message.created" && !!event.ids.conversationId && (await isDmConversation(event.ids.conversationId));
  for (const entry of targets) {
    if (event.ids.conversationId && !(await maySee(entry, event))) continue;
    try {
      entry.client.send(frameOf(event));
    } catch {
      removeClient(entry.client);
      continue;
    }
    // DM delivery ticks: a connected recipient who may see the DM counts its message as delivered
    // at once (once per person, however many tabs; the author's own mark never moves for it)
    if (isDm && !delivered.has(entry.client.userId)) {
      delivered.add(entry.client.userId);
      try {
        const { markDeliveredForUser } = await import("@/server/chat/read-state");
        await markDeliveredForUser(entry.client.userId, event.ids.conversationId);
      } catch {
        // delivery ticks are best-effort; the next connect marks them
      }
    }
  }
}

async function isDmConversation(conversationId: string): Promise<boolean> {
  try {
    const { db } = await import("@/server/db");
    const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { kind: true } });
    return conv?.kind === "DM";
  } catch {
    return false;
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
  for (const entry of targets) {
    if (!(await maySee(entry, event))) continue;
    try {
      entry.client.send(frameOf(event, { name }));
      sent++;
    } catch {
      removeClient(entry.client);
    }
  }
  setTyping(conversationId, userId, name);
  return sent;
}

/**
 * Filters replay rows down to what this person may see, used by GET /api/rt for
 * Last-Event-ID replay: conversation events by canReadConversation, targetUserId events
 * only for that user, everything else by organization membership (the route only
 * serves the person's own org). The same rules as live delivery (deliverEvent).
 */
export async function filterVisible(
  userId: string,
  rows: { id: string; kind: string; ids: RealtimeIds }[],
): Promise<{ id: string; kind: string; ids: RealtimeIds }[]> {
  const out: { id: string; kind: string; ids: RealtimeIds }[] = [];
  const cache = new Map<string, boolean>();
  for (const row of rows) {
    if (row.ids.targetUserId && row.ids.targetUserId !== userId) continue;
    if (row.ids.conversationId) {
      const cv = row.ids.conversationId;
      let ok = cache.get(cv);
      if (ok === undefined) {
        try {
          ok = await canReadConversation(userId, cv);
        } catch {
          ok = false;
        }
        cache.set(cv, ok);
      }
      if (!ok) continue;
    }
    out.push(row);
  }
  return out;
}
