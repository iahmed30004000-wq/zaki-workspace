import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { NotFoundError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { removeDevice } from "@/server/devices/devices";

/** DELETE: this phone is unpaired; its live line is refused at the next check. Only its own person removes it. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    if (!(await removeDevice(ctx.userId, params.id))) throw new NotFoundError("device.not_found");
    return NextResponse.json({ ok: true });
  });
}
