import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/auth";
import { featureOn } from "@/lib/features";
import { resolveTimeZone } from "@/lib/zoned-time";

/**
 * «آخر ظهور» — WHO MAY SEE WHEN SOMEBODY WAS LAST AT THEIR SCREEN (the owner, 2026-10-31: «بدي كمان احط آخر ظهور للأعضاء»).
 *
 * One reader for every surface (the people dock, the quick chat's list, the chat's picker, a private chat's header, a
 * profile): the privacy rules are decided HERE, on the server, when the answer is built — never by hiding something in
 * the screen. A surface only asks this about the people it already shows; it adds no person to any list.
 *
 * The answer for one person is one of three things, and the difference matters:
 *   - `undefined`: the field is LEFT OUT of the answer. The company's switch is off, or the viewer is an external
 *     partner (a guest is told nothing about anybody). The screen says «غير متصل» exactly as before this feature.
 *   - `null`: the field is there and says «unknown»: nothing recorded yet, hidden by its owner, the company owner hiding
 *     from everybody («إخفاء المالك من متصل»), or the viewer hides their own.
 *   - an ISO time: the real last seen.
 *
 * The matrix (viewer → person looked at):
 *   - viewer is a GUEST, not ACTIVE, or the switch is off → left out.
 *   - the person is not ACTIVE (suspended, offboarded) → null: they are nobody here any more.
 *   - the viewer looks at themself → their own real time.
 *   - the person is an OWNER and «إخفاء المالك من متصل» is on → null for everybody but themself and the company's PRIMARY
 *     owner (like the online dot for everybody else: the owner does not light up for a colleague, a co-owner included).
 *   - the viewer is an OWNER → the real time, even of somebody who chose «إخفاء آخر ظهوري» (the owner always sees all).
 *   - the viewer hides their own «آخر ظهور» → null for everybody (reciprocity, like a messenger).
 *   - the person chose «إخفاء آخر ظهوري» → null.
 *   - otherwise → the real time (null when none is recorded).
 * Reading leaves no trace: nothing is written, audited or notified.
 */

export interface LastSeenTarget {
  userId: string;
  role: OrgRole | string;
  status?: string;
  lastSeenAt: Date | null;
  hideLastSeen: boolean | null;
}

export interface LastSeenReader {
  /** the company's switch AND a viewer who may be told anything: false means every answer is "left out" */
  enabled: boolean;
  /** the company's zone, for the screen that draws «اليوم» and «أمس» */
  timeZone: string;
  /** «إخفاء المالك من متصل» is on in this company */
  ownerHidden: boolean;
  /** `undefined` (left out), `null` (unknown or hidden) or the ISO time, as described above */
  read(target: LastSeenTarget): string | null | undefined;
  /** `lastSeenAt` for a DTO: `{}` when it is left out, so the key is simply absent */
  field(target: LastSeenTarget): { lastSeenAt?: string | null };
}

const NOTHING: LastSeenReader = {
  enabled: false,
  timeZone: resolveTimeZone(undefined),
  ownerHidden: false,
  read: () => undefined,
  field: () => ({}),
};

/** The reader for one viewer in one company (two small queries; build it once per request). */
export async function lastSeenReader(orgId: string, viewerId: string): Promise<LastSeenReader> {
  const [org, viewer] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { settings: true, timezone: true } }),
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: viewerId } },
      select: { role: true, status: true, hideLastSeen: true, primaryOwner: true },
    }),
  ]);
  if (!org || !viewer) return NOTHING;
  if (!featureOn(org.settings, "lastSeen")) return NOTHING;
  // an external partner is told nothing about anybody; neither is somebody who is no longer ACTIVE here
  if (viewer.role === "GUEST" || viewer.status !== "ACTIVE") return NOTHING;

  const timeZone = resolveTimeZone(org.timezone);
  const ownerHidden = featureOn(org.settings, "ownerHiddenOnline");
  const viewerIsOwner = viewer.role === "OWNER";
  // the company's first owner reads everything, a partner who is hidden included (the owner, 2026-11-02: «بدي آخر ظهور للشباب»)
  const viewerIsPrimary = viewerIsOwner && viewer.primaryOwner === true;
  const viewerHides = viewer.hideLastSeen === true;

  const read = (t: LastSeenTarget): string | null => {
    if (t.status !== undefined && t.status !== "ACTIVE") return null;
    if (t.userId === viewerId) return t.lastSeenAt ? t.lastSeenAt.toISOString() : null;
    if (t.role === "OWNER" && ownerHidden && !viewerIsPrimary) return null;
    if (viewerIsOwner) return t.lastSeenAt ? t.lastSeenAt.toISOString() : null;
    if (viewerHides) return null;
    if (t.hideLastSeen === true) return null;
    return t.lastSeenAt ? t.lastSeenAt.toISOString() : null;
  };
  return {
    enabled: true,
    timeZone,
    ownerHidden,
    read,
    field: (t) => ({ lastSeenAt: read(t) }),
  };
}

/**
 * `PATCH /api/me/last-seen`: the caller's own «إخفاء آخر ظهوري» in the company they work in. Only the caller's own
 * membership row is touched. An external partner has no «آخر ظهور» to hide (nobody is ever shown theirs).
 */
export async function setHideLastSeen(actor: { userId: string; orgId: string; role: OrgRole }, hide: boolean): Promise<{ hide: boolean }> {
  if (actor.role === "GUEST") throw new ForbiddenError("guest.no_access");
  await db.organizationMember.updateMany({
    where: { organizationId: actor.orgId, userId: actor.userId, status: "ACTIVE" },
    data: { hideLastSeen: hide },
  });
  return { hide };
}

/** The caller's own current choice (false when never set), for the profile form. */
export async function myHideLastSeen(orgId: string, userId: string): Promise<boolean> {
  const row = await db.organizationMember.findUnique({
    // all-statuses: the caller's own stored choice, read for their own form (the route behind it needs an ACTIVE member)
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { hideLastSeen: true },
  });
  return row?.hideLastSeen === true;
}
