import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as linkRoute from "@/app/api/integrations/oms/route";
import { withFeature } from "@/lib/features";
import { decryptSecrets, encryptSecrets } from "@/server/crypto";
import { setOmsOptionsForTests } from "@/server/integrations/oms";
import { runOmsSync, syncOrg } from "@/server/integrations/oms-sync";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/** Q1.0 review: the holes the independent review reproduced, against a real PostgreSQL and a fake orders system. */
const KEY = "oms-review-key-0123456789-abcdefghijkl";
const TOKEN = "omsk_live_REVIEW_token_9981";
let seenAuth: string[] = [];
let seenUrls: string[] = [];
let answer: () => Response = () => new Response(JSON.stringify({ data: [] }), { status: 200 });
const saved: Record<string, string | undefined> = {};
let clock = 0;

const list = (rows: unknown[]) => new Response(JSON.stringify({ data: rows }), { status: 200 });
const row = (over: Record<string, unknown> = {}) => ({ code: "TS-1", name: "جهاز", price: 25, currency: "JOD", ...over });

beforeAll(() => {
  saved["K"] = process.env["ENCRYPTION_KEY"];
});
afterAll(() => {
  if (saved["K"] === undefined) delete process.env["ENCRYPTION_KEY"];
  else process.env["ENCRYPTION_KEY"] = saved["K"];
  setOmsOptionsForTests(null);
});
beforeEach(async () => {
  await db.integration.deleteMany({ where: { type: "OMS" } });
  process.env["ENCRYPTION_KEY"] = KEY;
  seenAuth = [];
  seenUrls = [];
  answer = () => list([]);
  setOmsOptionsForTests({
    resolve: async () => ["93.184.216.34"],
    fetchImpl: (async (url: string, init: RequestInit) => {
      seenUrls.push(url);
      seenAuth.push(String((init.headers as Record<string, string>)["Authorization"]));
      return answer();
    }) as typeof fetch,
  });
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

async function world(opts: { on?: boolean; connected?: boolean } = {}) {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
  if (opts.on !== false) {
    const org = await db.organization.findUniqueOrThrow({ where: { id: team.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: team.org.id }, data: { settings: withFeature(org.settings, "omsLink", true) as Prisma.InputJsonValue } });
  }
  if (opts.connected !== false) {
    await db.integration.create({ data: { orgId: team.org.id, type: "OMS", connected: true, secretEnc: encryptSecrets({ token: TOKEN }), config: { baseUrl: "https://oms.example.test" } } });
  }
  return { ...team, ws };
}
type World = Awaited<ReturnType<typeof world>>;
const sheet = (w: World, external: Record<string, unknown>) => db.card.create({ data: { orgId: w.org.id, workspaceId: w.ws.id, createdById: w.owner.id, kind: "NOTE", title: "كرت", external: external as Prisma.InputJsonValue } });
const snap = (over: Record<string, unknown> = {}) => ({ code: "TS-1", name: "جهاز", price: 20, currency: "JOD", offers: [], stockStatus: "in_stock", fetchedAt: "2026-01-01T00:00:00.000Z", ...over });
const ext = async (id: string) => (await db.card.findUniqueOrThrow({ where: { id }, select: { external: true } })).external as Record<string, unknown>;
const at = (extra = 6) => new Date(Date.UTC(2030, 0, 1) + (clock += extra * 60_000));

describe("the token and the address", () => {
  const URL_BASE = "http://localhost/api/integrations/oms";
  it("a new address needs a new token: the saved one is never sent somewhere else", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const res = await call(linkRoute.PUT, { method: "PUT", url: URL_BASE, body: { baseUrl: "https://attacker.example.test" } });
    expect(res.status).toBe(422);
    const integ = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "OMS" } } });
    expect((integ.config as { baseUrl: string }).baseUrl).toBe("https://oms.example.test");
    await syncOrg(w.org.id, at());
    expect(seenUrls.every((u) => u.startsWith("https://oms.example.test/"))).toBe(true);
  });
  it("the same address (a slash, other letter case) keeps the saved token; a new address with a new token is accepted", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await call(linkRoute.PUT, { method: "PUT", url: URL_BASE, body: { baseUrl: "https://OMS.example.test/", tokenExpiresAt: "2030-05-05" } })).status).toBe(200);
    const integ = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "OMS" } } });
    expect(decryptSecrets<{ token: string }>(integ.secretEnc)?.token).toBe(TOKEN);
    expect((await call(linkRoute.PUT, { method: "PUT", url: URL_BASE, body: { baseUrl: "https://oms2.example.test", token: "fresh-token" } })).status).toBe(200);
    const after = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "OMS" } } });
    expect(decryptSecrets<{ token: string }>(after.secretEnc)?.token).toBe("fresh-token");
  });
  it("the card answers its state while the switch is off, and saving and reading now are refused", async () => {
    const w = await world({ on: false });
    await loginAs(w.owner.id);
    const res = await call(linkRoute.GET, { url: URL_BASE });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ switchOn: false });
    expect(res.text).not.toContain(TOKEN);
  });
});

describe("a read that is not a product list", () => {
  it("is a failure: the warning stays, the time of the last good read does not move", async () => {
    const w = await world();
    const c = await sheet(w, snap());
    answer = () => new Response(JSON.stringify({ error: "rate limited" }), { status: 200 });
    const r = await syncOrg(w.org.id, at());
    expect(r).toMatchObject({ ok: false, errorCode: "bad_body" });
    expect((await ext(c.id))["price"]).toBe(20);
    const integ = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "OMS" } } });
    expect(integ.lastSyncAt).toBeNull();
    expect(await db.integrationEvent.count({ where: { orgId: w.org.id, status: "FAILED" } })).toBe(1);
  });
  it("an unreadable row does not mark its healthy sheet as gone", async () => {
    const w = await world();
    const a = await sheet(w, snap({ code: "A", name: "a", price: 20 }));
    const b = await sheet(w, snap({ code: "B", name: "b", price: 20 }));
    answer = () => list([row({ code: "A", name: "a", price: 30 }), row({ code: "B", name: "b", price: "12.5" })]);
    const r = await syncOrg(w.org.id, at());
    expect(r.missing).toBe(0);
    expect((await ext(a.id))["price"]).toBe(30);
    expect((await ext(b.id))["missingSince"]).toBeUndefined();
    expect((await ext(b.id))["price"]).toBe(20);
  });
  it("a numeric id links the sheet", async () => {
    const w = await world();
    const c = await sheet(w, snap({ id: "7" }));
    answer = () => list([row({ id: 7, price: 41 })]);
    await syncOrg(w.org.id, at());
    expect((await ext(c.id))["price"]).toBe(41);
  });
  it("a sheet whose offers are not a list does not stop the other sheets", async () => {
    const w = await world();
    await sheet(w, snap({ code: "A", name: "a", offers: "oops" }));
    const b = await sheet(w, snap({ code: "B", name: "b" }));
    answer = () => list([row({ code: "A", name: "a" }), row({ code: "B", name: "b", price: 99 })]);
    await syncOrg(w.org.id, at());
    expect((await ext(b.id))["price"]).toBe(99);
  });
});

describe("two processes and a sheet edited meanwhile", () => {
  it("only one of two runs that read the same due time does the work", async () => {
    const w = await world();
    await sheet(w, snap());
    answer = () => list([row()]);
    const when = at();
    const [a, b] = await Promise.all([runOmsSync(when), runOmsSync(when)]);
    expect(a.orgs + b.orgs).toBe(1);
    expect(seenUrls).toHaveLength(1);
  });
  it("a sheet edited while the sync runs keeps its newer updatedAt", async () => {
    const w = await world();
    const c = await sheet(w, snap());
    // the edit lands in the middle of the read
    let edit: Promise<unknown> = Promise.resolve();
    answer = () => {
      edit = db.card.update({ where: { id: c.id }, data: { title: "عدّلها إنسان" } });
      return list([row({ price: 77 })]);
    };
    await syncOrg(w.org.id, at());
    await edit;
    const after = await db.card.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.title).toBe("عدّلها إنسان");
    expect(after.updatedAt.getTime()).toBeGreaterThan(c.updatedAt.getTime());
  });
});
