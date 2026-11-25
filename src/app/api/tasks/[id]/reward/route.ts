import { parseDueInput } from "@/lib/due-day";
import { dueTextSchema } from "@/lib/due-input";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTaskAccess } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { setReward } from "@/server/services/rewards";
import { rewardBodySchema, toRewardRequest } from "@/server/services/reward-input";
import { orgTimeZone } from "@/server/services/org-day";

/**
 * «مهمة بمكافأة» — put a reward on a task, or change it. THE OWNER ONLY (403 `reward.owner_only` for everybody else; the
 * service reads the rank from the database). The task must have a due date: the one it has, or `dueDate` sent here.
 *
 *  POST { amount | amountMinor, currency?, note?, dueDate? }
 */
const schema = rewardBodySchema.extend({ dueDate: dueTextSchema.optional() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const body = await parseJson(schema, req);
    const ctx = await requireTaskAccess(params.id, ["ADMIN", "MEMBER"]);
    const dueDate = !body.dueDate ? undefined : parseDueInput(body.dueDate, await orgTimeZone(ctx.orgId));
    const { dueDate: _day, ...reward } = body;
    void _day;
    const saved = await setReward(ctx, params.id, { ...toRewardRequest(reward), dueDate });
    return NextResponse.json({ reward: saved });
  });
}
