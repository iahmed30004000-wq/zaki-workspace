import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/auth";

/**
 * «محصور بمساحة» (`OrganizationMember.spaceOnly`, ask 5 of the owner's tasks prompt, 2026-11-25): an account that works only in
 * the spaces it was put in. What a space HOLDS is already closed to whoever has no row in it, and such an account is never put in
 * «الشركة» (src/server/chat/hq.ts). What was left open was everything company-wide, and this file is the one place that closes it:
 *
 *   PEOPLE it meets: the people of its own spaces, and the company's OWNER (who is in every space). With no space: nobody.
 *   PUTTING PEOPLE TOGETHER (a private message, a group, a call): every limited one among them must meet all the others, so nobody
 *   outside can pull the account out either.
 *   COMPANY-WIDE AREAS (departments, the customers' Telegram, order states): refused. The boxes in `SPACE_ONLY_WITHHELD`
 *   (src/server/policy/capabilities.ts) are never held by it.
 *
 * Everybody else gets `null` or `true` here: nothing changes for an account without the mark.
 */

export async function isSpaceOnly(userId: string, orgId: string): Promise<boolean> {
  const row = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId } }, select: { spaceOnly: true } }); // all-statuses: only the mark is read; who is still IN is decided by the door before this
  return row?.spaceOnly === true;
}

/**
 * Whom this person meets, as a part of a question about the company's members: `null` = the whole company, as always.
 * It does not judge the status: the question it is part of does.
 */
export async function reachableWhere(orgId: string, viewerId: string): Promise<Prisma.OrganizationMemberWhereInput | null> {
  if (!(await isSpaceOnly(viewerId, orgId))) return null;
  const rows = await db.workspaceMember.findMany({ where: { userId: viewerId, workspace: { organizationId: orgId } }, select: { workspaceId: true } });
  if (!rows.length) return { userId: viewerId };
  return { OR: [{ userId: viewerId }, { role: "OWNER" /* oversight-ok: the owner is in every space; this reads nothing */ }, { user: { workspaceLinks: { some: { workspaceId: { in: rows.map((r) => r.workspaceId) } } } } }] };
}

/** May this one person see (open the profile of, hand something to) that one? */
export async function mayMeet(orgId: string, viewerId: string, otherId: string): Promise<boolean> {
  return mayAllMeet(orgId, [viewerId, otherId]);
}

/** May all of these be in one conversation or one call? */
export async function mayAllMeet(orgId: string, userIds: readonly string[]): Promise<boolean> {
  const ids = [...new Set(userIds)];
  if (ids.length < 2) return true;
  const held = await db.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: ids }, spaceOnly: true }, select: { userId: true } }); // all-statuses: a suspended limited account is still kept apart
  for (const one of held) {
    const reach = await reachableWhere(orgId, one.userId);
    if (!reach) continue;
    const met = await db.organizationMember.count({ where: { organizationId: orgId, userId: { in: ids }, AND: [reach] } }); // all-statuses: who is ACTIVE is judged by the door itself
    if (met < ids.length) return false;
  }
  return true;
}

/** A company-wide area: 403 for an account that works only in its spaces. */
export async function assertNotSpaceOnly(userId: string, orgId: string): Promise<void> {
  if (await isSpaceOnly(userId, orgId)) throw new ForbiddenError("space_only.denied");
}
