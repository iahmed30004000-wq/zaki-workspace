import type { Prisma } from "@prisma/client";
import { ForbiddenError } from "@/server/auth";

/**
 * «/setjoingroups» (docs/contracts/bots.md): a bot whose owner switched joining off may not be ADDED to a topic of chosen people. `conversationIds` are the topics it is being
 * put into: a bot already in every one of them is not being added, so saving a topic's people again does not trip on it. Taking a bot out is always allowed.
 */
export async function assertBotsMayJoin(client: Pick<Prisma.TransactionClient, "bot" | "conversationMember">, orgId: string, userIds: readonly string[], conversationIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  const closed = await client.bot.findMany({ where: { orgId, userId: { in: [...userIds] }, joinGroups: false, deletedAt: null }, select: { userId: true } });
  for (const bot of closed) {
    const inside = conversationIds.length ? await client.conversationMember.count({ where: { userId: bot.userId, conversationId: { in: [...conversationIds] } } }) : 0;
    if (conversationIds.length === 0 || inside < conversationIds.length) throw new ForbiddenError("bots.no_join");
  }
}
