import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { parseOldCardFor, parseSchema } from "@/server/services/knowledge";

/** «الصقي كرت قديم»: the fields an old Telegram card splits into (nothing is saved; an editor's). */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(parseSchema, req);
    return NextResponse.json(await parseOldCardFor(actor, input));
  });
}
