import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { editItem, editItemSchema, removeItem, tickItem, tickSchema } from "@/server/chat/checklists";

type Params = { params: { id: string; itemId: string } };

/** PUT `{ done }`: tick or untick an item — the list's author, or anybody who may post here while `othersCanTick` holds. */
export async function PUT(req: Request, { params }: Params) {
  return withApi(async () => {
    const input = await parseJson(tickSchema, req);
    const ctx = await activeOrgCtx();
    return NextResponse.json(await tickItem(ctx, params.id, params.itemId, input));
  });
}

/** PATCH `{ text }`: reword an item — its author, the list's author, a moderator. */
export async function PATCH(req: Request, { params }: Params) {
  return withApi(async () => {
    const input = await parseJson(editItemSchema, req);
    const ctx = await activeOrgCtx();
    return NextResponse.json(await editItem(ctx, params.id, params.itemId, input));
  });
}

/** DELETE: remove an item — its author, the list's author, a moderator. */
export async function DELETE(_req: Request, { params }: Params) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await removeItem(ctx, params.id, params.itemId));
  });
}
