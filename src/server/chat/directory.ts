import { db } from "@/server/db";
import { onlineUserIds } from "@/server/realtime/presence";
import type { DirectoryPersonDto } from "@/server/chat/dto";
import { spacePeopleWhere, verifiedShownTo } from "@/server/chat/space-people";
import { isFeatureOn } from "@/server/services/features";
import { lastSeenReader, type LastSeenReader } from "@/server/services/last-seen";
import { RANK } from "@/server/policy/rank";
import type { DirectoryPerson } from "@/components/members/staff-directory";

/**
 * The people picker: ACTIVE non-guests of the company, the viewer excluded. It is the staff
 * directory, so its route keeps the `directory.view` capability and a guest is refused with
 * `chat.guest_forbidden` — a guest has no DMs and no new groups.
 *
 * Inside a space (`spaceId`, the space the person is in) only that space's people: you write privately to the
 * colleagues you share the space with, like the contacts of one account.
 */
export async function chatDirectory(orgId: string, spaceId?: string | null, viewerId?: string | LastSeenReader, viewerRole?: string): Promise<DirectoryPersonDto[]> {
  const rows = await db.organizationMember.findMany({
    where: {
      organizationId: orgId,
      role: { not: "GUEST" },
      status: "ACTIVE",
      ...(spaceId !== undefined ? { AND: [spaceId ? spacePeopleWhere(orgId, spaceId) : { userId: { in: [] } }] } : {}),
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
  // «إشارة التوثيق» (S5.5): only for a viewer whose rank is known (the route passes it) and who is not a guest, while the switch is on
  const badges = viewerRole ? await verifiedShownTo(orgId, { role: viewerRole }) : false;
  // «آخر ظهور»: only when the caller is known (the route passes them); absent otherwise, and absent for a guest or a switched-off company
  const seen = !viewerId ? null : typeof viewerId === "string" ? await lastSeenReader(orgId, viewerId) : viewerId;
  return rows.map((r) => ({
    userId: r.userId,
    name: r.user.name,
    jobTitle: r.user.jobTitle,
    role: r.role,
    avatarUrl: r.user.avatarUrl,
    ...(seen ? seen.field(r) : {}),
    ...(badges && r.verifiedAt ? { verified: true as const } : {}),
  }));
}

/**
 * The staff directory page (`/members` for somebody who may look but not manage): the ACTIVE people with job title, rank and e-mail, the owner first.
 * `verified: true` («إشارة التوثيق», S5.5) comes in the same read for a viewer who is not a guest, while the switch is on.
 */
export async function staffDirectory(orgId: string, viewerRole: string): Promise<DirectoryPerson[]> {
  const rows = await db.organizationMember.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { role: true, verifiedAt: true, user: { select: { id: true, name: true, jobTitle: true, email: true, avatarUrl: true } } },
  });
  const badges = await verifiedShownTo(orgId, { role: viewerRole });
  return rows
    .map((r) => ({
      id: r.user.id,
      name: r.user.name,
      jobTitle: r.user.jobTitle,
      role: r.role,
      email: r.user.email,
      avatarUrl: r.user.avatarUrl,
      ...(badges && r.verifiedAt && r.role !== "GUEST" ? { verified: true as const } : {}),
    }))
    .sort((a, b) => RANK[b.role] - RANK[a.role]);
}

/** A person of the company as the floating quick chat lists them. */
export interface CompanyPersonDto extends DirectoryPersonDto {
  /**
   * One of the people of the space the viewer is in. A private message is opened only with somebody
   * of the space the person is in (`openDm`, `chat.dm_not_in_space`): a person from another space is
   * shown, marked, and never a button that does nothing.
   */
  inSpace: boolean;
  /** At their screen right now (the same presence the dock and the chat's member pills read). */
  online: boolean;
}

/**
 * EVERYBODY IN THE COMPANY — the list behind the floating quick chat (the owner's ask, 2026-10-30:
 * «بس تضغط عليها يظهور الاعضاء»). Unlike `chatDirectory`, which is the picker of the space the
 * person is in, this one is the whole staff: the dock's roster with the space's own membership on
 * each row, so the screen can keep the colleagues it cannot write to from the ones it can.
 *
 * Guests stay out (a guest is nobody's colleague and has no DMs at all); the viewer is included,
 * the route drops them.
 */
export async function companyDirectory(orgId: string, viewerId: string, spaceId: string | null, reader?: LastSeenReader): Promise<CompanyPersonDto[]> {
  const hideOwner = await isFeatureOn(orgId, "ownerHiddenOnline");
  const seen = reader ?? (await lastSeenReader(orgId, viewerId));
  const badges = await verifiedShownTo(orgId, { userId: viewerId });
  const [rows, ofSpace, online] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId: orgId, role: { not: "GUEST" }, status: "ACTIVE" },
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
    }),
    spaceId
      // all-statuses: spacePeopleWhere already requires status "ACTIVE"
      ? db.organizationMember.findMany({ where: spacePeopleWhere(orgId, spaceId), select: { userId: true } })
      : Promise.resolve([] as { userId: string }[]),
    onlineUserIds(orgId),
  ]);
  const space = new Set(ofSpace.map((r) => r.userId));
  const atScreen = new Set(online);
  return rows.map((r) => ({
    userId: r.userId,
    name: r.user.name,
    jobTitle: r.user.jobTitle,
    role: r.role,
    avatarUrl: r.user.avatarUrl,
    ...seen.field(r),
    ...(badges && r.verifiedAt ? { verified: true as const } : {}),
    // no space at all (a company without spaces): the DM is opened company-wide, so nobody is fenced off
    inSpace: spaceId ? space.has(r.userId) : true,
    // «إخفاء المالك من متصل»: the owner does not light up for anybody but himself
    online: r.userId === viewerId || (atScreen.has(r.userId) && !(hideOwner && r.role === "OWNER" /* oversight-ok: presence of the OWNER rank, not reading */)),
  }));
}
