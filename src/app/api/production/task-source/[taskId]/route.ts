import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireTaskAccess } from "@/server/auth";
import { db } from "@/server/db";
import { requireActor } from "@/server/policy/actor";
import { cardSourceOf } from "@/server/services/card-links";
import { campaignSourceOf } from "@/server/services/campaigns";
import { ticketSourceOf } from "@/server/services/departments";

/**
 * GET: where a task came from (W1.6): the ticket, the campaign item or the card it was made from, each as THIS person may read it — named (with a link)
 * when they may open the source, else only `{ state: "hidden" }` (the fact, never a title, a key or an id). The task's own door comes first: a task the person
 * may not open is «not found» here too. An external partner gets an empty list (they never read tickets, campaigns or cards).
 * Lives under /api/production because W1.6 is limited to those paths; the integrator may move it next to the task routes.
 */
export async function GET(_req: Request, { params }: { params: { taskId: string } }) {
  return withApi(async () => {
    await requireTaskAccess(params.taskId);
    const task = await db.task.findUnique({ where: { id: params.taskId }, select: { id: true, sourceTicketId: true, sourceCardId: true } });
    if (!task) return NextResponse.json({ sources: [] });
    const actor = await requireActor();
    if (actor.isExternal) return NextResponse.json({ sources: [] });
    const ctx = { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId };
    const [ticket, campaign, card] = await Promise.all([ticketSourceOf(ctx, task.sourceTicketId), campaignSourceOf(ctx, task.id), cardSourceOf(actor, task.id, task.sourceCardId)]);
    return NextResponse.json({ sources: [ticket, campaign, card].filter((s) => s !== null) });
  });
}
