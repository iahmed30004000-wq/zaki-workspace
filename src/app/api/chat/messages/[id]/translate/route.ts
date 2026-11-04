import { NextResponse } from "next/server";
import { apiError, withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { translateMessage, TranslateError } from "@/server/services/message-translate";

/**
 * POST /api/chat/messages/[id]/translate — «ترجم»: the translation of ONE text message into Arabic (or English when the text is mostly Arabic),
 * returned to the asker and never stored or posted. Whoever may read the conversation (staff only) may ask; the switch `messageTranslate` (or
 * the assistant's switches) off, or a message the person cannot read, is 404. A refusal is a dictionary key in `message`; a guest in the
 * conversation is 403 `translate.err_guest`.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    try {
      const result = await translateMessage(actor, params.id);
      return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof TranslateError) return apiError(err.code, err.key);
      throw err;
    }
  });
}
