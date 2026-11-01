import { z } from "zod";
import { ValidationError } from "@/server/auth";
import { AssistantError } from "@/server/ai/api";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { probeOllama, type ProbeResult } from "@/server/ai/local-provider";
import { probeOpenAiCompat } from "@/server/ai/openai-compat-provider";
import { isValidLocalModelId } from "@/server/ai/provider";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { readGatewayKey, getSettings } from "@/server/services/owner-assistant-settings";
import type { AssistantAccess } from "@/server/services/owner-assistant-access";

/**
 * «اختبر الاتصال» — the button of the local model's settings. OWNER ONLY (the route asks `assistantAccess`). It lists the models the
 * service has installed and, if the model the owner named is among them, asks it for 5 tokens and times the answer.
 *
 *   - It tests what the owner typed (the form's current values) or, when he sends nothing, what is saved. Either way the address is
 *     judged by `parseLocalBaseUrl` first and the socket by the guarded lookup: this button is not a way to make the server call a public
 *     address, a metadata address or an arbitrary internal path.
 *   - The answer holds the model NAMES the service listed (each one a short, checked token), two timings and, for a ping that failed,
 *     a dictionary KEY. Never the body of any answer, never an address from the network, never the gateway's key.
 *   - It does not count in the usage meter (no question of the owner's is behind it), and the ping goes through the same one-at-a-time
 *     queue as everything else, so it cannot overrun the CPU. At most 10 tests a minute per company.
 */

export const TEST_LIMIT_PER_MINUTE = 10;
export const testLimiter = new FixedWindowLimiter({ limit: TEST_LIMIT_PER_MINUTE, windowMs: 60_000 });

const bodySchema = z
  .object({
    provider: z.enum(["ollama", "openai"], { errorMap: () => ({ message: "assistant.provider_invalid" }) }),
    baseUrl: z.string().max(200, "assistant.local_url_invalid").nullish(),
    model: z.string().max(160, "assistant.local_model_invalid").nullish(),
  })
  .strict();

export interface TestResult extends ProbeResult {
  provider: "ollama" | "openai";
}

export async function testLocalConnection(access: AssistantAccess, body: unknown): Promise<TestResult> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ValidationError([{ path: first?.path.join(".") || "body", message: first && first.message.startsWith("assistant.") ? first.message : "validation.failed" }]);
  }
  if (!testLimiter.check(`localtest.${access.orgId}`).ok) throw new AssistantError("assistant.local_test_rate", "rate_limited");
  testLimiter.hit(`localtest.${access.orgId}`);

  const { provider } = parsed.data;
  const settings = await getSettings(access.orgId);
  const typedUrl = parsed.data.baseUrl?.trim();
  const baseUrl = typedUrl ? typedUrl : provider === "ollama" ? settings.localBaseUrl : settings.gatewayBaseUrl;
  if (!baseUrl) throw new ValidationError([{ path: "baseUrl", message: "assistant.local_incomplete" }]);
  const checked = parseLocalBaseUrl(baseUrl);
  if (!checked.ok) throw new ValidationError([{ path: "baseUrl", message: checked.key }]);
  const typedModel = parsed.data.model?.trim();
  const model = typedModel ? typedModel : provider === "ollama" ? settings.localModel : settings.gatewayModel;
  if (model && !isValidLocalModelId(model)) throw new ValidationError([{ path: "model", message: "assistant.local_model_invalid" }]);

  if (provider === "ollama") return { provider, ...(await probeOllama({ baseUrl: checked.target.origin, model: model ?? null })) };
  const apiKey = settings.hasGatewayKey ? ((await readGatewayKey(access.orgId)) ?? "") : "";
  return { provider, ...(await probeOpenAiCompat({ baseUrl: checked.target.origin, model: model ?? null, apiKey })) };
}
