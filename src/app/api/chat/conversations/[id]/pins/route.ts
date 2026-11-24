import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { unpinAll } from "@/server/chat/messages";

/** DELETE: «إلغاء تثبيت الكل» — every pinned message of the conversation at once, by whoever may pin there (service-enforced). Answers `{ unpinned }`. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await unpinAll(ctx, params.id), { headers: { "cache-control": "no-store" } });
  });
}
