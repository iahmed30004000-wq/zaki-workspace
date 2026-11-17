import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as linkRoute from "@/app/api/integrations/oms/route";
import * as syncRoute from "@/app/api/integrations/oms/sync/route";
import { withFeature } from "@/lib/features";
import { decryptSecrets, encryptSecrets } from "@/server/crypto";
import { runDueJobs } from "@/server/jobs/run";
import { setOmsOptionsForTests } from "@/server/integrations/oms";
import { runOmsSync } from "@/server/integrations/oms-sync";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * Q1.0: the sync that refreshes the snapshot of the linked sheets, and the card that connects the orders system.
 * Against a real PostgreSQL and a FAKE orders system (the client's `fetchImpl`).
 *
 * Pins: switch off = nothing is read; a linked sheet's `external` is refreshed and NO CardRevision, version or updatedAt moves;
 * idempotent; a sheet that is not linked is never touched and no draft is made here; two products with one code are not linked
 * by themselves; an id beats a code; a product that disappears marks its sheet (never deletes) and comes back clean; an empty
 * answer never marks everything gone; an unreachable system keeps the last snapshot and leaves a FAILED event; the five-minute
 * rhythm holds for failures too; the token is encrypted, never returned, never logged; only the owner connects it.
 */

const KEY = "oms-test-encryption-key-0123456789-abcdef";
const TOKEN = "omsk_live_ZZ_SECRET_token_4471";
const saved: Record<string, string | undefined> = {};
const logLines: string[] = [];
let clock = 0;
let fetchCalls = 0;
let answer: () => Response | Promise<Response> = () => products([]);

const products = (rows: unknown[]) => new Response(JSON.stringify({ data: rows }), { status: 200, headers: { "content-type": "application/json" } });
const row = (over: Record<string, unknown> = {}) => ({ code: "TS-100", name: "جهاز", price: 25, currency: "JOD", offers: [], stock_status: "in_stock", ...over });

beforeAll(() => {
  saved["ENCRYPTION_KEY"] = process.env["ENCRYPTION_KEY"];
});
afterAll(() => {
  if (saved["ENCRYPTION_KEY"] === undefined) delete process.env["ENCRYPTION_KEY"];
  else process.env["ENCRYPTION_KEY"] = saved["ENCRYPTION_KEY"];
  setOmsOptionsForTests(null);
});
beforeEach(async () => {
  // the job reads EVERY company's integration: leftovers of an earlier test must not be read by this one
  await db.integration.deleteMany({ where: { type: "OMS" } });
  process.env["ENCRYPTION_KEY"] = KEY;
  fetchCalls = 0;
  answer = () => products([]);
  logLines.length = 0;
  setOmsOptionsForTests({
    resolve: async () => ["93.184.216.34"],
    fetchImpl: (async () => {
      fetchCalls += 1;
      return answer();
    }) as typeof fetch,
  });
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logLines.push(args.map(String).join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "omsLink", on) as Prisma.InputJsonValue } });
}

async function world(opts: { on?: boolean; connected?: boolean } = {}) {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
  if (opts.on !== false) await setSwitch(team.org.id, true);
  if (opts.connected !== false) {
    await db.integration.create({
      data: { orgId: team.org.id, type: "OMS", connected: true, secretEnc: encryptSecrets({ token: TOKEN }), config: { baseUrl: "https://oms.example.test", connectedById: team.owner.id } },
    });
  }
  return { ...team, ws };
}
type World = Awaited<ReturnType<typeof world>>;

async function sheet(w: World, external: Record<string, unknown> | null, title = "كرت") {
  return db.card.create({
    data: { orgId: w.org.id, workspaceId: w.ws.id, createdById: w.owner.id, kind: "NOTE", title, ...(external ? { external: external as Prisma.InputJsonValue } : {}) },
  });
}
const snap = (over: Record<string, unknown> = {}) => ({ code: "TS-100", name: "جهاز", price: 20, currency: "JOD", offers: [], stockStatus: "in_stock", fetchedAt: "2026-01-01T00:00:00.000Z", ...over });
const externalOf = async (id: string) => (await db.card.findUniqueOrThrow({ where: { id }, select: { external: true } })).external as Record<string, unknown> | null;

/** One run of the sync, 6 minutes after the last one (the rhythm is 5). */
async function tick(extra = 6) {
  clock += extra * 60_000;
  return runOmsSync(new Date(Date.UTC(2030, 0, 1) + clock));
}

describe("the switch and the connection", () => {
  it("reads nothing while the switch is off", async () => {
    const w = await world({ on: false });
    answer = () => products([row({ price: 99 })]);
    await sheet(w, snap());
    const r = await tick();
    expect(fetchCalls).toBe(0);
    expect(r.orgs).toBe(0);
  });
  it("reads nothing for a company that has not connected it", async () => {
    const w = await world({ connected: false });
    await sheet(w, snap());
    await tick();
    expect(fetchCalls).toBe(0);
  });
  it("is one of the jobs of the runner", async () => {
    const w = await world();
    answer = () => products([row({ price: 31 })]);
    const c = await sheet(w, snap());
    const run = await runDueJobs(new Date(Date.UTC(2031, 0, 1)));
    expect(run.omsSync).not.toBeNull();
    expect((await externalOf(c.id))!["price"]).toBe(31);
  });
});

describe("refreshing a linked sheet", () => {
  it("writes the new snapshot beside the sheet and moves nothing of its versions", async () => {
    const w = await world();
    const c = await sheet(w, snap({ price: 20 }));
    answer = () => products([row({ price: 25, offers: [{ title: "قطعتين", quantity: 2, price: 45 }] })]);
    const r = await tick();
    expect(r).toMatchObject({ orgs: 1, refreshed: 1, failed: 0 });
    const ext = (await externalOf(c.id))!;
    expect(ext).toMatchObject({ code: "TS-100", price: 25, offers: [{ title: "قطعتين", quantity: 2, price: 45 }] });
    expect(ext["fetchedAt"]).toBe(new Date(Date.UTC(2030, 0, 1) + clock).toISOString());
    const after = await db.card.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.version).toBe(c.version);
    expect(after.updatedAt.getTime()).toBe(c.updatedAt.getTime());
    expect(after.title).toBe(c.title);
    expect(await db.cardRevision.count({ where: { cardId: c.id } })).toBe(0);
    const integ = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "OMS" } } });
    expect(integ.lastSyncAt?.toISOString()).toBe(new Date(Date.UTC(2030, 0, 1) + clock).toISOString());
  });
  it("is idempotent: the same answer again changes nothing but the time", async () => {
    const w = await world();
    const c = await sheet(w, snap());
    answer = () => products([row({ price: 25 })]);
    await tick();
    const first = (await externalOf(c.id))!;
    const r2 = await tick();
    const second = (await externalOf(c.id))!;
    expect({ ...second, fetchedAt: 0 }).toEqual({ ...first, fetchedAt: 0 });
    expect(r2.changed).toBe(0);
    expect(await db.cardRevision.count({ where: { cardId: c.id } })).toBe(0);
  });
  it("counts a price change (never on a first snapshot) for the notice of Q1.6", async () => {
    const w = await world();
    await sheet(w, snap({ price: 20 }));
    answer = () => products([row({ price: 25 })]);
    expect((await tick()).changed).toBe(1);
    expect((await tick()).changed).toBe(0);
  });
  it("never touches a sheet that is not linked, and makes no draft here", async () => {
    const w = await world();
    const plain = await sheet(w, null, "كرت عادي");
    answer = () => products([row(), row({ code: "NEW-1", name: "منتج جديد" })]);
    await tick();
    expect(await externalOf(plain.id)).toBeNull();
    expect(await db.card.count({ where: { orgId: w.org.id } })).toBe(1);
  });
  it("only ever touches the sheets of its own company", async () => {
    const a = await world();
    const b = await world({ on: false, connected: false });
    const mine = await sheet(a, snap());
    const theirs = await sheet(b, snap({ price: 1 }));
    answer = () => products([row({ price: 77 })]);
    await tick();
    expect((await externalOf(mine.id))!["price"]).toBe(77);
    expect((await externalOf(theirs.id))!["price"]).toBe(1);
  });
});

describe("linking", () => {
  it("links nothing by itself when two products share a code and the sheet has no id", async () => {
    const w = await world();
    const c = await sheet(w, snap({ price: 20 }));
    answer = () => products([row({ price: 30, name: "جهاز" }), row({ price: 40, name: "جهاز" })]);
    const r = await tick();
    expect(r.ambiguous).toBe(1);
    expect((await externalOf(c.id))!["price"]).toBe(20);
  });
  it("an id beats a shared code", async () => {
    const w = await world();
    const c = await sheet(w, snap({ id: "p_2", price: 20 }));
    answer = () => products([row({ id: "p_1", price: 30 }), row({ id: "p_2", price: 40 })]);
    await tick();
    expect((await externalOf(c.id))!["price"]).toBe(40);
  });
  it("matches by code and name, and takes the id once the door gives it", async () => {
    const w = await world();
    const c = await sheet(w, snap());
    answer = () => products([row({ id: "p_9", price: 25 })]);
    await tick();
    expect((await externalOf(c.id))!["id"]).toBe("p_9");
  });
  it("a code with another name is not the same product", async () => {
    const w = await world();
    const c = await sheet(w, snap({ name: "اسم قديم" }));
    answer = () => products([row({ name: "اسم تاني", price: 90 })]);
    await tick();
    expect((await externalOf(c.id))!["price"]).toBe(20);
  });
});

describe("a product that disappears", () => {
  it("marks its sheet and keeps it, with the last price it had", async () => {
    const w = await world();
    const c = await sheet(w, snap({ id: "p_1", price: 20 }));
    answer = () => products([row({ code: "OTHER", name: "غيره", id: "p_5" })]);
    const r = await tick();
    expect(r.missing).toBe(1);
    const ext = (await externalOf(c.id))!;
    expect(ext["missingSince"]).toBe(new Date(Date.UTC(2030, 0, 1) + clock).toISOString());
    expect(ext["price"]).toBe(20);
    expect(ext["fetchedAt"]).toBe("2026-01-01T00:00:00.000Z");
    expect(await db.card.count({ where: { id: c.id } })).toBe(1);
    // the date it was first seen gone does not move on the next run
    const first = ext["missingSince"];
    await tick();
    expect((await externalOf(c.id))!["missingSince"]).toBe(first);
  });
  it("comes back clean when the product is back", async () => {
    const w = await world();
    const c = await sheet(w, snap({ id: "p_1", missingSince: "2026-01-02T00:00:00.000Z" }));
    answer = () => products([row({ id: "p_1", price: 26 })]);
    await tick();
    const ext = (await externalOf(c.id))!;
    expect(ext["missingSince"]).toBeUndefined();
    expect(ext["price"]).toBe(26);
  });
  it("an empty answer never marks every sheet gone", async () => {
    const w = await world();
    const c = await sheet(w, snap());
    answer = () => products([]);
    const r = await tick();
    expect(r.missing).toBe(0);
    expect((await externalOf(c.id))!["missingSince"]).toBeUndefined();
  });
});

describe("an orders system that cannot be reached", () => {
  it("keeps the last snapshot, leaves a FAILED event, and does not say the sync happened", async () => {
    const w = await world();
    const c = await sheet(w, snap({ price: 20 }));
    answer = () => new Response("down", { status: 503 });
    const r = await tick();
    expect(r).toMatchObject({ orgs: 1, refreshed: 0, failed: 1 });
    expect((await externalOf(c.id))!["price"]).toBe(20);
    const ev = await db.integrationEvent.findMany({ where: { orgId: w.org.id, type: "oms.products" } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ status: "FAILED", detail: "oms.http_503" });
    const integ = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "OMS" } } });
    expect(integ.lastSyncAt).toBeNull();
  });
  it("waits five minutes after a failure too, and tries again after", async () => {
    const w = await world();
    await sheet(w, snap());
    answer = () => new Response("down", { status: 503 });
    await tick();
    expect(fetchCalls).toBe(1);
    await tick(2);
    expect(fetchCalls).toBe(1);
    answer = () => products([row({ price: 28 })]);
    const r = await tick(4);
    expect(fetchCalls).toBe(2);
    expect(r.refreshed).toBe(1);
    void w;
  });
  it("two runs within five minutes read once", async () => {
    const w = await world();
    await sheet(w, snap());
    answer = () => products([row()]);
    await tick();
    await tick(1);
    expect(fetchCalls).toBe(1);
  });
  it("one company that fails does not stop the next", async () => {
    const a = await world();
    const b = await world();
    await sheet(a, snap());
    const cb = await sheet(b, snap({ price: 5 }));
    let n = 0;
    answer = () => (++n === 1 ? new Response("down", { status: 500 }) : products([row({ price: 60 })]));
    const r = await tick();
    expect(r.failed).toBe(1);
    expect(r.refreshed).toBe(1);
    void cb;
  });
});

describe("the token", () => {
  it("is never in an event or a log line, even when the other side echoes it", async () => {
    const w = await world();
    await sheet(w, snap());
    answer = () => new Response(`bad token ${TOKEN}`, { status: 401 });
    await tick();
    const events = JSON.stringify(await db.integrationEvent.findMany({ where: { orgId: w.org.id } }));
    expect(events).not.toContain(TOKEN);
    expect(logLines.join("\n")).not.toContain(TOKEN);
  });
});

describe("the card of «التكاملات»", () => {
  const URL_BASE = "http://localhost/api/integrations/oms";
  const put = (b: unknown) => call(linkRoute.PUT, { method: "PUT", url: URL_BASE, body: b });
  const get = () => call(linkRoute.GET, { url: URL_BASE });
  const del = () => call(linkRoute.DELETE, { method: "DELETE", url: URL_BASE });
  const syncNow = () => call(syncRoute.POST, { method: "POST", url: `${URL_BASE}/sync` });
  const good = { baseUrl: "https://oms.example.test", token: TOKEN, tokenExpiresAt: "2030-03-01" };

  it("is the owner's alone", async () => {
    const w = await world({ connected: false });
    for (const who of [w.admin, w.member]) {
      await loginAs(who.id);
      expect((await get()).status).toBe(403);
      expect((await put(good)).status).toBe(403);
      expect((await del()).status).toBe(403);
      expect((await syncNow()).status).toBe(403);
    }
    expect(await db.integration.count({ where: { orgId: w.org.id, type: "OMS" } })).toBe(0);
  });
  it("saves nothing while the switch is off (404)", async () => {
    const w = await world({ on: false, connected: false });
    await loginAs(w.owner.id);
    expect((await put(good)).status).toBe(404);
    expect((await syncNow()).status).toBe(404);
    expect(await db.integration.count({ where: { orgId: w.org.id, type: "OMS" } })).toBe(0);
  });
  it("stores the token encrypted, and answers only «saved», never the token", async () => {
    const w = await world({ connected: false });
    await loginAs(w.owner.id);
    const res = await put(good);
    expect(res.status, res.text).toBe(200);
    const integ = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "OMS" } } });
    expect(integ.secretEnc).not.toContain(TOKEN);
    expect(decryptSecrets<{ token: string }>(integ.secretEnc)?.token).toBe(TOKEN);
    expect(integ.connected).toBe(true);
    expect(integ.config).toMatchObject({ baseUrl: "https://oms.example.test", tokenExpiresAt: "2030-03-01", connectedById: w.owner.id });
    const status = await get();
    expect(status.status).toBe(200);
    expect(status.text).not.toContain(TOKEN);
    expect(status.json).toMatchObject({ switchOn: true, connected: true, tokenSaved: true, baseUrl: "https://oms.example.test", tokenExpiresAt: "2030-03-01" });
    expect(res.text).not.toContain(TOKEN);
  });
  it("keeps the saved token when a save leaves it empty, and needs one the first time", async () => {
    const w = await world({ connected: false });
    await loginAs(w.owner.id);
    expect((await put({ baseUrl: good.baseUrl })).status).toBe(422);
    expect((await put(good)).status).toBe(200);
    expect((await put({ baseUrl: "https://oms2.example.test" })).status).toBe(200);
    const integ = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: w.org.id, type: "OMS" } } });
    expect(decryptSecrets<{ token: string }>(integ.secretEnc)?.token).toBe(TOKEN);
    expect((integ.config as { baseUrl: string }).baseUrl).toBe("https://oms2.example.test");
  });
  it("refuses an address on a private network, plain http, and a missing key", async () => {
    const w = await world({ connected: false });
    await loginAs(w.owner.id);
    expect((await put({ ...good, baseUrl: "http://oms.example.test" })).status).toBe(422);
    expect((await put({ ...good, baseUrl: "https://10.0.0.5" })).status).toBe(422);
    delete process.env["ENCRYPTION_KEY"];
    expect((await put(good)).status).toBe(422);
    expect(await db.integration.count({ where: { orgId: w.org.id, type: "OMS" } })).toBe(0);
  });
  it("«اقرأي هلّق» reads now, without waiting for the rhythm", async () => {
    const w = await world();
    const c = await sheet(w, snap());
    answer = () => products([row({ price: 52 })]);
    await loginAs(w.owner.id);
    const res = await syncNow();
    expect(res.status, res.text).toBe(200);
    expect((await externalOf(c.id))!["price"]).toBe(52);
    expect(res.json).toMatchObject({ ok: true, refreshed: 1 });
    answer = () => products([row({ price: 53 })]);
    expect((await syncNow()).status).toBe(200);
    expect((await externalOf(c.id))!["price"]).toBe(53);
  });
  it("says what went wrong as a code, never as the other side's words", async () => {
    const w = await world();
    answer = () => new Response(`secret ${TOKEN}`, { status: 401 });
    await loginAs(w.owner.id);
    const res = await syncNow();
    expect(res.json).toMatchObject({ ok: false, errorCode: "http_401" });
    expect(res.text).not.toContain(TOKEN);
    const status = await get();
    expect(status.json).toMatchObject({ lastErrorCode: "http_401" });
  });
  it("the status counts the linked sheets and the ones whose product is gone", async () => {
    const w = await world();
    await sheet(w, snap());
    await sheet(w, snap({ missingSince: "2026-01-01T00:00:00.000Z", code: "X" }));
    await sheet(w, null);
    await loginAs(w.owner.id);
    expect((await get()).json).toMatchObject({ linked: 2, missing: 1 });
  });
  it("taking it out drops the token and the row (allowed while the switch is off)", async () => {
    const w = await world({ on: false });
    await loginAs(w.owner.id);
    expect((await del()).status).toBe(200);
    expect(await db.integration.count({ where: { orgId: w.org.id, type: "OMS" } })).toBe(0);
  });
  it("tells the days left on the token, and warns 14 days before", async () => {
    const w = await world({ connected: false });
    await loginAs(w.owner.id);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await put({ ...good, tokenExpiresAt: soon });
    const s = (await get()).json as { daysLeft: number; tokenWarn: boolean };
    expect(s.daysLeft).toBeGreaterThanOrEqual(9);
    expect(s.daysLeft).toBeLessThanOrEqual(10);
    expect(s.tokenWarn).toBe(true);
    const far = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    await put({ ...good, tokenExpiresAt: far });
    expect(((await get()).json as { tokenWarn: boolean }).tokenWarn).toBe(false);
  });
});
