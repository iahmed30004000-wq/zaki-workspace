import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { HQ_SYSTEM_KEY } from "@/server/chat/hq";

/**
 * THE PEOPLE OF A SPACE — who you meet inside the space you are in (the owner's decision, 2026-10-25: people and
 * private messages only among colleagues who share the space; a space is like a separate site): the ACTIVE people
 * with a row in it, and the company's OWNER, who is in every space without a row.
 */
export function spacePeopleWhere(orgId: string, spaceId: string): Prisma.OrganizationMemberWhereInput {
  return {
    organizationId: orgId,
    status: "ACTIVE",
    OR: [{ role: "OWNER" }, { user: { workspaceLinks: { some: { workspaceId: spaceId } } } }],
  };
}

/**
 * «إشارة التوثيق» (S5.5): which of these people carry the badge in this company. ONE query for the whole list (never one per person); the caller has already checked the company's
 * switch `verifiedBadge` and that the viewer is not a guest. Only ids come out: the time of the grant and who gave it never leave the server.
 */
export async function verifiedIdsAmong(orgId: string, userIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Set();
  const rows = await db.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: ids }, status: "ACTIVE", verifiedAt: { not: null } }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

/** Is this person one of the space's people? */
export async function isOfSpace(orgId: string, spaceId: string, userId: string): Promise<boolean> {
  return (await db.organizationMember.count({ where: { AND: [spacePeopleWhere(orgId, spaceId)], userId, status: "ACTIVE" } })) > 0;
}

/** Is the space «الشركة» (HQ)? The private messages from before spaces existed live there. */
export async function isHqSpace(spaceId: string | null | undefined): Promise<boolean> {
  if (!spaceId) return false;
  const ws = await db.workspace.findUnique({ where: { id: spaceId }, select: { systemKey: true } });
  return ws?.systemKey === HQ_SYSTEM_KEY;
}
