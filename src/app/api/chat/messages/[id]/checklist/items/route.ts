import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { addItem, addItemSchema } from "@/server/chat/checklists";

/** POST: add an item to a checklist — its author, or anybody who may post here when the author allowed it (`othersCanAdd`). Answers the message as the caller now sees it. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(addItemSchema, req);
    const ctx = await activeOrgCtx();
    return NextResponse.json(await addItem(ctx, params.id, input), { status: 201 });
  });
}
