import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError, audit } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { routineInputSchema } from "@/lib/daily-routine";
import { pauseDailyRoutine, resumeDailyRoutine, updateDailyRoutine } from "@/server/services/daily-routines";

/**
 * PATCH one routine: `{ action: "pause" }`, `{ action: "resume" }`, or the whole routine (the same body as making one).
 * There is no delete: a paused routine makes nothing, and the cards already made are ordinary tasks.
 */
const bodySchema = z.object({ action: z.enum(["pause", "resume"]).optional() }).passthrough();

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const body = await parseJson(bodySchema, req);
    let done;
    let event: string;
    if (body.action) {
      done = body.action === "pause" ? await pauseDailyRoutine(params.id) : await resumeDailyRoutine(params.id);
      event = body.action === "pause" ? "daily_routine.paused" : "daily_routine.resumed";
    } else {
      const parsed = routineInputSchema.safeParse(body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      done = await updateDailyRoutine(params.id, parsed.data);
      event = "daily_routine.updated";
    }
    await audit(event, { actorId: done.userId, orgId: done.orgId, target: params.id });
    return NextResponse.json({ routine: done.routine });
  });
}
