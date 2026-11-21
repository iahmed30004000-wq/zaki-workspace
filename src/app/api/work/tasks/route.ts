import { NextResponse } from "next/server";
import { z } from "zod";
import { ForbiddenError, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { requireActor, actorCanWork } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { createInboxTask, createInstantTask, inboxSpaceFor } from "@/server/services/instant-work";
import { workScreenFor } from "@/server/services/my-work";
import { orgTimeZone } from "@/server/services/org-day";
import { dueInstantForDay, parseDayText } from "@/lib/due-day";
import { parseMyTasksParams } from "@/lib/work/my-tasks";

/**
 * GET /api/work/tasks?view=&scope=&chip=&sort=&group=&space=&project=&stage=&q=&month= — «مهامي» (W1.1): the unified screen's data, the same answer the page
 * draws first. Every row is already filtered by what the caller may see (`taskVisibleWhere`): a task hidden from them is not in the list, not in the counts,
 * not found by the text. Switch `workMyTasks` off: 404 for everybody. A person whose grid has no «المهام» row: 403.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    await assertFeatureOn(actor.orgId, "workMyTasks");
    if (!actorCanWork(actor, "tasks.view")) throw new ForbiddenError("access.section_off");
    const params = parseMyTasksParams(new URL(req.url).searchParams);
    return NextResponse.json(await workScreenFor(actor, params), { headers: { "Cache-Control": "no-store" } });
  });
}

const quickSchema = z.object({
  title: z.string().trim().min(1, "title.required").max(280),
  /** B4: the space the screen is showing (one of the person's); left out, the space they are in. */
  spaceId: z.string().min(1).max(64).optional(),
  /** A day ("2026-11-05") or a full instant: a day is noon in the COMPANY's zone, never the browser's. */
  dueDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
});

/**
 * POST — a quick task from «مهامي»: ONLY a title is needed. It is the person's own and lands in the «صندوق المهام» of the space they are in (in «الشركة»,
 * which holds no project, their first standard space; with none: 403 `instant.no_space`). With the switch `workInbox` off it goes where «مهمة فورية» always went.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(quickSchema, req);
    const who = await activeOrgCtx();
    await assertFeatureOn(who.orgId, "workMyTasks");
    const subject = { userId: who.userId, orgId: who.orgId, role: who.orgRole };
    const space = await inboxSpaceFor(subject, input.spaceId ?? (await currentSpace(subject))?.id);
    if (!space) throw new ForbiddenError("instant.no_space");
    const ctx = await requireWorkspace(space.id, ["ADMIN", "MEMBER"]);
    const dueDate = !input.dueDate ? null : parseDayText(input.dueDate) ? dueInstantForDay(input.dueDate, await orgTimeZone(ctx.orgId)) : new Date(input.dueDate);
    const made = { title: input.title, priority: "NORMAL" as const, dueDate };
    const task = (await isFeatureOn(ctx.orgId, "workInbox"))
      ? await createInboxTask(ctx, space.id, made)
      : await createInstantTask(ctx, space.id, { ...made, assigneeIds: [ctx.userId] });
    return NextResponse.json({ task, space }, { status: 201 });
  });
}

export const dynamic = "force-dynamic";
