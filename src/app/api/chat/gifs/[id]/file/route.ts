import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { openSavedGif } from "@/server/chat/gifs";
import { bytesResponse } from "@/server/files/bytes-response";

/** GET: the bytes of one of MY kept GIFs, judged again on every request: my row, and a file I may have now. Anything else is «not found». */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return bytesResponse(req, await openSavedGif(ctx, params.id));
  });
}

export const dynamic = "force-dynamic";
