import { NextResponse } from "next/server";
import { audit } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { routineInputSchema } from "@/lib/daily-routine";
import { createDailyRoutine, routinesScreen } from "@/server/services/daily-routines";

/**
 * «روتين يومي».
 *
 *  GET   the routines the person may see, what the «new routine» form may offer, and the company's time zone.
 *  POST  `{ workspaceId, projectId, title, description?, assigneeId, days: [0..6], time: "HH:MM", dueTime: "HH:MM" }`.
 *
 * Every guard (who may make one, for whom, the company's `recurringTasks` switch) lives in the service.
 */
export async function GET() {
  return withApi(async () => NextResponse.json(await routinesScreen()));
}

export async function POST(req: Request) {
  return withApi(async () => {
    const made = await createDailyRoutine(await parseJson(routineInputSchema, req));
    await audit("daily_routine.created", { actorId: made.userId, orgId: made.orgId, target: made.routine.id });
    return NextResponse.json({ routine: made.routine }, { status: 201 });
  });
}
