import { NextResponse } from "next/server";
import { z } from "zod";
import { ForbiddenError, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { parse, parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { assertFeatureOn } from "@/server/services/features";
import { createInboxTask, inboxInfo, inboxSpaceFor } from "@/server/services/instant-work";
import { orgTimeZone } from "@/server/services/org-day";
import { dueInstantForDay, parseDayText } from "@/lib/due-day";

const schema = z.object({
  title: z.string().trim().min(1, "title.required").max(280),
  /** B4: the space it goes to (one of the person's): inside «الشركة» the quick add asks which. Left out: the space the person is in. */
  spaceId: z.string().min(1).max(64).optional(),
  /** The person it is for; nobody named: the person's own. */
  assigneeId: z.string().min(1).optional(),
  assigneeIds: z.array(z.string().min(1)).max(50).optional(),
  /** What the task needs: its specification (the quick add's second field). */
  description: z.string().max(10_000).nullable().optional(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).default("NORMAL"),
  // a day ("2026-11-05") or a full instant: a day is noon in the COMPANY's zone, never the browser's (review B5)
  dueDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
});

/**
 * POST: a quick task into «صندوق المهام» (W1.2, switch `workInbox`; src/server/services/instant-work.ts). The space is the one the
 * person is in — or, in «الشركة» (it holds no project, D-N3), their first standard space; with none: 403 `instant.no_space`
 * («لسا ما إلك مساحة شغل»). Today's quick add posts here.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(schema, req);
    const who = await activeOrgCtx();
    await assertFeatureOn(who.orgId, "workInbox");
    const subject = { userId: who.userId, orgId: who.orgId, role: who.orgRole };
    const current = await currentSpace(subject);
    // B4: the space the person named (a space that is not theirs: «instant.no_space»), else the one they are in
    const space = await inboxSpaceFor(subject, input.spaceId ?? current?.id);
    if (!space) throw new ForbiddenError("instant.no_space");
    const ctx = await requireWorkspace(space.id, ["ADMIN", "MEMBER"]);
    const dueDate = !input.dueDate
      ? null
      : parseDayText(input.dueDate)
        ? dueInstantForDay(input.dueDate, await orgTimeZone(ctx.orgId))
        : new Date(input.dueDate);
    const task = await createInboxTask(ctx, space.id, {
      title: input.title,
      assigneeIds: input.assigneeIds?.length ? input.assigneeIds : input.assigneeId ? [input.assigneeId] : undefined,
      description: input.description?.trim() ? input.description.trim() : null,
      priority: input.priority,
      dueDate,
    });
    return NextResponse.json({ task, space }, { status: 201 });
  });
}

/**
 * GET `?workspaceId=`: the inbox project's id in that space once it exists (null before the first quick task), so a picker of projects (the
 * dialog of «اعمل منها مهمة») can leave it out of its list by id and offer «صندوق المهام» once. A read: nothing is made. Switch off: 404.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const { workspaceId } = parse(z.object({ workspaceId: z.string().min(1) }), Object.fromEntries(new URL(req.url).searchParams));
    const ctx = await requireWorkspace(workspaceId, ["ADMIN", "MEMBER"]);
    await assertFeatureOn(ctx.orgId, "workInbox");
    const info = await inboxInfo({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole }, workspaceId);
    return NextResponse.json({ projectId: info.projectId });
  });
}
