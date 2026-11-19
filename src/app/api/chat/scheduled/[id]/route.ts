import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { cancelScheduled, scheduleUpdateSchema, updateScheduled } from "@/server/chat/scheduled";

/**
 * C3c.3: one scheduled message of the CALLER (somebody else's id is «not found»: nobody learns that it exists). PATCH «عدّل»: the words, the moment, the mentions, the flags of a waiting
 * row. DELETE «احذف»: a waiting or failed row is cancelled and its words are blanked.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(scheduleUpdateSchema, req);
    const ctx = await activeOrgCtx();
    return NextResponse.json(await updateScheduled(ctx, params.id, input));
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await cancelScheduled(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
