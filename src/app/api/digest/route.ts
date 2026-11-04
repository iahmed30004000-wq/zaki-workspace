import { NextResponse } from "next/server";
import { z } from "zod";
import { noStore, readJson, withAssistantApi } from "@/server/ai/api";
import { ValidationError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { morningDigest } from "@/server/services/digest";

const body = z.object({ refresh: z.boolean().optional() }).strict();

/**
 * «شو فاتني؟» — the catch-up card of «اليوم», for the signed-in person only.
 *
 *   POST { refresh? }  →  { text, empty, cached, generatedAt }
 *
 * The cached digest (under 3 hours, of today) is returned unless `refresh` is true («حدّث»). Everything it reads is what the person may
 * already read (src/server/services/digest.ts). Switch off, or a partner: 404. Refusals are `digest.err.*` keys (409 / 429).
 */
export async function POST(req: Request) {
  return withAssistantApi(async () => {
    const actor = await requireActor();
    const raw = await readJson(req).catch(() => ({}));
    const parsed = body.safeParse(raw ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: "validation.failed" })));
    return NextResponse.json(await morningDigest(actor, parsed.data), noStore);
  });
}
