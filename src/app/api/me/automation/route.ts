import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { automationInputSchema, getMyAutomation, setMyAutomation } from "@/server/chat/away";

/**
 * «أتمتة المحادثة» — MY work hours and away line (docs/contracts/telegram-look.md). Only my own row; answers «not found» while the company's switch `chatAutomation` is off.
 *
 *  GET   → `{ workHours: {days, from, to, tz} | null, chatAutomation: {on, text} }`
 *  PATCH `{ workHours?: {…} | null, chatAutomation?: {on, text} }` → the same shape; a part that is absent is left as it was.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await getMyAutomation({ orgId: actor.orgId, userId: actor.userId }));
  });
}

export async function PATCH(req: Request) {
  return withApi(async () => {
    const input = await parseJson(automationInputSchema, req);
    const actor = await requireActor();
    return NextResponse.json(await setMyAutomation({ orgId: actor.orgId, userId: actor.userId }, input));
  });
}
