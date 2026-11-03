import { parseLocalBaseUrl, type LocalTarget } from "@/server/ai/local-host";
import { isFeatureOn } from "@/server/services/features";

/**
 * The address of the OpenAI-compatible gateway, judged with the owner's switch «بوابة نموذج خارجية» (`externalGateway`, off by default).
 *
 *   switch off   exactly the old rule: an internal address only (his machine, a Docker / Coolify service name, a private network).
 *   switch on    an https address with a PUBLIC NAME is accepted too (a trailing `/v1` is dropped); its name must resolve to public
 *                addresses only, on every call (src/server/ai/local-host.ts). A model behind such an address is EXTERNAL: the privacy
 *                filter stays on and «أؤكد إن النموذج الخلفي محلي» never relaxes it (see `relaxApplies`).
 *
 * An address that would pass only with the switch on is refused with its own key, so the screen can say which switch to turn on.
 */
export type GatewayAddress = { ok: true; target: LocalTarget; external: boolean } | { ok: false; key: string };

export async function judgeGatewayAddress(orgId: string, raw: unknown): Promise<GatewayAddress> {
  const internal = parseLocalBaseUrl(raw);
  if (internal.ok) return { ok: true, target: internal.target, external: false };
  const outside = parseLocalBaseUrl(raw, { external: true });
  if (!outside.ok) return { ok: false, key: internal.key };
  if (!(await isFeatureOn(orgId, "externalGateway"))) return { ok: false, key: "assistant.local_url_external_off" };
  return { ok: true, target: outside.target, external: true };
}
