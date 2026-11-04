import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { answerReadText } from "@/server/services/image-ocr-route";

/**
 * POST /api/files/[id]/text — «اقرا النص»: the words inside a library picture, read by the vision service the owner set up and kept for
 * search. Whoever may open the file may ask (`assertMayReadFile` + the guest rules, in the service); the switch `imageOcr` off, or a file the
 * person cannot open, is 404; a guest is 403. Body `{ "again": true }` reads it again.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => answerReadText(req, await requireActor(), params.id));
}
