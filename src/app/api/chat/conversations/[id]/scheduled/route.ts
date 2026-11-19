import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { createScheduled, listScheduled, scheduleSchema } from "@/server/chat/scheduled";

/**
 * C3c.3 «جدول الإرسال». GET: the caller's OWN waiting and failed scheduled messages in this conversation, with the company's time zone and the limits. Nobody else's row is ever
 * answered. POST: schedule a message (the author may post here now, `sendAt` between a minute and a year ahead; idempotent on `clientId`). The company's switch off: both answer «not found».
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await listScheduled(ctx, params.id));
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(scheduleSchema, req);
    const ctx = await activeOrgCtx();
    return NextResponse.json(await createScheduled(ctx, params.id, input), { status: 201 });
  });
}
