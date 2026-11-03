import { NextResponse } from "next/server";
import { noStore, readJson, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { guideStep } from "@/server/services/site-guide";

/**
 * «المرشد» — ONE STEP. OWNER ONLY (everybody else: 404, the guide does not exist for them).
 *
 *   POST { message?, history[], snapshot{path,title,headings[],elements[{ref,role,name,value?,disabled?}]}, results?[], step }
 *   →    { say, actions[{type: navigate|highlight|click|type, …}], done }
 *
 * The answer is only a REQUEST to the owner's own browser: the browser asks him before every click and every typing and refuses what the
 * rules (src/lib/site-guide/rules.ts) do not allow. Nothing runs on the server.
 */
export async function POST(req: Request) {
  return withAssistantApi(async () => NextResponse.json(await guideStep(await requireActor(), await readJson(req)), noStore));
}
