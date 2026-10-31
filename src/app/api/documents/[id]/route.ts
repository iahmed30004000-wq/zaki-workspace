import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { withDocApi } from "@/server/doc-api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { archiveDocument, readDocument, saveDocSchema, saveDocument } from "@/server/services/documents";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ document: await readDocument(actor, params.id) });
  });
}

/** Autosave and save: the title and the text. `version`: the one the editor started from (409 when the document moved on). */
export async function PATCH(req: Request, { params }: Ctx) {
  return withDocApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(saveDocSchema, req);
    return NextResponse.json({ document: await saveDocument(actor, params.id, input) });
  });
}

/** «حذف»: the document goes out of sight (nothing is removed; the OWNER still reads it). */
export async function DELETE(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    await archiveDocument(actor, params.id);
    return NextResponse.json({ ok: true });
  });
}
