import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { addOptionSchema, addPollOption } from "@/server/chat/polls";

/** POST: one more option on a poll that was sent as open to it (somebody who may post there; the switch `chatPollExtras`). Answers the message as the caller now sees it. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(addOptionSchema, req);
    const ctx = await activeOrgCtx();
    return NextResponse.json(await addPollOption(ctx, params.id, input));
  });
}
