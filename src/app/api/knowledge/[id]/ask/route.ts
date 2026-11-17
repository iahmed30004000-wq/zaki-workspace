import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { askSchema, askSupervisor } from "@/server/services/knowledge";

/** «اسألي مشرفتك»: a question nothing in the sheet answers becomes an instant ticket for the supervisor (or the owner). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(askSchema, req);
    return NextResponse.json(await askSupervisor(actor, params.id, input), { status: 201 });
  });
}
