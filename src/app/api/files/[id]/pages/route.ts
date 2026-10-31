import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertMayReadFile, pdfPageCount } from "@/server/services/files";

/**
 * The page count of a PDF the caller may read (`{ pages: number | null }`; null: not a PDF, too big, or not readable from the
 * bytes). The same door as the bytes: never a guest, and a file of a space the person is not in (or of another conversation) is 404.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertMayReadFile(ctx, params.id);
    return NextResponse.json({ pages: await pdfPageCount(ctx.orgId, params.id) });
  });
}
