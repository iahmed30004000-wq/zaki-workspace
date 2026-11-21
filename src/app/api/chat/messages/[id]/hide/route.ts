import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { hideMessageForMe } from "@/server/chat/hidden-messages";

/**
 * POST (S5.7, «حذف عندي»): hide ONE message for the person who asks, and for nobody else. Any message they can read (their own or somebody else's); a message of a
 * conversation they cannot read is a 404 and nothing is written. The message itself, the owner's archive and who may delete for everybody are not touched. The company's
 * switch `chatLayoutV2` first (off: 404). Answers `{ hidden: true }`; asking twice is the same answer.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await hideMessageForMe(ctx, params.id));
  });
}

export const dynamic = "force-dynamic";
