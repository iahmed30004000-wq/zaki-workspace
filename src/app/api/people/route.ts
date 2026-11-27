import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { directoryContext } from "@/app/api/_access";
import { staffDirectory } from "@/server/chat/directory";

/**
 * GET — THE STAFF DIRECTORY, for the phone (M2 N6): the very `staffDirectory` the page «الفريق» (`/members`) shows to a holder of
 * `directory.view` — the company's ACTIVE people (only those a «محصور بمساحة» viewer may meet), the owner first, each with title, rank and
 * e-mail as the page shows them. An external partner is refused (`guest.no_access`), and so is a person without `directory.view`.
 * Read-only: accounts are managed on the site's People screen.
 */
export async function GET() {
  return withApi(async () => {
    const ctx = await directoryContext();
    const people = await staffDirectory(ctx.orgId, ctx.orgRole, ctx.userId);
    return NextResponse.json({ people }, { headers: { "Cache-Control": "no-store" } });
  });
}
