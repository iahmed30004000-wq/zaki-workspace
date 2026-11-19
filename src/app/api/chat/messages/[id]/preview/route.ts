import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { removeLinkPreview } from "@/server/chat/messages";

/**
 * DELETE /api/chat/messages/[id]/preview — «شيل المعاينة»: the AUTHOR takes the link card off their own message (C3b.2). Anybody else: 403, and a person who may not read
 * the message: 404. The words stay, the message is not marked edited, the other screens are told. Switch `linkPreviews` off: 404. Answers `{ removed }`.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await removeLinkPreview(ctx, params.id));
  });
}
