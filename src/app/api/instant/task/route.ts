import { parseDueInput } from "@/lib/due-day";
import { dueTextSchema } from "@/lib/due-input";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ForbiddenError, NotFoundError, requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { isFeatureOn } from "@/server/services/features";
import { createInstantTask, inboxSpaceFor } from "@/server/services/instant-work";
import { orgTimeZone } from "@/server/services/org-day";
import { rewardBodySchema, toRewardRequest } from "@/server/services/reward-input";

const schema = z
  .object({
    title: z.string().trim().min(1, "title.required").max(280),
    description: z.string().trim().max(4000).nullable().optional(),
    /** The one person (older forms), or `assigneeIds` for «لمين» with more than one. */
    assigneeId: z.string().min(1).optional(),
    assigneeIds: z.array(z.string().min(1)).max(50).optional(),
    priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).default("NORMAL"),
    // a day ("2026-11-05") or a full instant: a day is noon in the COMPANY's zone, never the browser's (review B5)
    dueDate: dueTextSchema.nullable().optional(),
    /** «مهمة بمكافأة»: the OWNER's alone, with a due date (403 `reward.owner_only` otherwise). */
    reward: rewardBodySchema.optional(),
  })
  .refine((v) => (v.assigneeIds?.length ?? 0) > 0 || Boolean(v.assigneeId), {
    message: "instant.pick_person",
    path: ["assigneeIds"],
  });

/** POST: «مهمة فورية» in the space the person is in (src/server/services/instant-work.ts). */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(schema, req);
    const who = await activeOrgCtx();
    const space = await currentSpace({ userId: who.userId, orgId: who.orgId, role: who.orgRole });
    if (!space) throw new NotFoundError("workspace.not_found");
    // «صندوق المهام» (W1.2): «الشركة» holds no project, so a task made while in it goes to the first standard space (D-N3)
    let spaceId = space.id;
    if (await isFeatureOn(who.orgId, "workInbox")) {
      const inbox = await inboxSpaceFor({ userId: who.userId, orgId: who.orgId, role: who.orgRole }, space.id);
      if (!inbox) throw new ForbiddenError("instant.no_space");
      spaceId = inbox.id;
    }
    const ctx = await requireWorkspace(spaceId, ["ADMIN", "MEMBER"]);
    // absent: the company's default (today at its hour); null: no date
    const dueDate = input.dueDate === undefined ? undefined : input.dueDate ? parseDueInput(input.dueDate, await orgTimeZone(ctx.orgId)) : null;
    const task = await createInstantTask(ctx, spaceId, {
      title: input.title,
      description: input.description ?? null,
      assigneeIds: input.assigneeIds?.length ? input.assigneeIds : [input.assigneeId!],
      priority: input.priority,
      dueDate,
      reward: input.reward ? toRewardRequest(input.reward) : undefined,
    });
    return NextResponse.json({ task }, { status: 201 });
  });
}
