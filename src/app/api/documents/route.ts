import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { ValidationError } from "@/server/auth";
import { createDocSchema, createDocument, listDocuments } from "@/server/services/documents";

/** The documents of a space the person reads (`?spaceId=`); an external partner gets only the ones shared with them. */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const spaceId = new URL(req.url).searchParams.get("spaceId");
    if (!spaceId) throw new ValidationError([{ path: "spaceId", message: "docs.e.space" }]);
    return NextResponse.json(await listDocuments(actor, spaceId));
  });
}

/** A new document in a space the person writes in. */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createDocSchema, req);
    return NextResponse.json({ document: await createDocument(actor, input) }, { status: 201 });
  });
}
