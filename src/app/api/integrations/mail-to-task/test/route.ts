import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { testMailConnection } from "@/server/services/mail-to-task";
import { mailTaskInputSchema } from "../schema";

/**
 * «افحص الاتصال»: connects with what is on the card, counts the folder, closes. Answers `{ ok: true, count }` or `{ ok: false, reasonKey }`
 * (a dictionary key, never the server's own words). The OWNER's alone; 404 while the switch is off. Nothing is saved.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(mailTaskInputSchema, req);
    return NextResponse.json(await testMailConnection(actor, input), { headers: { "cache-control": "no-store" } });
  });
}
