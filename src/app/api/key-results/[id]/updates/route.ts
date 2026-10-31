import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { assertNotGuest } from "@/server/services/guest-guard";
import { checkIn, checkInSchema, listCheckIns } from "@/server/services/okr";

/**
 * «الأهداف والنتائج»: the check-ins of a key result. The history is APPEND-ONLY: there is no PATCH and no DELETE here, on purpose.
 * Reading writes nothing (the owner of the company reads in silence). Staff only.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    assertNotGuest({ orgRole: actor.role });
    const updates = await listCheckIns({ orgId: actor.orgId, userId: actor.userId }, params.id);
    return NextResponse.json({ updates });
  });
}

/** A check-in: the value now and a short note. Its goal's owner, the space's admin or the owner of the company. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    assertNotGuest({ orgRole: actor.role });
    const input = await parseJson(checkInSchema, req);
    const result = await checkIn({ orgId: actor.orgId, userId: actor.userId }, params.id, input);
    return NextResponse.json(result, { status: 201 });
  });
}
