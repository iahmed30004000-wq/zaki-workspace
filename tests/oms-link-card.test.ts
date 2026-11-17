import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AR } from "../src/lib/i18n/dict";
import { omsErrorKey } from "../src/components/oms-link-card";
import { FEATURES } from "../src/lib/features";

/**
 * Q1.0: the owner's card. Every sentence it prints exists in the dictionary (Arabic only), every failure code the client can raise
 * has its sentence, and the token never reaches the page.
 */
const SOURCE = readFileSync(new URL("../src/components/oms-link-card.tsx", import.meta.url), "utf8");
const dict = AR as Record<string, string>;

describe("the link card's sentences", () => {
  it("every key the card prints is in the dictionary", () => {
    const keys = [...SOURCE.matchAll(/\bt\("(oms\.[A-Za-z_.]+)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(15);
    expect(keys.filter((k) => !dict[k])).toEqual([]);
  });
  it("every failure code the client can raise has a sentence", () => {
    const codes = ["no_base_url", "url_invalid", "url_https_only", "url_credentials", "url_private", "url_unresolvable", "no_token", "timeout", "network", "redirect", "bad_body", "http_401", "http_403", "http_404", "http_429", "http_500", "http_503"];
    for (const code of codes) expect(dict[omsErrorKey(code)], code).toBeTruthy();
  });
  it("an unknown or missing code says the common error, never the code", () => {
    expect(omsErrorKey(null)).toBe("common.error");
    expect(omsErrorKey("http_5xx")).toBe("oms.error.http_5xx");
  });
  it("every 5xx shares one sentence", () => {
    expect(omsErrorKey("http_502")).toBe("oms.error.http_5xx");
    expect(omsErrorKey("http_599")).toBe("oms.error.http_5xx");
  });
  it("the switch has its name and its hint", () => {
    expect(FEATURES).toContain("omsLink");
    expect(dict["features.omsLink.name"]).toBeTruthy();
    expect(dict["features.omsLink.hint"]).toBeTruthy();
  });
});

describe("the token", () => {
  it("is a password field that is cleared after a save, and the status never carries it", () => {
    expect(SOURCE).toMatch(/type="password"/);
    expect(SOURCE).toMatch(/setToken\(""\)/);
    // the answer's type has no token field
    expect(SOURCE.slice(SOURCE.indexOf("interface OmsAnswer"), SOURCE.indexOf("type TFn"))).not.toMatch(/\btoken:/);
  });
});
