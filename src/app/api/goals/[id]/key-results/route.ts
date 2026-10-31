import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { assertNotGuest } from "@/server/services/guest-guard";
import { addKeyResult, keyResultInputSchema } from "@/server/services/okr";

/**
 * «الأهداف والنتائج»: add a key result to an objective. Staff only (a guest gets 403 `guest.no_access` before the body is read);
 * the goal's owner, the space's admin or the owner of the company, holding «يضيف ويعدّل»; at most five per objective; behind the
 * `okr` switch (off: 404).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    assertNotGuest({ orgRole: actor.role });
    const input = await parseJson(keyResultInputSchema, req);
    const keyResult = await addKeyResult({ orgId: actor.orgId, userId: actor.userId }, params.id, input);
    return NextResponse.json({ keyResult }, { status: 201 });
  });
}
