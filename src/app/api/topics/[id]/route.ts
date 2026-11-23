import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { moveTopicToGroup } from "@/server/chat/groups";
import { PATCH as settingsPatch } from "@/app/api/chat/topics/[id]/route";
import { structureRoute } from "@/server/door/structure-auth";

const moveSchema = z.object({ groupId: z.string().min(1).nullable() }).strict();

/**
 * PATCH `{ groupId }`: «نقل إلى مجموعة» (a group id, or null for «عام»). From the app this is the very route of the topic's settings
 * (`/api/chat/topics/:id`: title, emoji, pin, close, archive… and `groupId`); from a system token («ميوز») it takes `groupId` and nothing else.
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  return structureRoute(req, async ({ viaToken }) => {
    if (!viaToken) return settingsPatch(req, ctx);
    return withApi(async () => {
      const { groupId } = await parseJson(moveSchema, req);
      const org = await activeOrgCtx();
      await moveTopicToGroup(org, ctx.params.id, groupId);
      return NextResponse.json({ ok: true });
    });
  });
}
