import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertFeatureOn } from "@/server/services/features";
import { deleteManySchema, deleteMessages } from "@/server/chat/messages";

/**
 * POST (C3b.5, «حدّد» then «احذف»): delete a selection — `{ ids ≤ 100 }` — each id by the single rule (my own, or a moderator's). The company's switch `chatMultiSelect`
 * first (off: 404). The answer reports every id: `results: [{ id, ok, error? }]`; whoever only reads through silent oversight deletes nothing and leaves no trace.
 */
/**
 * GET (C3b.5): «is the company's switch on?» — 200 `{ on: true }` while `chatMultiSelect` is on, 404 while it is off. It reads and writes nothing else; the new chat screen asks it
 * once (five minutes) when the conversation's header does not carry the switch, so a company that turned it off never sees «حدّد», a check or the bar.
 */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertFeatureOn(ctx.orgId, "chatMultiSelect");
    return NextResponse.json({ on: true });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertFeatureOn(ctx.orgId, "chatMultiSelect");
    const input = await parseJson(deleteManySchema, req);
    return NextResponse.json(await deleteMessages(ctx, input));
  });
}
