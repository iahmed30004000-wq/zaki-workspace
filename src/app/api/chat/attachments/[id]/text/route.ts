import { withApi } from "@/server/api";
import { NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import { requireActor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { answerReadText } from "@/server/services/image-ocr-route";

/**
 * POST /api/chat/attachments/[id]/text — «اقرا النص» under a chat picture (the id is the ATTACHMENT's, as in the sibling routes). It maps to
 * the stored file and goes through the same gate as the library: the conversation of the message must be readable by the person, and must
 * reach no guest. A message not sent yet, another company's attachment, anything unreadable: 404.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    await assertFeatureOn(actor.orgId, "imageOcr");
    const att = await db.messageAttachment.findFirst({
      where: { id: params.id, messageId: { not: null }, file: { orgId: actor.orgId, deletedAt: null } },
      select: { fileId: true },
    });
    if (!att) throw new NotFoundError("imageOcr.not_found");
    return answerReadText(req, actor, att.fileId);
  });
}
