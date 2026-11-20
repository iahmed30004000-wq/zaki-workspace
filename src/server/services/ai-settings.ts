import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { MODEL_CHOICES, getSettings, usageSummary, type PublicSettings, type UsageSummary } from "@/server/services/owner-assistant-settings";

/**
 * THE AI CONNECTION — ONE PLACE (A2.1). The two forms the owner used to find, the gateway form of «زاكي أي أي» (`/api/control-panel/ai`) and the key / model / limits / local
 * model / gateway form of «مساعد المالك» (`/api/owner-assistant/*`), wrote the SAME row (`AiSettings`, through `owner-assistant-settings.ts`); there is still ONE row and ONE
 * writer. This is the one READ the screen of «التكاملات» › «الذكاء الاصطناعي» makes: the public settings (the key is write-only: `hasKey` and four characters, never the cipher),
 * the usage and the models the form offers. The OWNER's alone (the owner and his partners) while the owner's assistant is on: anybody else gets null and the part is not drawn.
 * Reading writes nothing.
 */
export interface AiPlace {
  settings: PublicSettings;
  usage: UsageSummary;
  models: readonly string[];
}

export async function loadAiPlace(actor: Actor): Promise<AiPlace | null> {
  let orgId: string;
  try {
    orgId = (await assistantAccess(actor)).orgId;
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
  const settings = await getSettings(orgId);
  return { settings, usage: await usageSummary(orgId, settings), models: MODEL_CHOICES };
}
