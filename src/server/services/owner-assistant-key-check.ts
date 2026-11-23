import { AiProviderError, type AiErrorKey } from "@/server/ai/provider";
import { makeProvider } from "@/server/ai/registry";
import { getSettings, readKey } from "@/server/services/owner-assistant-settings";
import type { AssistantAccess } from "@/server/services/owner-assistant-access";

/**
 * «افحص المفتاح»: asks the provider, with the key already saved, whether it still accepts it — ONE request of a few tokens, never counted against the owner's limits.
 * The answer is `{ ok: true }` or `{ ok: false, reason }` where `reason` is a dictionary key (`assistant.no_key`, or the provider's refusal as `AiErrorKey`): never the
 * provider's own words and never the key. Only the saved Claude key is checked here (a local model has its own «اختبر الاتصال»).
 */
export type KeyCheck = { ok: true } | { ok: false; reason: AiErrorKey | "assistant.no_key" };

export async function checkSavedKey(access: AssistantAccess): Promise<KeyCheck> {
  const settings = await getSettings(access.orgId);
  const apiKey = settings.hasKey ? await readKey(access.orgId) : null;
  if (!apiKey) return { ok: false, reason: "assistant.no_key" };
  try {
    await makeProvider({ apiKey, model: settings.model }).complete({ system: "Reply with one word.", messages: [{ role: "user", content: "ping" }], maxTokens: 4 });
    return { ok: true };
  } catch (err) {
    if (err instanceof AiProviderError) return { ok: false, reason: err.key };
    return { ok: false, reason: "assistant.err_network" };
  }
}
