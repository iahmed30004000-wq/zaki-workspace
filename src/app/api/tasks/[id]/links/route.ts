import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireTaskAccess } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { addTaskLink, listTaskLinks } from "@/server/services/task-links";

/**
 * «التبعيات» of one task — the links between two tasks.
 *
 *  GET  every link of the task, both directions: what it blocks and what it is blocked by.
 *  POST one link: `{ dependsOnId, kind }`. Both tasks are checked with the task page's own guard.
 *
 * The row is information, never a lock: a linked task still moves and still closes.
 */

const linkSchema = z.object({
  dependsOnId: z.string().min(1),
  kind: z.enum(["BLOCKS", "BLOCKED_BY", "DUPLICATES"]).default("BLOCKS"),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const access = await requireTaskAccess(params.id);
    await assertMemberCan(access, "tasks.view", "section.view_denied", { spaceGuestsPass: true });
    // «التبعيات» switched off: the card is not drawn and this door answers «not found»
    await assertFeatureOn(access.orgId, "taskLinks");
    return NextResponse.json(await listTaskLinks(params.id, access.userId));
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(linkSchema, req);
    // checked inside `addTaskLink` (the task's own guard), and the switch before anything is written
    const access = await requireTaskAccess(params.id);
    await assertFeatureOn(access.orgId, "taskLinks");
    const link = await addTaskLink(params.id, input);
    return NextResponse.json({ link }, { status: 201 });
  });
}
