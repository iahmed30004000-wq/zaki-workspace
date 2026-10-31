import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { assertNotGuest } from "@/server/services/guest-guard";
import { keyResultPatchSchema, removeKeyResult, updateKeyResult } from "@/server/services/okr";

/** «الأهداف والنتائج»: edit or remove one key result (its goal's owner, the space's admin, the owner of the company). Staff only. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    assertNotGuest({ orgRole: actor.role });
    const patch = await parseJson(keyResultPatchSchema, req);
    const keyResult = await updateKeyResult({ orgId: actor.orgId, userId: actor.userId }, params.id, patch);
    return NextResponse.json({ keyResult });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    assertNotGuest({ orgRole: actor.role });
    await removeKeyResult({ orgId: actor.orgId, userId: actor.userId }, params.id);
    return NextResponse.json({ ok: true });
  });
}
