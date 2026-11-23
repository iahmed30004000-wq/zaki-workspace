import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { deleteGroup, updateGroup, updateGroupSchema } from "@/server/chat/groups";
import { structureRoute } from "@/server/door/structure-auth";

/** PATCH `{ name?, emoji?, position?, restricted?, memberIds? }`: rename, order, restrict, change its people (and so its topics'). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return structureRoute(req, () =>
    withApi(async () => {
      const input = await parseJson(updateGroupSchema, req);
      const ctx = await activeOrgCtx();
      return NextResponse.json({ group: await updateGroup(ctx, params.id, input) });
    }),
  );
}

/** DELETE: the group goes; its topics (all of them, with their messages) fall back to «عام». */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return structureRoute(req, () =>
    withApi(async () => {
      const ctx = await activeOrgCtx();
      await deleteGroup(ctx, params.id);
      return NextResponse.json({ ok: true });
    }),
  );
}
