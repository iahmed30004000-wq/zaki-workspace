import { db } from "@/server/db";
import { env } from "@/server/env";

/**
 * C4.2 — the person's signed-in devices (`UserSession`), the one place that reads and writes them.
 *
 * This file imports NO auth code (src/server/auth.ts imports IT): it answers with values, the routes turn "no" into a 404.
 *
 *  - A session is LIVE while its row is not revoked and the cookie that names it has not expired. `currentUser()` refuses a cookie whose row is revoked
 *    or gone (the other devices keep working: nothing of the person's `tokenVersion` moves).
 *  - The row is created at sign-in and when an old cookie (one without a `sid`) is migrated; `tokenVersion` is the person's version it was issued under,
 *    so a bump (suspend, password reset, «اطلع من كل الأجهزة») leaves a row the list no longer shows.
 *  - `lastSeenAt` is written at most once every `LAST_SEEN_EVERY_MS` per session, by one conditional update: the hot path pays a write a few times an hour.
 *  - The user agent is stored trimmed (whitespace collapsed, control characters dropped, `USER_AGENT_MAX` characters). Nothing secret is stored: the cookie
 *    itself is never written to the database or to a log.
 *  - Only the person may list or end their sessions, and the OWNER may for somebody who was offboarded (a person with no active membership anywhere).
 */

/** How stale `lastSeenAt` must be before a request writes it again. */
export const LAST_SEEN_EVERY_MS = 5 * 60_000;
/** The longest user agent kept. */
export const USER_AGENT_MAX = 200;
/** The most devices one list shows (newest activity first). */
export const SESSION_LIST_MAX = 50;

/** The user agent as it is stored: trimmed, one line, no control characters, at most `USER_AGENT_MAX` long; nothing left means null. */
export function trimUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = userAgent.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, USER_AGENT_MAX).trim();
  return cleaned === "" ? null : cleaned;
}

function expiryFromNow(now: Date): Date {
  return new Date(now.getTime() + env().SESSION_TTL_HOURS * 3600_000);
}

/** A new live session for a sign-in (or the migration of an old cookie). Returns its id: the cookie carries it. */
export async function createSession(input: { userId: string; tokenVersion: number; userAgent?: string | null; now?: Date }): Promise<string> {
  const now = input.now ?? new Date();
  const row = await db.userSession.create({
    data: {
      userId: input.userId,
      tokenVersion: input.tokenVersion,
      userAgent: trimUserAgent(input.userAgent),
      lastSeenAt: now,
      expiresAt: expiryFromNow(now),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * The cookie of an existing session was re-issued (a password change, the notice accepted): the row follows the new version and the new expiry.
 * A row that was revoked in the meantime is NOT revived (the count is 0 and the caller's new cookie names a dead session, exactly as it should).
 */
export async function renewSession(sid: string, userId: string, tokenVersion: number, now = new Date()): Promise<boolean> {
  const { count } = await db.userSession.updateMany({
    where: { id: sid, userId, revokedAt: null },
    data: { tokenVersion, expiresAt: expiryFromNow(now) },
  });
  return count === 1;
}

/** What `currentUser()` needs about the session its cookie names: one primary-key read. */
export function readSession(sid: string) {
  return db.userSession.findUnique({ where: { id: sid }, select: { id: true, userId: true, revokedAt: true, lastSeenAt: true } });
}

/**
 * Records that the session was used, at most once every `LAST_SEEN_EVERY_MS`: the condition is in the UPDATE, so requests that arrive together write once
 * and a fresh session costs nothing. Never throws: failing to note a visit must not refuse the request.
 */
export async function touchSession(row: { id: string; lastSeenAt: Date }, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - LAST_SEEN_EVERY_MS);
  if (row.lastSeenAt > cutoff) return; // already written recently: no query at all
  try {
    await db.userSession.updateMany({ where: { id: row.id, revokedAt: null, lastSeenAt: { lte: cutoff } }, data: { lastSeenAt: now } });
  } catch {
    /* a missed last-seen is harmless */
  }
}

/** Signing out of ONE browser: the row named by its own (signed) cookie. Returns whether a live row was ended. */
export async function revokeOwnSession(sid: string, userId: string, now = new Date()): Promise<boolean> {
  const { count } = await db.userSession.updateMany({ where: { id: sid, userId, revokedAt: null }, data: { revokedAt: now } });
  return count === 1;
}

/** A sign-in replaced the cookie this browser held: the old session is ended (the signed cookie names it; nobody else's row can be named this way). */
export async function revokeReplacedSession(sid: string, now = new Date()): Promise<void> {
  await db.userSession.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: now } });
}

/**
 * Whether `actorId` may list and end the sessions of `targetId`: the person themselves, or an OWNER of a company the target was OFFBOARDED from
 * (and the target has no active membership anywhere: a live colleague's sessions are theirs alone).
 */
export async function mayManageSessionsOf(actorId: string, targetId: string): Promise<boolean> {
  if (actorId === targetId) return true;
  const ownerOfTheirCompany = await db.organizationMember.findFirst({
    where: {
      userId: actorId,
      role: "OWNER",
      status: "ACTIVE",
      organization: { members: { some: { userId: targetId, status: "OFFBOARDED" } } },
    },
    select: { id: true },
  });
  if (!ownerOfTheirCompany) return false;
  // all-statuses: the question is exactly whether the target is active in ANY company
  const stillActive = await db.organizationMember.findFirst({ where: { userId: targetId, status: "ACTIVE" }, select: { id: true } });
  return !stillActive;
}

export interface SessionDto {
  id: string;
  /** the device the request came from */
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  /** trimmed at write time; the screen turns it into «كروم على ويندوز» */
  userAgent: string | null;
}

/**
 * The live sessions of a person, newest activity first. The person's own list hides a row issued under an older `tokenVersion` (it is already dead);
 * the owner's list for an offboarded person shows what was never ended (`includeStale`).
 */
export async function listSessions(userId: string, opts: { currentSid: string | null; tokenVersion: number; includeStale?: boolean; now?: Date }): Promise<SessionDto[]> {
  const now = opts.now ?? new Date();
  const rows = await db.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now }, ...(opts.includeStale ? {} : { tokenVersion: opts.tokenVersion }) },
    orderBy: { lastSeenAt: "desc" },
    take: SESSION_LIST_MAX,
    select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true },
  });
  return rows.map((r) => ({
    id: r.id,
    current: r.id === opts.currentSid,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    userAgent: r.userAgent,
  }));
}

/**
 * Ends ONE session of someone the actor may manage. The row's owner is read from the row itself, never from the request: an id that is not the actor's
 * (and not an offboarded person's, for an owner) answers "not found", the same as an id that does not exist. Returns the owner's id, or null.
 */
export async function revokeSessionFor(actorId: string, sessionId: string, now = new Date()): Promise<{ userId: string; wasLive: boolean } | null> {
  const row = await db.userSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
  if (!row) return null;
  if (!(await mayManageSessionsOf(actorId, row.userId))) return null;
  const { count } = await db.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
  return { userId: row.userId, wasLive: count === 1 };
}
