import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { storageMeter } from "@/server/services/storage";

/** GET: the storage meter (how much the server holds, how much Google Drive holds, whether Drive is connected). The OWNER's alone. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await storageMeter(ctx));
  });
}
