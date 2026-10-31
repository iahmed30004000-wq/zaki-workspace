import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { ValidationError } from "@/server/auth";
import { listDocRevisions, readDocRevision } from "@/server/services/documents";

/** The history, newest first; with `?version=N`, the full text of that one version. Never an external partner's. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const raw = new URL(req.url).searchParams.get("version");
    if (raw === null) return NextResponse.json(await listDocRevisions(actor, params.id));
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) throw new ValidationError([{ path: "version", message: "docs.e.version" }]);
    return NextResponse.json({ revision: await readDocRevision(actor, params.id, version) });
  });
}
