import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { sendScheduledNow } from "@/server/chat/scheduled";

/** C3c.3 «ابعت هلّق»: a waiting row of the CALLER goes out now, through the normal send (the same claim the job uses: it can never go out twice). Answers the sent message (null when the job sent it a moment before). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json({ message: await sendScheduledNow(ctx, params.id) });
  });
}
