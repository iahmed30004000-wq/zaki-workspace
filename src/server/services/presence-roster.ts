import { db } from "@/server/db";
import { onlineUserIds } from "@/server/realtime/presence";
import { spacePeopleWhere, verifiedShownTo } from "@/server/chat/space-people";
import { lastSeenReader } from "@/server/services/last-seen";

/**
 * THE PEOPLE DOCK — who works here and who is at their screen right now (the owner's ask,
 * 2026-10-29: «المستخدمين ظاهرين على زاوية الموقع تحت وكل واحد جنبه علامة خضراء أونلاين»).
 *
 * The roster is the staff directory: the ACTIVE people of the company who are not GUESTS (an
 * external partner is nobody's colleague, and never appears in a list of the team). The viewer is
 * on it too, and always counted as online — they are looking at this very screen.
 *
 * «Online» is the existing presence of `src/server/realtime/presence.ts` (an open realtime stream,
 * or 30 s after the last one): one source of truth, so the dock and the chat's member pills never
 * disagree. It is in-memory and per process, so the answer is only as good as this server — that is
 * the same caveat the chat has carried since Phase 3.
 */
export interface PresencePerson {
  userId: string;
  name: string;
  jobTitle: string | null;
  role: string;
  online: boolean;
  /** `/api/avatars/<id>`, or null. */
  avatarUrl?: string | null;
  /**
   * «آخر ظهور» (src/server/services/last-seen.ts): an ISO time, or null (unknown or hidden). ABSENT when the company's switch
   * is off or the viewer may not be told (a guest), so an older client and the old «غير متصل» are untouched.
   */
  lastSeenAt?: string | null;
  /** «إشارة التوثيق» (S5.5): `true` only for a verified colleague, while the switch is on and the viewer is not a guest; ABSENT otherwise. */
  verified?: boolean;
}

export interface PresenceRoster {
  /** the person asking: the screen draws their own row as a link to their profile */
  meId: string;
  people: PresencePerson[];
  onlineCount: number;
  /** everybody on the roster, online or not */
  total: number;
  /** the company's zone, so the screen says «اليوم» and «أمس» in the company's days; present only with «آخر ظهور» */
  timeZone?: string;
}

export interface RosterOptions {
  /** the space the viewer is in: the roster is ITS people (a space is like a separate site) */
  spaceId?: string | null;
  /** the whole company: only the OWNER may ask for it (the route decides) */
  everyone?: boolean;
  /** «إخفاء المالك من متصل»: the owner shows as not at his screen to everybody but himself */
  hideOwner?: boolean;
}

export async function presenceRoster(orgId: string, viewerId: string, opts: RosterOptions = {}): Promise<PresenceRoster> {
  const scoped = !opts.everyone && opts.spaceId ? spacePeopleWhere(orgId, opts.spaceId) : null;
  const rows = await db.organizationMember.findMany({
    where: {
      ...(scoped ? { AND: [scoped] } : {}),
      organizationId: orgId,
      role: { not: "GUEST" },
      status: "ACTIVE",
    },
    select: {
      userId: true,
      role: true,
      status: true,
      lastSeenAt: true,
      hideLastSeen: true,
      verifiedAt: true,
      user: { select: { id: true, name: true, jobTitle: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const online = new Set(await onlineUserIds(orgId));
  const seen = await lastSeenReader(orgId, viewerId);
  const badges = await verifiedShownTo(orgId, { userId: viewerId });
  const people = rows
    .map((r) => ({
      userId: r.userId,
      name: r.user.name,
      jobTitle: r.user.jobTitle,
      role: r.role,
      avatarUrl: r.user.avatarUrl,
      ...seen.field(r),
      ...(badges && r.verifiedAt ? { verified: true as const } : {}),
      // the viewer is looking at this very screen: they are at their screen, whatever the stream says
      online: r.userId === viewerId || (online.has(r.userId) && !(opts.hideOwner && r.role === "OWNER")),
    }))
    // whoever is at their screen first, then by name: the list is read top-down on a phone
    .sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name, "ar") : a.online ? -1 : 1));
  return {
    meId: viewerId,
    people,
    onlineCount: people.filter((p) => p.online).length,
    total: people.length,
    ...(seen.enabled ? { timeZone: seen.timeZone } : {}),
  };
}
