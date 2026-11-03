import "./scoping-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as settingsRoute from "@/app/api/owner-assistant/settings/route";
import * as gatewayKeyRoute from "@/app/api/owner-assistant/local/key/route";
import * as chatRoute from "@/app/api/owner-assistant/chat/route";
import * as aiRoute from "@/app/api/control-panel/ai/route";
import { setLocalTransportForTests, type LocalHttpRequest } from "@/server/ai/local-transport";
import { resetZakiAiCacheForTests } from "@/server/services/zaki-ai";
import { withFeature, type FeatureKey } from "@/lib/features";
import { setProviderFactoryForTests, type ProviderConfig } from "@/server/ai/registry";
import type { AiRequest } from "@/server/ai/provider";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * «بوابة ثابتة من السيرفر» — ZAKI_GATEWAY_URL / _MODEL / _API_KEY against a real PostgreSQL and a fake provider (the network is never touched).
 * The values win over the saved ones, the screen sees them as fixed (and only the last four characters of the key), no route returns the key,
 * a screen cannot change them, the assistant calls the provider with them, and the outside-address switch still decides whether the address
 * may be used.
 */

const URL_ENV = "https://glm.erv.zakiai.io/v1";
const ORIGIN = "https://glm.erv.zakiai.io";
const MODEL_ENV = "auto/best-chat";
const KEY_ENV = "gw-env-KEY-never-appears-0123456789"; // scan-secrets:ignore
const NAMES = ["ZAKI_GATEWAY_URL", "ZAKI_GATEWAY_MODEL", "ZAKI_GATEWAY_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

let seen: { config: ProviderConfig; request: AiRequest }[] = [];
beforeEach(() => {
  for (const n of NAMES) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
  seen = [];
  setProviderFactoryForTests((config) => ({
    async complete(request) {
      seen.push({ config, request });
      return { text: "جواب", toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } };
    },
  }));
});
afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
  setProviderFactoryForTests(null);
  setLocalTransportForTests(null);
  resetZakiAiCacheForTests();
  vi.restoreAllMocks();
});

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world(externalSwitch = true) {
  const t = await makeTeam();
  await setFeature(t.org.id, "ownerAssistant", true);
  if (externalSwitch) await setFeature(t.org.id, "externalGateway", true);
  await loginAs(t.owner.id);
  return t;
}
// the route answers { settings, usage, models }: the tests look at the settings
const read = async () => {
  const res = await call(settingsRoute.GET);
  return { ...res, json: (res.json as { settings: Record<string, unknown> } | null)?.settings };
};
const patch = (body: unknown) => call(settingsRoute.PUT, { method: "PUT", body });
const ask = (message: string) => call(chatRoute.POST, { body: { message } });
const setEnv = () => {
  process.env["ZAKI_GATEWAY_URL"] = URL_ENV;
  process.env["ZAKI_GATEWAY_MODEL"] = MODEL_ENV;
  process.env["ZAKI_GATEWAY_API_KEY"] = KEY_ENV;
};

describe("the screen's settings", () => {
  it("without the variables nothing changes: no fixed flag appears", async () => {
    await world();
    const res = await read();
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).not.toContain("gatewayFixed");
  });

  it("with the variables: the address, the model and the key's last four are shown as fixed, and the key itself is nowhere", async () => {
    await world();
    setEnv();
    const res = await read();
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({
      gatewayBaseUrl: ORIGIN,
      gatewayModel: MODEL_ENV,
      hasGatewayKey: true,
      gatewayKeyLast4: KEY_ENV.slice(-4),
      gatewayFixed: { url: true, model: true, key: true },
    });
    expect(res.text).not.toContain(KEY_ENV);
  });

  it("only the parts that are set are fixed; the rest stays the owner's own", async () => {
    await world();
    process.env["ZAKI_GATEWAY_MODEL"] = MODEL_ENV;
    const res = await read();
    expect(res.json).toMatchObject({ gatewayModel: MODEL_ENV, gatewayFixed: { url: false, model: true, key: false } });
    expect((res.json as { gatewayBaseUrl: string | null }).gatewayBaseUrl).toBeNull();
  });

  it("a screen cannot change what is fixed (another value is refused), but the same value and every other setting still save", async () => {
    await world();
    setEnv();
    const other = await patch({ gatewayBaseUrl: "https://other.example.com" });
    expect(other.status).toBe(422);
    expect(other.text).toContain("assistant.gateway_fixed");
    const model = await patch({ gatewayModel: "something-else" });
    expect(model.status).toBe(422);
    expect(model.text).toContain("assistant.gateway_fixed");
    expect((await patch({ gatewayBaseUrl: ORIGIN, gatewayModel: MODEL_ENV, dailyLimit: 33 })).status).toBe(200);
    expect(((await read()).json as { dailyLimit: number }).dailyLimit).toBe(33);
  });

  it("the key box is closed while the key is fixed: save and delete are refused and nothing is written", async () => {
    const w = await world();
    setEnv();
    const put = await call(gatewayKeyRoute.PUT, { method: "PUT", body: { key: "another-key-value-1234567" } });
    expect(put.status).toBe(422);
    expect(put.text).toContain("assistant.gateway_fixed");
    const del = await call(gatewayKeyRoute.DELETE, { method: "DELETE" });
    expect(del.status).toBe(422);
    expect(await db.aiSettings.findUnique({ where: { orgId: w.org.id }, select: { gatewayKeyCipher: true } })).toBeNull();
  });
});

describe("the assistant", () => {
  it("calls the provider with the fixed key, address and model, marked external, and can be pointed at the gateway without saving them", async () => {
    await world();
    setEnv();
    expect((await patch({ ownerProvider: "openai" })).status).toBe(200);
    expect((await ask("مرحبا")).status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.config).toMatchObject({ kind: "openai", baseUrl: ORIGIN, model: MODEL_ENV, apiKey: KEY_ENV, external: true });
  });

  it("the outside-address switch still decides: with it off the fixed address is not used and the provider is not called", async () => {
    await world(false);
    setEnv();
    const chosen = await patch({ ownerProvider: "openai" });
    // an outside address cannot even be chosen without the switch (its words say which one), and nothing is sent
    expect(chosen.status).toBeGreaterThanOrEqual(200);
    const res = await ask("مرحبا");
    expect(res.status === 200 && seen.length > 0).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("an invalid variable is ignored: a public http address leaves the saved (empty) one in force", async () => {
    await world();
    process.env["ZAKI_GATEWAY_URL"] = "http://glm.erv.zakiai.io";
    const res = await read();
    expect((res.json as { gatewayBaseUrl: string | null }).gatewayBaseUrl).toBeNull();
    expect(JSON.stringify(res.json)).not.toContain("gatewayFixed");
  });
});

describe("«افحص واربط» on the control panel", () => {
  const connect = (body: unknown = {}) => call(aiRoute.POST, { body });
  const providers = async (orgId: string) => {
    const row = await db.aiSettings.findUniqueOrThrow({ where: { orgId }, select: { ownerProvider: true, chatProvider: true } });
    return row;
  };
  const gateway = (log: LocalHttpRequest[], status = 200) =>
    setLocalTransportForTests(async (request) => {
      log.push(request);
      return status === 200 ? { status, text: JSON.stringify({ data: [{ id: "auto/best-chat" }, { id: "auto/cheap" }] }) } : { status, text: "{}" };
    });

  it("with the variables set, ONE press with nothing typed tests the connection and links both assistants", async () => {
    const w = await world();
    setEnv();
    const log: LocalHttpRequest[] = [];
    gateway(log);
    const res = await connect();
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ state: "connected", inUse: true, baseUrl: ORIGIN, model: MODEL_ENV, hasKey: true, keyLast4: KEY_ENV.slice(-4), fixed: { url: true, model: true, key: true } });
    expect(res.text).not.toContain(KEY_ENV);
    expect(log[0]?.url).toBe(`${ORIGIN}/v1/models`);
    expect(log[0]?.headers["authorization"]).toBe(`Bearer ${KEY_ENV}`);
    expect(log[0]?.external).toBe(true);
    expect(await providers(w.org.id)).toEqual({ ownerProvider: "openai", chatProvider: "openai" });
  });

  it("an old «local» tick never makes an outside address look local on the screen", async () => {
    const w = await world();
    setEnv();
    await db.aiSettings.create({ data: { orgId: w.org.id, gatewayConfirmedLocal: true } });
    gateway([]);
    const res = await connect();
    expect(res.json).toMatchObject({ state: "connected", confirmedLocal: false });
  });

  it("a gateway that refuses the key is said so and links nothing", async () => {
    const w = await world();
    setEnv();
    gateway([], 401);
    const res = await connect();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ state: "unreachable", inUse: false });
    expect(JSON.stringify(res.json)).toContain("assistant.err_key_rejected");
    const row = await db.aiSettings.findUnique({ where: { orgId: w.org.id }, select: { ownerProvider: true, chatProvider: true } });
    expect(row?.ownerProvider ?? "claude").toBe("claude");
    expect(row?.chatProvider ?? "claude").toBe("claude");
  });

  it("with the outside-address switch off the press is refused with the sentence that names the switch, and nothing is sent", async () => {
    await world(false);
    setEnv();
    const log: LocalHttpRequest[] = [];
    gateway(log);
    const res = await connect();
    expect(res.status).toBe(422);
    expect(res.text).toContain("assistant.local_url_external_off");
    expect(log).toHaveLength(0);
  });

  it("with nothing fixed and nothing saved, an empty press is refused as before", async () => {
    await world();
    const res = await connect();
    expect(res.status).toBe(422);
  });

  it("without the variables the typed form still links the owner's assistant only", async () => {
    const w = await world();
    gateway([]);
    const res = await connect({ baseUrl: "http://hermes-agent:8642", model: "auto/cheap" });
    expect(res.json).toMatchObject({ state: "connected" });
    expect(await providers(w.org.id)).toEqual({ ownerProvider: "openai", chatProvider: "claude" });
  });
});
