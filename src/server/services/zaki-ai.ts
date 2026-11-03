import { z } from "zod";
import { ValidationError } from "@/server/auth";
import { AiProviderError, isValidLocalModelId } from "@/server/ai/provider";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { judgeGatewayAddress } from "@/server/services/gateway-address";
import { probeOpenAiCompat } from "@/server/ai/openai-compat-provider";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { isFeatureOn } from "@/server/services/features";
import { getSettings, readGatewayKey, saveGatewayKey, updateSettings } from "@/server/services/owner-assistant-settings";

/**
 * «زاكي أي أي» — THE OWNER'S OWN AI AGENT, connected to the system, and the one question the control panel asks about it: «is it connected?».
 *
 * «زاكي أي أي» is the Hermes Agent the owner runs on his own server (Coolify service «Zaki-agent»). Hermes speaks the OpenAI-compatible dialect
 * (`/v1/models`, `/v1/chat/completions`) once its API server is switched on there, so it is connected through the existing OpenAI-compatible
 * gateway of «نموذج محلي» (src/server/ai/openai-compat-provider.ts): no second adapter, no second copy of the address guard, no second place
 * a key is kept. This file adds only the plain words around it: the status, and the «اربط» action that saves the three things and tests.
 *
 *   STATUS    `zakiAiStatus` asks the gateway for its list of models (`GET /v1/models`, with the saved Bearer key): that proves the service is
 *             there AND that it accepted the key, and it costs the agent nothing (no question, no tokens). The answer is kept for 30 seconds.
 *   CONNECT   `connectZakiAi` saves the address, the model name and (when given) the key, tests, and ONLY when the test passed makes the
 *             owner's assistant use it (`ownerProvider = "openai"`): a failed test never leaves the assistant pointed at nothing.
 *   PRIVACY   a gateway can forward to an outside API, so it is treated as an EXTERNAL model (the privacy filter stays on) until the owner
 *             ticks «أؤكد إن النموذج الخلفي محلي على سيرفري». The status says which of the two it is; it never decides it.
 *
 * ⚠️ The agent has its own tools and memory, and «connected» says only that it answers. 🔧 The key is write-only (saved encrypted, never
 *    returned), the address is judged by `parseLocalBaseUrl` before it is stored and on every call, and nothing here logs a key or an answer.
 */

/** What the screen suggests (the Coolify service's internal name and the model name Hermes lists). Typed values always win. */
export const SUGGESTED = { baseUrl: "http://hermes-agent:8642", model: "hermes-agent" } as const;

export type ZakiAiState = "connected" | "not_set" | "unreachable" | "model_missing";

export interface ZakiAiStatus {
  state: ZakiAiState;
  /** The owner's assistant answers through it (`ownerProvider` is the gateway). */
  inUse: boolean;
  /** «مساعد المالك» is switched on in «الميزات» (without it the agent is connected but nothing asks it). */
  assistantOn: boolean;
  /** The address (an origin) and the model name as saved, null when not. */
  baseUrl: string | null;
  model: string | null;
  hasKey: boolean;
  keyLast4: string | null;
  /** The owner ticked «the model behind it is local» (null: nothing is saved yet). */
  confirmedLocal: boolean | null;
  /** The models the service listed (a few, names only) and how long the list took. */
  models: string[];
  listMs: number | null;
  /** A dictionary key saying why it is not connected (null when connected or when nothing is saved). */
  reason: string | null;
  suggested: { baseUrl: string; model: string };
  /** Which parts the server's variables fix (ZAKI_GATEWAY_*); absent when none is fixed. */
  fixed?: { url: boolean; model: boolean; key: boolean };
  checkedAt: string;
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; sig: string; status: ZakiAiStatus }>();
const limiter = new FixedWindowLimiter({ limit: 20, windowMs: 60_000 });

/** Tests only. */
export function resetZakiAiCacheForTests(): void {
  cache.clear();
}

function unsaved(base: Omit<ZakiAiStatus, "state" | "reason" | "models" | "listMs" | "checkedAt">, now: Date): ZakiAiStatus {
  return { ...base, state: "not_set", reason: null, models: [], listMs: null, checkedAt: now.toISOString() };
}

/**
 * Is «زاكي أي أي» connected? `fresh` skips the 30-second memory (the «اختبر» button); it is limited to 20 calls a minute per company.
 * Asks only for the list of models, so it never costs the agent a question.
 */
export async function zakiAiStatus(orgId: string, opts: { fresh?: boolean; now?: Date } = {}): Promise<ZakiAiStatus> {
  const now = opts.now ?? new Date();
  const settings = await getSettings(orgId);
  const assistantOn = await isFeatureOn(orgId, "ownerAssistant");
  const base = {
    inUse: settings.ownerProvider === "openai",
    assistantOn,
    baseUrl: settings.gatewayBaseUrl,
    model: settings.gatewayModel,
    hasKey: settings.hasGatewayKey,
    keyLast4: settings.gatewayKeyLast4,
    // an outside address is never «local», whatever was ticked before: the screen must not say the filter is relaxed for it
    confirmedLocal: settings.gatewayBaseUrl ? settings.gatewayConfirmedLocal && parseLocalBaseUrl(settings.gatewayBaseUrl).ok : null,
    suggested: { ...SUGGESTED },
    ...(settings.gatewayFixed ? { fixed: settings.gatewayFixed } : {}),
  };
  if (!settings.gatewayBaseUrl || !settings.gatewayModel) return unsaved(base, now);
  const checked = await judgeGatewayAddress(orgId, settings.gatewayBaseUrl);
  if (!checked.ok) return { ...unsaved(base, now), state: "unreachable", reason: checked.key };

  // what the answer depends on: a changed address, model or key is a new question
  const sig = [settings.gatewayBaseUrl, settings.gatewayModel, settings.gatewayKeyLast4 ?? "", settings.ownerProvider, assistantOn ? "1" : "0", settings.gatewayConfirmedLocal ? "1" : "0"].join("|");
  const hit = cache.get(orgId);
  if (!opts.fresh && hit && hit.sig === sig && now.getTime() - hit.at < TTL_MS) return hit.status;
  if (!limiter.check(`zakiai.${orgId}`).ok) return hit?.status ?? { ...unsaved(base, now), state: "unreachable", reason: "assistant.local_test_rate" };
  limiter.hit(`zakiai.${orgId}`);

  const apiKey = settings.hasGatewayKey ? ((await readGatewayKey(orgId)) ?? "") : "";
  let status: ZakiAiStatus;
  try {
    const probe = await probeOpenAiCompat({ baseUrl: checked.target.origin, model: null, apiKey, external: checked.external });
    const missing = probe.models.length > 0 && !probe.models.includes(settings.gatewayModel) && !probe.models.includes(`${settings.gatewayModel}:latest`);
    status = { ...base, state: missing ? "model_missing" : "connected", reason: missing ? "assistant.err_local_missing" : null, models: probe.models.slice(0, 10), listMs: probe.listMs, checkedAt: now.toISOString() };
  } catch (err) {
    status = { ...base, state: "unreachable", reason: err instanceof AiProviderError ? err.key : "assistant.err_bad_answer", models: [], listMs: null, checkedAt: now.toISOString() };
  }
  cache.set(orgId, { at: now.getTime(), sig, status });
  return status;
}

// ───────────────────────────────────────── «اربط» ─────────────────────────────────────────

const connectSchema = z
  .object({
    /** Left out: the saved one (or the one the server's variables fix). */
    baseUrl: z.string().trim().min(1, "assistant.local_url_invalid").max(200, "assistant.local_url_invalid").optional(),
    model: z.string().trim().min(1, "assistant.local_model_invalid").max(160, "assistant.local_model_invalid").refine(isValidLocalModelId, "assistant.local_model_invalid").optional(),
    /** The Bearer key (the agent's API key). Left out: the saved one stays. */
    key: z.string().max(400, "assistant.key_invalid").optional(),
    /** «أؤكد إن النموذج الخلفي محلي على سيرفري». */
    confirmLocal: z.boolean().optional(),
  })
  .strict();

export type ConnectInput = z.infer<typeof connectSchema>;

/**
 * The owner presses «اربط واختبر»: the address, the model name and (when given) the key are saved, the connection is tested, and when it
 * works the owner's assistant starts to use it. A refusal of the address, the model name or the key is a 422 with a dictionary key and
 * nothing is changed by it. A test that fails leaves what was saved (so the owner can fix the service and press the button again) and does
 * NOT switch the assistant over.
 */
export async function connectZakiAi(ctx: { orgId: string; userId: string }, body: unknown): Promise<ZakiAiStatus> {
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ValidationError([{ path: first?.path.join(".") || "body", message: first && first.message.startsWith("assistant.") ? first.message : "validation.failed" }]);
  }
  const input = parsed.data;
  const before = await getSettings(ctx.orgId);
  const baseUrl = input.baseUrl ?? before.gatewayBaseUrl;
  const model = input.model ?? before.gatewayModel;
  if (!baseUrl) throw new ValidationError([{ path: "baseUrl", message: "assistant.local_url_invalid" }]);
  if (!model) throw new ValidationError([{ path: "model", message: "assistant.local_model_invalid" }]);
  const checked = await judgeGatewayAddress(ctx.orgId, baseUrl);
  if (!checked.ok) throw new ValidationError([{ path: "baseUrl", message: checked.key }]);

  if (input.key !== undefined && input.key.trim() !== "") await saveGatewayKey(ctx, input.key.trim());
  await updateSettings(ctx, {
    gatewayBaseUrl: checked.target.origin,
    gatewayModel: model,
    ...(input.confirmLocal !== undefined ? { gatewayConfirmedLocal: input.confirmLocal } : {}),
  });
  cache.delete(ctx.orgId);

  const status = await zakiAiStatus(ctx.orgId, { fresh: true });
  if (status.state !== "connected") return status;
  const current = await getSettings(ctx.orgId);
  // the server's variables make it THE internal model: both assistants (the owner's and «@المساعد») use it; typed by hand, only the owner's
  const both = current.gatewayFixed?.url === true && current.gatewayFixed.model === true;
  const switchOver = { ...(current.ownerProvider !== "openai" ? { ownerProvider: "openai" as const } : {}), ...(both && current.chatProvider !== "openai" ? { chatProvider: "openai" as const } : {}) };
  if (Object.keys(switchOver).length > 0) await updateSettings(ctx, switchOver);
  cache.delete(ctx.orgId);
  return zakiAiStatus(ctx.orgId, { fresh: true });
}
