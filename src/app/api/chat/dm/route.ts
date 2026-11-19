import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { currentSpace } from "@/server/services/current-space";
import { assertFeatureOn } from "@/server/services/features";
import { openDm, openSavedMessages } from "@/server/chat/dm";

// `{ userId }`: the DM with one person. `{ saved: true }`: «الرسائل المحفوظة», the DM with myself (C3a.3)
const dmSchema = z.union([z.object({ userId: z.string().min(1) }), z.object({ saved: z.literal(true) })]);

/** POST: open (or find) the DM between me and one person, or my own saved chat. Guests have no DMs. */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(dmSchema, req);
    const ctx = await activeOrgCtx();
    if ("saved" in input) {
      await assertFeatureOn(ctx.orgId, "savedMessages");
      const saved = await openSavedMessages(ctx);
      return NextResponse.json(saved, { status: saved.created ? 201 : 200 });
    }
    // in the space the person is in, with somebody of it
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const result = await openDm(ctx, input.userId, space?.id ?? null);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  });
}
