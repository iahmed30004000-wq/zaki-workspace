import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { conversationWork } from "@/server/chat/media";

/**
 * GET: the tasks and tickets made from a message of this conversation — the info panel's «الشغل» tab (C3d). Tasks by P0.2's visibility rule (a private task is
 * not even counted for a person it does not concern), tickets by the ticket door's reader rule, a guest gets neither. Same reading rule as opening the
 * conversation; it writes nothing.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await conversationWork(ctx, params.id));
  });
}
