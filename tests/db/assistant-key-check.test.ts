import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as keyRoute from "@/app/api/owner-assistant/key/route";
import * as checkRoute from "@/app/api/owner-assistant/key/check/route";
import { withFeature } from "@/lib/features";
import { setProviderFactoryForTests } from "@/server/ai/registry";
import { AiProviderError, type AiErrorKey } from "@/server/ai/provider";
import { call, db, loginAs, logout, makeTeam } from "./helpers";

/**
 * «افحص المفتاح»: the owner asks the provider, with the key already saved, whether it still accepts it. The answer is `{ ok }` or `{ ok:false, reason }` (a
 * dictionary key, never the provider's own words), the key itself is never in it, and only the owner may ask.
 */
const KEY = "sk-ant-api03-CHECKKEY-must-never-appear-1122334455-ABCD"; // scan-secrets:ignore

let seen: Array<{ apiKey: string; maxTokens: number }> = [];
let fail: AiErrorKey | null = null;

beforeEach(() => {
  seen = [];
  fail = null;
  logout();
  setProviderFactoryForTests((cfg) => ({
    async complete(request) {
      seen.push({ apiKey: cfg.apiKey, maxTokens: request.maxTokens });
      if (fail) throw new AiProviderError(fail);
      return { text: "ok", toolCalls: [], usage: { inputTokens: 3, outputTokens: 1 } };
    },
  }));
});
afterEach(() => setProviderFactoryForTests(null));

async function owner() {
  const t = await makeTeam();
  const org = await db.organization.findUniqueOrThrow({ where: { id: t.org.id } });
  await db.organization.update({ where: { id: t.org.id }, data: { settings: withFeature(org.settings, "ownerAssistant", true) as Prisma.InputJsonValue } });
  return t;
}

const check = () => call(checkRoute.POST, { method: "POST", body: {} });

describe("the key check of the owner's assistant", () => {
  it("a key the provider accepts: ok, one tiny request, and the key is nowhere in the answer", async () => {
    const t = await owner();
    await loginAs(t.owner.id);
    expect((await call(keyRoute.PUT, { method: "PUT", body: { key: KEY } })).status).toBe(200);
    const res = await check();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.apiKey).toBe(KEY);
    expect(seen[0]!.maxTokens).toBeLessThanOrEqual(8);
    expect(res.text).not.toContain(KEY);
  });

  it("a key the provider refuses: ok false with the reason as a dictionary key (not the provider's words)", async () => {
    const t = await owner();
    await loginAs(t.owner.id);
    await call(keyRoute.PUT, { method: "PUT", body: { key: KEY } });
    fail = "assistant.err_key_rejected";
    const res = await check();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: false, reason: "assistant.err_key_rejected" });
    expect(res.text).not.toContain(KEY);
  });

  it("another failure (the provider is busy) is told as it is, so «key refused» is never said for it", async () => {
    const t = await owner();
    await loginAs(t.owner.id);
    await call(keyRoute.PUT, { method: "PUT", body: { key: KEY } });
    fail = "assistant.err_overloaded";
    expect((await check()).json).toEqual({ ok: false, reason: "assistant.err_overloaded" });
  });

  it("no key saved: ok false, reason assistant.no_key, the provider is never called", async () => {
    const t = await owner();
    await loginAs(t.owner.id);
    expect((await check()).json).toEqual({ ok: false, reason: "assistant.no_key" });
    expect(seen).toHaveLength(0);
  });

  it("only the owner: a member and a visitor get 404/401 and the provider is never called", async () => {
    const t = await owner();
    await loginAs(t.owner.id);
    await call(keyRoute.PUT, { method: "PUT", body: { key: KEY } });
    logout();
    expect([401, 403, 404]).toContain((await check()).status);
    await loginAs(t.member.id);
    expect([403, 404]).toContain((await check()).status);
    expect(seen).toHaveLength(0);
  });
});
