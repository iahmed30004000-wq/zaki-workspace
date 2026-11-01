import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { featureOnSql } from "@/server/features-sql";

/**
 * Presence is in-memory per server process in Phase 3: a single Next.js instance serves
 * the whole workspace (no Redis in the stack). A user is "online" from the moment one of
 * their SSE clients connects until 30 s after the last one disconnects.
 *
 * The map lives on `globalThis`, like the hub's registry: `/api/rt` writes it and other routes
 * (sending a message decides who gets a bell) read it, and Next may load this module more
 * than once in one process. A module-level map gave each copy its own, mostly empty view.
 */
declare global {
  // eslint-disable-next-line no-var
  var __zkRtPresence: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __zkLastSeenWrites: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __zkLastSeenPending: Set<Promise<void>> | undefined;
}
const lastSeen: Map<string, number> = (globalThis.__zkRtPresence ??= new Map<string, number>());

const ONLINE_WINDOW_MS = 30_000;

/**
 * «آخر ظهور» — the moment a person was last at their screen is kept in the database (`OrganizationMember.lastSeenAt`,
 * the person's time in THAT company), so «غير متصل» can say when. The memory above stays the truth about «online now»;
 * this is only its memory for later.
 *
 * The write is THROTTLED to one per minute per person and company (`lastWrites`, in memory, on `globalThis` like the
 * map above) and costs nothing in between: a heartbeat every 25 s is one UPDATE every ~75 s. It is fire-and-forget:
 * a failing database is logged and swallowed, because presence must never fail a request. The UPDATE is conditional
 * (not older than a minute, ACTIVE member, the company's «آخر ظهور» switch on and «وضع التوفير» off: `featureOnSql`) and takes the time from the caller
 * rather than from the database clock, so tests with an injected clock and a process restart behave the same way.
 * The last stream closing writes ONCE MORE, unthrottled: «آخر ظهور» is the real end of the session, not up to a
 * minute before it.
 */
export const LAST_SEEN_WRITE_EVERY_MS = 60_000;

const lastWrites: Map<string, number> = (globalThis.__zkLastSeenWrites ??= new Map<string, number>());
const pendingWrites: Set<Promise<void>> = (globalThis.__zkLastSeenPending ??= new Set<Promise<void>>());

async function writeLastSeen(userId: string, orgId: string, at: Date, final: boolean): Promise<void> {
  try {
    const stamp = at.toISOString();
    const throttle = final
      ? Prisma.empty
      : Prisma.sql`AND (m."lastSeenAt" IS NULL OR m."lastSeenAt" < (${stamp}::timestamptz AT TIME ZONE 'UTC') - interval '60 seconds')`;
    await db.$executeRaw`
      UPDATE "OrganizationMember" m
      SET "lastSeenAt" = (${stamp}::timestamptz AT TIME ZONE 'UTC')
      FROM "Organization" o
      WHERE m."organizationId" = ${orgId}
        AND m."userId" = ${userId}
        AND m.status = 'ACTIVE'
        AND o.id = m."organizationId"
        AND ${featureOnSql("lastSeen")}
        ${throttle}`;
  } catch (err) {
    // never the person's request: the next heartbeat tries again
    log.warn("presence.last_seen_write_failed", { name: err instanceof Error ? err.name : String(err) });
  }
}

function recordLastSeen(userId: string, orgId: string, now: number, final: boolean): void {
  const key = `${orgId}:${userId}`;
  const last = lastWrites.get(key);
  if (!final && typeof last === "number" && now - last < LAST_SEEN_WRITE_EVERY_MS && now >= last) return;
  lastWrites.set(key, now);
  const pending = writeLastSeen(userId, orgId, new Date(now), final);
  pendingWrites.add(pending);
  void pending.finally(() => pendingWrites.delete(pending));
}

/**
 * A person is at their screen. `orgId` (the company the stream belongs to) also records their «آخر ظهور» there,
 * at most once a minute; without it only the in-memory presence is touched.
 */
export function touchPresence(userId: string, now: number = Date.now(), orgId?: string): void {
  lastSeen.set(userId, now);
  if (orgId) recordLastSeen(userId, orgId, now, false);
}

/** The person's last stream closed. With `orgId`, their «آخر ظهور» in that company is written once more, unthrottled. */
export function dropPresence(userId: string, orgId?: string, now: number = Date.now()): void {
  lastSeen.delete(userId);
  if (orgId) recordLastSeen(userId, orgId, now, true);
}

/** Test hook: resolves when every fire-and-forget «آخر ظهور» write started so far has finished. */
export async function settleLastSeenWrites(): Promise<void> {
  while (pendingWrites.size > 0) await Promise.all([...pendingWrites]);
}

/** Test hook: clears the in-memory map and the write throttle (never call from server code). */
export function resetPresenceForTests(): void {
  lastSeen.clear();
  lastWrites.clear();
}

export async function isOnline(userId: string): Promise<boolean> {
  const seen = lastSeen.get(userId);
  return typeof seen === "number" && Date.now() - seen <= ONLINE_WINDOW_MS;
}

export async function onlineUserIds(orgId: string): Promise<string[]> {
  const members = await db.organizationMember.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    select: { userId: true },
  });
  const now = Date.now();
  const online: string[] = [];
  for (const m of members) {
    const seen = lastSeen.get(m.userId);
    if (typeof seen === "number" && now - seen <= ONLINE_WINDOW_MS) online.push(m.userId);
  }
  return online;
}
