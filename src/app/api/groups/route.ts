import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { createGroup, createGroupSchema, listGroups } from "@/server/chat/groups";
import { structureRoute } from "@/server/door/structure-auth";

/** GET `?spaceId=`: the groups of a space the person may know, in order (a restricted group only for the owner rank and its people). */
export async function GET(req: Request) {
  return structureRoute(req, () =>
    withApi(async () => {
      const spaceId = new URL(req.url).searchParams.get("spaceId");
      if (!spaceId) throw new ValidationError([{ path: "spaceId", message: "required" }]);
      const ctx = await activeOrgCtx();
      return NextResponse.json({ groups: await listGroups(ctx, spaceId) });
    }),
  );
}

/** POST `{ spaceId, name, emoji?, restricted?, memberIds?, position? }`: a new group (the space's ADMIN and the owner rank). */
export async function POST(req: Request) {
  return structureRoute(req, () =>
    withApi(async () => {
      const input = await parseJson(createGroupSchema, req);
      const ctx = await activeOrgCtx();
      return NextResponse.json({ group: await createGroup(ctx, input) }, { status: 201 });
    }),
  );
}
