import { db } from "@/server/db";
import { accessibleWorkspaceIds } from "@/server/services/access";

/**
 * «باسم مين» (`ApiToken.actsAsId`): may a token of this space act as this account? Only an ACTIVE 🤖 account of the company
 * (never a person, never an outside partner) that is in the space. Asked when the token is made and again on EVERY request, so
 * taking the account out of the space, or stopping it, shuts the token at once.
 */
export async function usableAgent(orgId: string, userId: string, workspaceId: string): Promise<boolean> {
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId } }, select: { agent: true, status: true, role: true } });
  if (!member || !member.agent || member.status !== "ACTIVE" || member.role === "GUEST") return false;
  return (await accessibleWorkspaceIds(userId)).includes(workspaceId);
}
