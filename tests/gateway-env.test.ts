import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AR } from "@/lib/i18n/dict";
import { gatewayEnv, validGatewayKeyText } from "@/server/services/gateway-env";
import { validGatewayKey } from "@/server/services/owner-assistant-settings";

/** «بوابة ثابتة من السيرفر»: ZAKI_GATEWAY_URL / _MODEL / _API_KEY, each optional, each judged like a typed value, none of them ever shown. */

const KEY = "gw-env-KEY-never-appears-0123456789"; // scan-secrets:ignore

describe("the variables of the server", () => {
  it("nothing set, or only blanks: nothing is fixed", () => {
    expect(gatewayEnv({})).toEqual({ baseUrl: null, model: null, key: null });
    expect(gatewayEnv({ ZAKI_GATEWAY_URL: "  ", ZAKI_GATEWAY_MODEL: "", ZAKI_GATEWAY_API_KEY: " " })).toEqual({ baseUrl: null, model: null, key: null });
  });

  it("the address is normalised to an origin (the /v1 is dropped), the model and the key are trimmed", () => {
    expect(gatewayEnv({ ZAKI_GATEWAY_URL: "https://glm.erv.zakiai.io/v1", ZAKI_GATEWAY_MODEL: " auto/best-chat ", ZAKI_GATEWAY_API_KEY: ` ${KEY} ` })).toEqual({
      baseUrl: "https://glm.erv.zakiai.io",
      model: "auto/best-chat",
      key: KEY,
    });
    expect(gatewayEnv({ ZAKI_GATEWAY_URL: "http://hermes-agent:8642" }).baseUrl).toBe("http://hermes-agent:8642");
  });

  it("a value that is not valid counts as not set: plain http on the internet, a path, an IP address, a bad model, a short or spaced key", () => {
    for (const bad of ["http://glm.erv.zakiai.io", "https://glm.erv.zakiai.io/api", "https://8.8.8.8", "https://169.254.169.254", "not a url"]) {
      expect(gatewayEnv({ ZAKI_GATEWAY_URL: bad }).baseUrl, bad).toBeNull();
    }
    for (const bad of ["../x", "a b", "x".repeat(200)]) expect(gatewayEnv({ ZAKI_GATEWAY_MODEL: bad }).model, bad).toBeNull();
    for (const bad of ["short", "has space in it 123", "ب".repeat(12), "k".repeat(401)]) expect(gatewayEnv({ ZAKI_GATEWAY_API_KEY: bad }).key, bad).toBeNull();
  });

  it("the key rule is the one the screen's key box has always had", () => {
    for (const k of ["12345678", KEY, "a".repeat(400)]) expect(validGatewayKeyText(k) && validGatewayKey(k)).toBe(true);
    for (const k of ["1234567", "a".repeat(401), "a b c d e f g h", "", 5, null]) expect(validGatewayKeyText(k) || validGatewayKey(k)).toBe(false);
  });

  it("its words exist, and the screen shows a fixed value as fixed", () => {
    expect(AR["assistant.gateway_fixed"]).toBeTruthy();
    expect(AR["localai.gateway.fixed_note"]).toBeTruthy();
    const panel = readFileSync(join(process.cwd(), "src/components/owner-assistant/local-panel.tsx"), "utf8");
    expect(panel).toContain("saved.gatewayFixed?.url === true");
    expect(panel).toContain("saved.gatewayFixed?.model === true");
    expect(panel).toContain("saved.gatewayFixed?.key");
  });
});
