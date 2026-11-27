import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { locationSendSchema, sendLocationMessage } from "@/server/chat/location";

/** POST `{ lat, lng, accuracy, replyToId?, clientId?, silent? }`: «إرسال الموقع», after the person saw it and confirmed. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = locationSendSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await sendLocationMessage(ctx, params.id, input), { status: 201 });
  });
}
