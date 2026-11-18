import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parse } from "@/server/validation";
import { currentSpace } from "@/server/services/current-space";
import { activeOrgCtx } from "@/server/services/integrations";
import { chatList, chatScope } from "@/server/chat/list";
import { ensureStartersForSpace, ensureStartersForViewer } from "@/server/chat/space-topics";

const query = z.object({ spaceId: z.string().min(1).max(64).optional() });

/**
 * GET: the chat list (C1.2). The company's switch `chatOneList` (D-N2, default ON, pending the owner) picks the shape when the caller names no space:
 *  - ON  «قائمة وحدة»: every space as one forum row and every private chat of the person, each with a small space chip;
 *  - OFF «كل مساحة حساب»: the space the person is in (the `zk-space` cookie, checked) — its topics and its private chats, like the old home.
 * `?spaceId=` always asks for that one space, whatever the switch says.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const q = parse(query, Object.fromEntries(new URL(req.url).searchParams));
    let spaceId = q.spaceId;
    if (!spaceId && !(await chatScope(ctx).feature("chatOneList"))) {
      spaceId = (await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole }))?.id;
    }
    // a space made before every space got its starter topics gets them the first time its chat opens
    if (spaceId) await ensureStartersForSpace(ctx, spaceId);
    else await ensureStartersForViewer(ctx);
    return NextResponse.json(await chatList(ctx, spaceId ? { spaceId } : {}));
  });
}
