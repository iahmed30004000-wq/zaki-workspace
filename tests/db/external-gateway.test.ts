import "./scoping-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as settingsRoute from "@/app/api/owner-assistant/settings/route";
import * as testRoute from "@/app/api/owner-assistant/local/test/route";
import * as chatRoute from "@/app/api/owner-assistant/chat/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import { setProviderFactoryForTests, type ProviderConfig } from "@/server/ai/registry";
import type { AiRequest } from "@/server/ai/provider";
import { setLocalTransportForTests, type LocalHttpRequest, type LocalTransport } from "@/server/ai/local-transport";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * «بوابة نموذج خارجية» — the owner's gateway at an https address on the internet, against a real PostgreSQL and a fake transport (the network is
 * never touched). Switch off: the old rule, every outside address is refused with its own sentence. Switch on: the address is saved as an origin,
 * the test and the assistant reach it (marked external), the privacy filter is NEVER relaxed for it, and turning the switch off stops the use.
 */

const OUTSIDE = "https://glm.erv.zakiai.io/v1";
const ORIGIN = "https://glm.erv.zakiai.io";
const PHONE = "0791234567";

let seen: { config: ProviderConfig; request: AiRequest }[] = [];
beforeEach(() => {
  seen = [];
  setProviderFactoryForTests((config) => ({
    async complete(request) {
      seen.push({ config, request });
      return { text: "جواب", toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } };
    },
  }));
});
afterEach(() => {
  setProviderFactoryForTests(null);
  setLocalTransportForTests(null);
  vi.restoreAllMocks();
});

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world() {
  const t = await makeTeam();
  await setFeature(t.org.id, "ownerAssistant", true);
  await loginAs(t.owner.id);
  return t;
}
const patch = (body: unknown) => call(settingsRoute.PUT, { method: "PUT", body });
const ask = (message: string) => call(chatRoute.POST, { body: { message } });

function fakeGateway(log: LocalHttpRequest[]): LocalTransport {
  return async (request) => {
    log.push(request);
    if (request.url.endsWith("/v1/models")) return { status: 200, text: JSON.stringify({ data: [{ id: "glm-4" }] }) };
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }) };
  };
}

describe("the switch is off (the default): the old rule", () => {
  it("an address on the internet is refused when saved, with the sentence that names the switch; nothing is written", async () => {
    const w = await world();
    const res = await patch({ gatewayBaseUrl: OUTSIDE, gatewayModel: "glm-4" });
    expect(res.status).toBe(422);
    expect(res.text).toContain("assistant.local_url_external_off");
    const row = await db.aiSettings.findUnique({ where: { orgId: w.org.id } });
    expect(row?.gatewayBaseUrl ?? null).toBeNull();
  });

  it("«اختبر الاتصال» refuses it too and the transport is never reached; the internal address still works", async () => {
    await world();
    const log: LocalHttpRequest[] = [];
    const transport = vi.fn(fakeGateway(log));
    setLocalTransportForTests(transport);
    const res = await call(testRoute.POST, { body: { provider: "openai", baseUrl: OUTSIDE } });
    expect(res.status).toBe(422);
    expect(res.text).toContain("assistant.local_url_external_off");
    expect(transport).not.toHaveBeenCalled();
    const inside = await call(testRoute.POST, { body: { provider: "openai", baseUrl: "http://hermes-agent:8642", model: "glm-4" } });
    expect(inside.status).toBe(200);
    expect(log[0]?.external).toBeUndefined();
  });
});

describe("the switch is on", () => {
  it("saves the address as an origin (the /v1 is dropped) and the test reaches it, marked external, over https", async () => {
    const w = await world();
    await setFeature(w.org.id, "externalGateway", true);
    const saved = await patch({ gatewayBaseUrl: OUTSIDE, gatewayModel: "glm-4" });
    expect(saved.status, saved.text).toBe(200);
    expect((await db.aiSettings.findUniqueOrThrow({ where: { orgId: w.org.id } })).gatewayBaseUrl).toBe(ORIGIN);

    const log: LocalHttpRequest[] = [];
    setLocalTransportForTests(fakeGateway(log));
    const res = await call(testRoute.POST, { body: { provider: "openai" } });
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ provider: "openai", reachable: true, installed: true });
    expect(log.length).toBeGreaterThanOrEqual(1);
    for (const r of log) {
      expect(r.url.startsWith(`${ORIGIN}/v1/`)).toBe(true);
      expect(r.external).toBe(true);
    }
  });

  it("an address that is not https with a public name is still refused: http, an IP address, the metadata address, another path", async () => {
    const w = await world();
    await setFeature(w.org.id, "externalGateway", true);
    for (const bad of ["http://glm.erv.zakiai.io", "https://8.8.8.8", "https://169.254.169.254", "https://metadata.google.internal", "https://glm.erv.zakiai.io/api/x", "https://u:p@glm.erv.zakiai.io"]) {
      const res = await patch({ gatewayBaseUrl: bad });
      expect(res.status, bad).toBe(422);
    }
  });

  it("the assistant answers through it, the provider is told it is external, and the filter is NOT relaxed even with both ticks", async () => {
    const w = await world();
    await setFeature(w.org.id, "externalGateway", true);
    const ok = await patch({ gatewayBaseUrl: OUTSIDE, gatewayModel: "glm-4", ownerProvider: "openai", localRelaxRedaction: true, gatewayConfirmedLocal: true });
    expect(ok.status, ok.text).toBe(200);
    expect((await ask(`كلّم أبو سامر على ${PHONE} وشو وضع الطلبات؟`)).status).toBe(200);
    expect(seen[0]?.config).toMatchObject({ kind: "openai", baseUrl: ORIGIN, model: "glm-4", external: true });
    expect(JSON.stringify(seen[0]?.request)).not.toContain(PHONE);
  });

  it("turning the switch off stops the assistant from using it: the provider is not called", async () => {
    const w = await world();
    await setFeature(w.org.id, "externalGateway", true);
    expect((await patch({ gatewayBaseUrl: OUTSIDE, gatewayModel: "glm-4", ownerProvider: "openai" })).status).toBe(200);
    expect((await ask("مرحبا")).status).toBe(200);
    expect(seen).toHaveLength(1);
    await setFeature(w.org.id, "externalGateway", false);
    const after = await ask("مرحبا مرة ثانية");
    expect(after.status).toBeGreaterThanOrEqual(400);
    expect(seen).toHaveLength(1);
  });
});
