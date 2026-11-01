import { describe, expect, it } from "vitest";
import { AiProviderError } from "@/server/ai/provider";
import { isInternalName, isPrivateAddress, makeGuardedLookup, parseLocalBaseUrl, resolvePrivate, type Resolver } from "@/server/ai/local-host";

/**
 * «نموذج محلي» — the lock on the address (src/server/ai/local-host.ts). The address is typed by the owner and the server connects to it:
 * an ALLOW-LIST of internal hosts, never a block-list. Every public host, every metadata address and every sneaky spelling is refused,
 * at save time (`parseLocalBaseUrl`) and at connection time (`resolvePrivate`, `makeGuardedLookup`).
 */

const accepted = (raw: string) => {
  const r = parseLocalBaseUrl(raw);
  if (!r.ok) throw new Error(`${raw} was refused: ${r.key}`);
  return r.target;
};
const refusedAs = (raw: unknown) => {
  const r = parseLocalBaseUrl(raw);
  return r.ok ? "accepted" : r.key;
};

describe("addresses that are accepted (and normalised to an origin)", () => {
  it.each([
    ["http://ollama:11434", "http://ollama:11434"],
    ["http://ollama:11434/", "http://ollama:11434"],
    ["  http://OLLAMA:11434  ", "http://ollama:11434"],
    ["http://localhost:11434", "http://localhost:11434"],
    ["http://127.0.0.1:11434", "http://127.0.0.1:11434"],
    ["http://127.5.6.7:8080", "http://127.5.6.7:8080"],
    ["http://[::1]:11434", "http://[::1]:11434"],
    ["http://10.0.0.5:11434", "http://10.0.0.5:11434"],
    ["http://172.16.0.9:11434", "http://172.16.0.9:11434"],
    ["http://172.31.255.254:11434", "http://172.31.255.254:11434"],
    ["http://192.168.1.20:11434", "http://192.168.1.20:11434"],
    ["http://[fd12:3456:789a::1]:11434", "http://[fd12:3456:789a::1]:11434"],
    ["http://[::ffff:192.168.1.5]:11434", "http://[::ffff:c0a8:105]:11434"],
    ["https://ollama.internal", "https://ollama.internal"],
    ["http://ollama.lan:11434", "http://ollama.lan:11434"],
    ["http://box.local:11434", "http://box.local:11434"],
    ["http://ollama.zaki-net.internal:11434", "http://ollama.zaki-net.internal:11434"],
    ["http://ollama", "http://ollama"],
    ["http://ollama-service_1:11434", "http://ollama-service_1:11434"],
  ])("%s", (raw, origin) => {
    expect(accepted(raw).origin).toBe(origin);
  });

  it("the port is the default of the scheme when not written", () => {
    expect(accepted("http://ollama").port).toBe(80);
    expect(accepted("https://ollama.internal").port).toBe(443);
    expect(accepted("http://ollama:11434").port).toBe(11434);
  });
});

describe("addresses that are refused", () => {
  it.each([
    "http://8.8.8.8:11434",
    "http://1.1.1.1",
    "https://api.openai.com",
    "https://api.anthropic.com",
    "http://example.com:11434",
    "http://ollama.example.com",
    "http://ollama.com",
    "http://172.15.0.1", // just below 172.16/12
    "http://172.32.0.1", // just above it
    "http://192.169.0.1",
    "http://11.0.0.1",
    "http://[2001:4860:4860::8888]",
    "http://[2606:4700::1111]",
    "http://[fe80::1]", // link-local
  ])("a public address %s is refused as public", (raw) => {
    expect(refusedAs(raw)).toBe("assistant.local_url_public");
  });

  it.each([
    "http://169.254.169.254", // the cloud metadata address
    "http://169.254.0.1:80",
    "http://100.100.100.200", // Alibaba's metadata, inside the carrier-grade NAT range
    "http://100.64.0.1",
    "http://[fd00:ec2::254]", // AWS's IPv6 metadata address, inside fc00::/7
    "http://[::ffff:169.254.169.254]", // IPv4-mapped metadata
    "http://[::ffff:8.8.8.8]",
    "http://0.0.0.0:11434",
    "http://224.0.0.1",
    "http://255.255.255.255",
    "http://metadata",
    "http://metadata.google.internal",
    "http://metadata.internal",
    "http://metadata.local",
    "http://instance-data",
    "http://instance-data.internal",
  ])("a metadata or non-private address %s is refused", (raw) => {
    expect(refusedAs(raw)).toBe("assistant.local_url_public");
  });

  it("a metadata address with a path is refused too (as a path, before it is even a host question)", () => {
    expect(refusedAs("http://169.254.169.254/latest/meta-data")).not.toBe("accepted");
  });

  it("numeric spellings are judged as the address they really are", () => {
    // the URL parser normalises them first: 2130706433 is 127.0.0.1 (fine), 2852039166 is 169.254.169.254 (not)
    expect(refusedAs("http://2852039166")).toBe("assistant.local_url_public");
    expect(refusedAs("http://0xa9fea9fe")).toBe("assistant.local_url_public");
    expect(refusedAs("http://0251.0376.0251.0376")).toBe("assistant.local_url_public");
    expect(refusedAs("http://169.254.169.254.")).toBe("assistant.local_url_public");
    expect(refusedAs("http://134744072")).toBe("assistant.local_url_public"); // 8.8.8.8
    expect(accepted("http://2130706433").hostname).toBe("127.0.0.1");
  });

  it("a name that only LOOKS internal is refused: the suffix must be the whole last label", () => {
    expect(refusedAs("http://evil.com/.internal")).toBe("assistant.local_url_invalid");
    expect(refusedAs("http://localhost.evil.com")).toBe("assistant.local_url_public");
    expect(refusedAs("http://xinternal")).toBe("accepted"); // a single label is a service name: judged again when it is resolved
    expect(refusedAs("http://ollama.internal.evil.com")).toBe("assistant.local_url_public");
    expect(refusedAs("http://a.b.local.com")).toBe("assistant.local_url_public");
  });

  it.each([
    ["ftp://ollama:21"],
    ["file:///etc/passwd"],
    ["gopher://ollama"],
    ["javascript:alert(1)"],
    ["ollama:11434"],
    ["//ollama"],
    ["ollama"],
    [""],
    ["   "],
    ["http://"],
    ["http://user:pass@ollama:11434"],
    ["http://user@ollama:11434"],
    ["http://ollama:11434/api/chat"],
    ["http://ollama:11434/v1"],
    ["http://ollama:11434?x=1"],
    ["http://ollama:11434?"],
    ["http://ollama:11434#frag"],
    ["http://ollama:11434#"],
    ["http://olla ma:11434"],
    ["http://olla\nma:11434"],
    ["http://ollama:99999"],
    ["http://ollama:abc"],
    ["http://ollama\\@evil.com"],
    ["http://" + "a".repeat(300)],
  ])("a malformed address %j is refused as invalid", (raw) => {
    expect(refusedAs(raw)).toBe("assistant.local_url_invalid");
  });

  it("anything that is not a string is refused", () => {
    for (const bad of [null, undefined, 5, {}, [], true]) expect(refusedAs(bad)).toBe("assistant.local_url_invalid");
  });
});

describe("isPrivateAddress", () => {
  it("accepts exactly the private ranges and loopback", () => {
    for (const ok of ["127.0.0.1", "127.255.255.255", "10.0.0.0", "10.255.255.255", "172.16.0.0", "172.31.255.255", "192.168.0.0", "192.168.255.255", "::1", "fc00::1", "fdab::1", "::ffff:10.1.2.3", "::ffff:7f00:1"]) {
      expect(isPrivateAddress(ok), ok).toBe(true);
    }
  });

  it("refuses public, link-local, metadata, carrier-grade NAT, unspecified, multicast and garbage", () => {
    for (const bad of ["8.8.8.8", "169.254.169.254", "169.254.0.1", "100.64.0.1", "100.127.255.255", "100.100.100.200", "0.0.0.0", "224.0.0.1", "255.255.255.255", "172.15.255.255", "172.32.0.0", "192.167.1.1", "fd00:ec2::254", "fe80::1", "2001:db8::1", "::", "::ffff:8.8.8.8", "::ffff:169.254.169.254", "", "garbage", "1.2.3", "300.1.1.1", "1.2.3.4.5"]) {
      expect(isPrivateAddress(bad), bad).toBe(false);
    }
  });
});

describe("isInternalName", () => {
  it("accepts service names and the internal suffixes", () => {
    for (const ok of ["localhost", "ollama", "ollama-1", "ollama_x", "a", "ollama.internal", "x.lan", "x.local", "x.localdomain", "x.home.arpa", "foo.localhost"]) expect(isInternalName(ok), ok).toBe(true);
  });
  it("refuses public names, metadata names and malformed ones", () => {
    for (const bad of ["", "example.com", "ollama.com", "api.openai.com", "metadata", "metadata.google.internal", "metadata.foo.internal", "instance-data", "-bad", "bad-.internal", "a..internal", ".internal", "a".repeat(64), `${"a".repeat(250)}.internal`]) expect(isInternalName(bad), bad).toBe(false);
  });
});

describe("resolving at connection time", () => {
  const resolver =
    (rows: { address: string; family: 4 | 6 }[]): Resolver =>
    async () =>
      rows;

  it("a name that resolves to private addresses only is accepted; the first one is used", async () => {
    const found = await resolvePrivate("ollama", resolver([{ address: "172.18.0.5", family: 4 }, { address: "fd00::5", family: 6 }]));
    expect(found).toEqual({ address: "172.18.0.5", family: 4 });
  });

  it("ONE public address among the answers refuses the whole name (DNS rebinding, round-robin tricks)", async () => {
    await expect(resolvePrivate("ollama", resolver([{ address: "172.18.0.5", family: 4 }, { address: "8.8.8.8", family: 4 }]))).rejects.toMatchObject({ key: "assistant.err_local_host" });
    await expect(resolvePrivate("ollama", resolver([{ address: "169.254.169.254", family: 4 }]))).rejects.toMatchObject({ key: "assistant.err_local_host" });
    await expect(resolvePrivate("ollama", resolver([]))).rejects.toMatchObject({ key: "assistant.err_local_host" });
  });

  it("a name that does not resolve is «down», not «forbidden»", async () => {
    const err = await resolvePrivate("ollama", async () => {
      throw new Error("ENOTFOUND secret-host-name");
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).key).toBe("assistant.err_local_down");
    expect(String((err as Error).message)).not.toContain("secret-host-name");
  });

  it("the guarded lookup answers both shapes of the callback and refuses a public answer", async () => {
    const ok = makeGuardedLookup(resolver([{ address: "10.0.0.7", family: 4 }]));
    await new Promise<void>((done) =>
      ok("ollama", {}, (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe("10.0.0.7");
        expect(family).toBe(4);
        done();
      }),
    );
    await new Promise<void>((done) =>
      ok("ollama", { all: true }, (err, address) => {
        expect(err).toBeNull();
        expect(address).toEqual([{ address: "10.0.0.7", family: 4 }]);
        done();
      }),
    );
    const bad = makeGuardedLookup(resolver([{ address: "93.184.216.34", family: 4 }]));
    await new Promise<void>((done) =>
      bad("ollama", {}, (err, address) => {
        expect((err as unknown as AiProviderError).key).toBe("assistant.err_local_host");
        expect(address).toBeUndefined();
        done();
      }),
    );
  });
});
