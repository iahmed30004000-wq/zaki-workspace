import { NextResponse } from "next/server";
import { z } from "zod";
import { ForbiddenError } from "@/server/auth";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parse } from "@/server/validation";
import { calendarScreenFor } from "@/server/services/calendar";

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  mine: z.enum(["1"]).optional(),
  project: z.string().min(1).max(64).optional(),
});

/**
 * GET — «التقويم» OF THE SPACE THE PERSON IS IN, for the phone (M2 N6): the same `calendarScreenFor` the calendar page reads — the month
 * (`?month=YYYY-MM`, the company's month by default), its open tasks with a due date inside the person's work scope and teams, «مهامي فقط»
 * (`?mine=1`), and whether the person may move a task to another day (`editable`; the move itself is `PATCH /api/tasks/[id]`).
 * Read-only. Without the tasks row of the grid it is refused.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const { searchParams } = new URL(req.url);
    const q = parse(querySchema, {
      month: searchParams.get("month") || undefined,
      mine: searchParams.get("mine") || undefined,
      project: searchParams.get("project") || undefined,
    });
    const result = await calendarScreenFor(actor, { month: q.month, mine: q.mine === "1", projectId: q.project });
    if (result.kind !== "ok") throw new ForbiddenError("section.view_denied");
    return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
  });
}
