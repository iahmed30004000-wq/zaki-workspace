import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AR } from "@/lib/i18n/dict";
import { ECONOMY_FORCED_OFF, FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { isPublicAddress, makeGuardedLookup, parseLocalBaseUrl, resolveAllPrivate, type Resolver } from "@/server/ai/local-host";
import { relaxApplies } from "@/server/services/assistant-provider";
import type { PublicSettings } from "@/server/services/owner-assistant-settings";

/**
 * «بوابة نموذج خارجية» — the owner allowed the gateway of his assistant to live on the internet. The internal rule is untouched (switch off); with the
 * outside rule an https address with a public NAME is accepted and its name must resolve to PUBLIC addresses only.
 */

const outside = (raw: unknown) => parseLocalBaseUrl(raw, { external: true });
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the outside rule: https and a public name, nothing else", () => {
  it("accepts the owner's own address as an origin, drops a trailing /v1, and marks it external", () => {
    for (const raw of ["https://glm.erv.zakiai.io/v1", "https://glm.erv.zakiai.io/v1/", "  https://GLM.erv.zakiai.io  ", "https://glm.erv.zakiai.io/"]) {
      const r = outside(raw);
      expect(r.ok, raw).toBe(true);
      if (r.ok) expect(r.target).toMatchObject({ origin: "https://glm.erv.zakiai.io", external: true, literal: false });
    }
    const port = outside("https://api.example.com:8443");
    expect(port.ok && port.target.origin).toBe("https://api.example.com:8443");
  });

  it("an internal address is judged first and stays internal (not external)", () => {
    const r = outside("http://hermes-agent:8642");
    expect(r.ok && r.target.external).toBeUndefined();
    const lan = outside("http://192.168.1.20:9000");
    expect(lan.ok && lan.target.external).toBeUndefined();
  });

  it("refuses plain http, IP addresses, other paths, credentials, queries and metadata names, even with the rule on", () => {
    for (const raw of [
      "http://glm.erv.zakiai.io",
      "https://8.8.8.8",
      "https://[2001:4860:4860::8888]",
      "https://169.254.169.254",
      "https://glm.erv.zakiai.io/api/v2",
      "https://glm.erv.zakiai.io/v1/chat",
      "https://user:pw@glm.erv.zakiai.io",
      "https://glm.erv.zakiai.io/?a=1",
      "https://glm.erv.zakiai.io/#x",
      "https://metadata.google.internal",
      "https://metadata.example.com",
      "https://instance-data.example.com",
      "ftp://glm.erv.zakiai.io",
      "https://",
      "",
    ]) {
      expect(outside(raw).ok, raw).toBe(false);
    }
    expect(outside(42).ok).toBe(false);
  });

  it("without the rule a public name is refused exactly as before", () => {
    const r = parseLocalBaseUrl("https://glm.erv.zakiai.io/v1");
    expect(r).toEqual({ ok: false, key: "assistant.local_url_invalid" });
    expect(parseLocalBaseUrl("https://glm.erv.zakiai.io")).toEqual({ ok: false, key: "assistant.local_url_public" });
  });
});

describe("a public address, and the socket of an outside service", () => {
  it("tells public from private, link-local, carrier-grade NAT, multicast and documentation ranges", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "95.216.10.20", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.1", "198.18.0.1", "203.0.113.9", "::1", "fd00:ec2::254", "fc00::1", "fe80::1", "2001:db8::1", "::ffff:10.0.0.1", "nonsense"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  const resolverOf = (...addresses: string[]): Resolver => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("an outside name must resolve to public addresses ONLY: a name that points inside, or half inside, is refused", async () => {
    expect((await resolveAllPrivate("glm.erv.zakiai.io", resolverOf("95.216.10.20"), true)).map((r) => r.address)).toEqual(["95.216.10.20"]);
    for (const bad of [["10.0.0.5"], ["127.0.0.1"], ["169.254.169.254"], ["95.216.10.20", "10.0.0.5"], []]) {
      await expect(resolveAllPrivate("glm.erv.zakiai.io", resolverOf(...bad), true), bad.join()).rejects.toMatchObject({ key: "assistant.err_local_host" });
    }
  });

  it("and the old rule is the other way round: an internal name must stay private", async () => {
    await expect(resolveAllPrivate("ollama", resolverOf("95.216.10.20"))).rejects.toMatchObject({ key: "assistant.err_local_host" });
    expect((await resolveAllPrivate("ollama", resolverOf("172.18.0.5"))).length).toBe(1);
  });

  it("the guarded lookup hands the socket only the public address it checked", async () => {
    const lookup = makeGuardedLookup(resolverOf("95.216.10.20"), true);
    const got = await new Promise<{ err: Error | null; address?: unknown; family?: number }>((resolve) => lookup("glm.erv.zakiai.io", {}, (err, address, family) => resolve({ err, address, family })));
    expect(got).toMatchObject({ err: null, address: "95.216.10.20", family: 4 });
    const refused = makeGuardedLookup(resolverOf("10.0.0.5"), true);
    const bad = await new Promise<{ err: Error | null }>((resolve) => refused("glm.erv.zakiai.io", {}, (err) => resolve({ err })));
    expect((bad.err as unknown as { key: string }).key).toBe("assistant.err_local_host");
  });
});

describe("privacy and the switch", () => {
  const settings = (gatewayBaseUrl: string): PublicSettings => ({ gatewayBaseUrl, gatewayConfirmedLocal: true, localRelaxRedaction: true }) as unknown as PublicSettings;

  it("an outside address is never «local»: the filter is not relaxed whatever is ticked; an internal one still can be", () => {
    expect(relaxApplies(settings("https://glm.erv.zakiai.io"), "openai")).toBe(false);
    expect(relaxApplies(settings("http://hermes-agent:8642"), "openai")).toBe(true);
  });

  it("is off by default (the questions leave the server), has its words, and economy mode does not own it", () => {
    expect(FEATURES).toContain("externalGateway");
    expect(FEATURE_DEFAULTS.externalGateway).toBe(false);
    expect(AR["features.externalGateway.name"]).toBeTruthy();
    expect(AR["features.externalGateway.hint"]).toContain("⚠️");
    expect(AR["features.externalGateway.hint"]).toContain("🔧");
    expect(AR["assistant.local_url_external_off"]).toContain("بوابة نموذج خارجية");
    expect(ECONOMY_FORCED_OFF as readonly string[]).not.toContain("externalGateway");
  });

  it("the screens show the reason of a refusal (the key in `details`), not only the generic line", () => {
    for (const file of ["src/components/owner-assistant/local-panel.tsx", "src/components/owner-assistant/settings-form.tsx"]) {
      const text = read(file);
      expect(text, file).toContain("err.details");
      expect(text, file).toContain("d.message");
    }
  });
});
