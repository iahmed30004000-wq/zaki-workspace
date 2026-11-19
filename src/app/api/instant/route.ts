import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { isFeatureOn } from "@/server/services/features";
import { inboxInfo } from "@/server/services/instant-work";
import { listWorkspaceMembers } from "@/server/services/workspaces";
import { memberCan } from "@/server/policy/actor";
import { isRequestTo } from "@/server/policy/assign-rank";
import { db } from "@/server/db";
import { isOrgOwner } from "@/server/services/reward-guard";
import { defaultCurrencyOf } from "@/server/services/rewards";

/**
 * GET: what «مهمة فورية» and «تذكرة فورية» may offer this person: whether each is on for them, and the people they
 * can hand one to (the people of the space they are in). A guest, or the switch off: nothing.
 * `inbox` (W1.2, switch `workInbox`): where a quick task would go — null while the switch is off; `space: null` when the person has no
 * space to put it in. In «الشركة» (no projects there, D-N3) the space is the person's first standard space, and so are the people offered.
 * `request: true` marks somebody of a HIGHER rank: a task for them is only a request they accept or return
 * (src/server/services/task-assign.ts), so the picker shows it as «طلب».
 */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const none = { task: false, ticket: false, space: null, people: [], inbox: null };
    if (ctx.orgRole === "GUEST") return NextResponse.json(none);
    const [inboxOn, instantOn] = await Promise.all([isFeatureOn(ctx.orgId, "workInbox"), isFeatureOn(ctx.orgId, "instantWork")]);
    if (!inboxOn && !instantOn) return NextResponse.json(none);
    const subject = { userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole };
    const current = await currentSpace(subject);
    const inbox = inboxOn ? await inboxInfo(subject, current?.id) : null;
    if (!instantOn) return NextResponse.json({ ...none, inbox });
    const space = inbox ? inbox.space : current;
    if (!space) return NextResponse.json({ ...none, inbox });
    const [task, ticket, members] = await Promise.all([
      memberCan(ctx, "tasks.edit"),
      memberCan(ctx, "tickets.edit"),
      listWorkspaceMembers(space.id, ctx.userId),
    ]);
    const ranks = await db.organizationMember.findMany({
      where: { organizationId: ctx.orgId, status: "ACTIVE", userId: { in: members.map((m) => m.id) } },
      select: { userId: true, role: true },
    });
    const roleOf = new Map(ranks.map((r) => [r.userId, r.role]));
    // «مهمة بمكافأة»: the toggle is offered to the OWNER alone, while the switch is on (the server refuses anybody else anyway)
    const reward = (await isFeatureOn(ctx.orgId, "taskRewards")) && (await isOrgOwner(ctx));
    return NextResponse.json({
      inbox,
      reward: reward ? { defaultCurrency: await defaultCurrencyOf(ctx.orgId) } : null,
      task: task === true,
      ticket: ticket === true,
      space: { id: space.id, name: space.name },
      people: members.map((m) => {
        const role = roleOf.get(m.id);
        return { id: m.id, name: m.name, request: m.id !== ctx.userId && role !== undefined && isRequestTo(ctx.orgRole, role) };
      }),
    });
  });
}
