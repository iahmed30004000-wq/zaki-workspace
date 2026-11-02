import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { listDeletedDocuments } from "@/server/services/documents";

/** «المستندات المحذوفة» of a space (`?spaceId=`): the owner's alone; anybody else gets «not found». */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const spaceId = new URL(req.url).searchParams.get("spaceId");
    if (!spaceId) throw new ValidationError([{ path: "spaceId", message: "docs.e.space" }]);
    return NextResponse.json(await listDeletedDocuments(actor, spaceId));
  });
}
