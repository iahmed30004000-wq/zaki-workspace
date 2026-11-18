import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { setAck } from "@/server/services/must-read";

/** «قرأت ✓»: POST writes the person's ✅ on a message that must be read, DELETE takes it back. Only the people the message must reach. */
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await setAck(await activeOrgCtx(), params.id, true)));
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await setAck(await activeOrgCtx(), params.id, false)));
}
