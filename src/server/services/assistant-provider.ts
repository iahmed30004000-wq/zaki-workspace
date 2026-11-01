import type { ProviderConfig, ProviderKind } from "@/server/ai/registry";
import { readGatewayKey, readKey, type PublicSettings } from "@/server/services/owner-assistant-settings";
import { parseLocalBaseUrl } from "@/server/ai/local-host";

/**
 * «نموذج محلي» — WHICH MODEL ANSWERS, in one place. Both assistants («مساعد المالك» and «@المساعد» في الدردشة) ask `resolveProvider` and
 * get the provider config plus the one privacy decision that depends on it: `relax`.
 *
 *   PRIVACY BY PROVIDER
 *     claude   the external model. Redaction is exactly what it always was; `relax` is false whatever any switch says.
 *     ollama   a service the owner runs on his own server (address judged by local-host.ts). Redaction stays ON unless the owner turned on
 *              «خفّف التنقية للنموذج المحلي» (`localRelaxRedaction`).
 *     openai   an OpenAI-compatible gateway. A gateway can forward to an outside API, so it is treated as EXTERNAL until the owner ticks
 *              «أؤكد إن النموذج الخلفي محلي على سيرفري» (`gatewayConfirmedLocal`): redaction stays on, and the relaxed filter needs the
 *              confirmation AND the switch.
 *   In every case secrets, tokens and long identifiers are still masked (src/server/ai/redact.ts, `redactTextRelaxed`), and the chat
 *   assistant still refuses a conversation that has a guest in it.
 *
 * ⚠️ «Local» is as true as the owner's word and the address: a private address cannot prove that a model never forwards its questions.
 * 🔧 The screen says so next to both switches, redaction is on by default, and the first answer of a chat names the model that read it.
 */

export type AssistantSlot = "owner" | "chat";

export interface ResolvedProvider {
  kind: ProviderKind;
  model: string;
  config: ProviderConfig;
  /** The relaxed privacy filter applies to this call. Only ever true for a local model with the owner's switch (and, for a gateway, his confirmation). */
  relax: boolean;
}

export const providerOfSlot = (settings: PublicSettings, slot: AssistantSlot): ProviderKind => (slot === "owner" ? settings.ownerProvider : settings.chatProvider);

/** Is the chosen provider ready to be called, as far as the settings say (the key / the address and the model)? */
export function providerReady(settings: PublicSettings, slot: AssistantSlot): boolean {
  const kind = providerOfSlot(settings, slot);
  if (kind === "ollama") return settings.localBaseUrl !== null && settings.localModel !== null && parseLocalBaseUrl(settings.localBaseUrl).ok;
  if (kind === "openai") return settings.gatewayBaseUrl !== null && settings.gatewayModel !== null && parseLocalBaseUrl(settings.gatewayBaseUrl).ok;
  return settings.hasKey;
}

/** Whether the relaxed filter may be used with this provider. Pure: the whole privacy rule of the provider choice is this function. */
export function relaxApplies(settings: PublicSettings, kind: ProviderKind): boolean {
  if (kind === "ollama") return settings.localRelaxRedaction;
  if (kind === "openai") return settings.localRelaxRedaction && settings.gatewayConfirmedLocal;
  return false;
}

/** The provider for one assistant, or null when it is not ready (the caller answers «no key» / «no local model» in its own words). */
export async function resolveProvider(orgId: string, settings: PublicSettings, slot: AssistantSlot): Promise<ResolvedProvider | null> {
  const kind = providerOfSlot(settings, slot);
  if (!providerReady(settings, slot)) return null;
  if (kind === "ollama") {
    return { kind, model: settings.localModel as string, relax: relaxApplies(settings, kind), config: { kind, apiKey: "", model: settings.localModel as string, baseUrl: settings.localBaseUrl as string } };
  }
  if (kind === "openai") {
    const apiKey = settings.hasGatewayKey ? ((await readGatewayKey(orgId)) ?? "") : "";
    return { kind, model: settings.gatewayModel as string, relax: relaxApplies(settings, kind), config: { kind, apiKey, model: settings.gatewayModel as string, baseUrl: settings.gatewayBaseUrl as string } };
  }
  const apiKey = await readKey(orgId);
  if (!apiKey) return null;
  return { kind: "claude", model: settings.model, relax: false, config: { apiKey, model: settings.model } };
}

export const isLocalKind = (kind: ProviderKind): boolean => kind !== "claude";
