import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { isValidLocalModelId } from "@/server/ai/provider";

/**
 * «بوابة ثابتة من السيرفر» — the gateway of the owner's assistant, fixed by VARIABLES of the server instead of typed on a screen.
 *
 *   ZAKI_GATEWAY_URL       the address (an origin; a trailing `/v1` is dropped). Judged by the same rule as a typed one
 *                          (src/server/ai/local-host.ts): an outside https address still needs the owner's switch «بوابة نموذج خارجية».
 *   ZAKI_GATEWAY_MODEL     the model name the gateway serves (e.g. `auto/best-chat`).
 *   ZAKI_GATEWAY_API_KEY   the gateway's Bearer key. The owner puts it into the server's variable himself; it is never written into the
 *                          database, never shown (the screen shows only its last four characters) and never returned by any route.
 *
 * Each one is independent and optional; an empty or invalid value counts as «not set» (the saved setting stays in force). A value that IS set
 * wins over the saved one and the screen shows it as fixed: it cannot be changed from there, so it cannot drift.
 */

export interface GatewayEnv {
  baseUrl: string | null;
  model: string | null;
  key: string | null;
}

/** The gateway's key: printable ASCII with no space, 8 to 400 characters (a local gateway's key may be short). */
export function validGatewayKeyText(key: unknown): key is string {
  return typeof key === "string" && /^[\x21-\x7E]{8,400}$/.test(key);
}

export function gatewayEnv(source: Readonly<Record<string, string | undefined>> = process.env): GatewayEnv {
  const rawUrl = (source["ZAKI_GATEWAY_URL"] ?? "").trim();
  const parsed = rawUrl === "" ? null : parseLocalBaseUrl(rawUrl, { external: true });
  const model = (source["ZAKI_GATEWAY_MODEL"] ?? "").trim();
  const key = (source["ZAKI_GATEWAY_API_KEY"] ?? "").trim();
  return {
    baseUrl: parsed && parsed.ok ? parsed.target.origin : null,
    model: model !== "" && isValidLocalModelId(model) ? model : null,
    key: validGatewayKeyText(key) ? key : null,
  };
}
