import { NextResponse } from "next/server";
import { apiError, withApi } from "@/server/api";
import { audit } from "@/server/auth";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { SpaceConflictError } from "@/server/services/workspaces";
import { deleteAllSchema, deleteSpaceWithWork, spaceContents } from "@/server/services/space-delete";

/** GET: what would go with the space, and with its department when it has one (the OWNER only; never «الشركة»: 409). Deletes nothing. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    try {
      return NextResponse.json(await spaceContents(actor, params.id));
    } catch (err) {
      if (err instanceof SpaceConflictError) return apiError("conflict", err.message);
      throw err;
    }
  });
}

/** POST { confirmName }: deletes the space and all its work, for good (the OWNER only, the typed name must match). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { confirmName } = await parseJson(deleteAllSchema, req);
    const actor = await requireActor();
    try {
      await deleteSpaceWithWork(actor, params.id, confirmName);
    } catch (err) {
      if (err instanceof SpaceConflictError) return apiError("conflict", err.message);
      throw err;
    }
    await audit("workspace.deleted", { actorId: actor.userId, orgId: actor.orgId, target: params.id, meta: { name: confirmName, withWork: true } });
    return NextResponse.json({ ok: true });
  });
}
