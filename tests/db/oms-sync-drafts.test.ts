import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { withFeature } from "@/lib/features";
import { encryptSecrets } from "@/server/crypto";
import { setOmsOptionsForTests } from "@/server/integrations/oms";
import { syncOrg } from "@/server/integrations/oms-sync";
import { db, makeTeam, makeWorkspace } from "./helpers";

/**
 * Q1.1 (what Q1.0 left for it): the sync makes a DRAFT sheet for each product that has none, in the knowledge space, authored by the person
 * who connected the orders system (the primary owner when he is no longer active). It never makes one twice, never for a product whose code
 * is shared, and nothing at all while the switch is off or no space is set.
 */
const KEY = "oms-drafts-key-0123456789-abcdefghijk";
let answer: () => Response = () => new Response("{}");
let clock = 0;
const saved: Record<string, string | undefined> = {};
const list = (rows: unknown[]) => new Response(JSON.stringify({ data: rows }), { status: 200 });
const prod = (over: Record<string, unknown> = {}) => ({ id: "p1", code: "H-1", name: "حراك", category: "العناية بالبشرة والجسم", price: 20, currency: "USD", stock_status: "in_stock", ...over });
const at = () => new Date(Date.UTC(2030, 0, 1) + (clock += 6 * 60_000));

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
  setOmsOptionsForTests({ resolve: async () => ["93.184.216.34"], fetchImpl: (async () => answer()) as typeof fetch });
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

async function world(opts: { knowledge?: boolean; space?: boolean } = {}) {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id }, { userId: team.member.id }], "المعرفة");
  let settings: Record<string, unknown> = opts.space === false ? {} : { knowledgeSpaceId: space.id };
  settings = withFeature(withFeature(settings, "omsLink", true), "knowledgeCards", opts.knowledge !== false);
  await db.organization.update({ where: { id: team.org.id }, data: { settings: settings as Prisma.InputJsonValue } });
  await db.integration.create({
    data: { orgId: team.org.id, type: "OMS", connected: true, secretEnc: encryptSecrets({ token: "tok" }), config: { baseUrl: "https://oms.example.test", connectedById: team.admin.id } },
  });
  return { ...team, space };
}
const sheets = (orgId: string) => db.card.findMany({ where: { orgId, kind: "PRODUCT" }, orderBy: { createdAt: "asc" } });

describe("a draft for a product that has none", () => {
  it("is made in the knowledge space with the snapshot, the template and the connector as its author", async () => {
    const w = await world();
    answer = () => list([prod()]);
    await syncOrg(w.org.id, at());
    const [card, ...rest] = await sheets(w.org.id);
    expect(rest).toHaveLength(0);
    expect(card).toMatchObject({ title: "حراك", category: "العناية بالبشرة والجسم", status: "DRAFT", approvedVersion: null, workspaceId: w.space.id, createdById: w.admin.id });
    expect(card!.external).toMatchObject({ id: "p1", code: "H-1", price: 20 });
    const data = card!.data as { sections: Array<{ key: string }>; caution?: unknown };
    expect(data.sections.map((s) => s.key)).toEqual(["benefit", "how", "usage", "ingredients"]);
    expect(data.caution).toBeUndefined();
  });
  it("is made once: the next run refreshes the sheet and makes no second", async () => {
    const w = await world();
    answer = () => list([prod()]);
    await syncOrg(w.org.id, at());
    answer = () => list([prod({ price: 22 })]);
    await syncOrg(w.org.id, at());
    const all = await sheets(w.org.id);
    expect(all).toHaveLength(1);
    expect((all[0]!.external as { price: number }).price).toBe(22);
    expect(await db.cardRevision.count({ where: { cardId: all[0]!.id } })).toBe(0);
  });
  it("is not made for a product whose code another product shares", async () => {
    const w = await world();
    answer = () => list([prod({ id: "p1", name: "أ" }), prod({ id: "p2", name: "ب" }), prod({ id: "p3", code: "Z-9", name: "ج" })]);
    await syncOrg(w.org.id, at());
    expect((await sheets(w.org.id)).map((c) => c.title)).toEqual(["ج"]);
  });
  it("is not made while the switch is off or no space is set", async () => {
    const off = await world({ knowledge: false });
    const noSpace = await world({ space: false });
    answer = () => list([prod()]);
    await syncOrg(off.org.id, at());
    await syncOrg(noSpace.org.id, at());
    expect(await sheets(off.org.id)).toHaveLength(0);
    expect(await sheets(noSpace.org.id)).toHaveLength(0);
  });
  it("is not made again for a sheet an editor deleted", async () => {
    const w = await world();
    answer = () => list([prod()]);
    await syncOrg(w.org.id, at());
    await db.card.updateMany({ where: { orgId: w.org.id, kind: "PRODUCT" }, data: { archivedAt: new Date() } });
    await syncOrg(w.org.id, at());
    expect(await sheets(w.org.id)).toHaveLength(1);
  });
  it("falls back to the primary owner when the connector is no longer active", async () => {
    const w = await world();
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: w.admin.id }, data: { status: "SUSPENDED" } });
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: w.owner.id }, data: { primaryOwner: true } });
    answer = () => list([prod()]);
    await syncOrg(w.org.id, at());
    expect((await sheets(w.org.id))[0]!.createdById).toBe(w.owner.id);
  });
  it("a product the door gave no category gets the «other» template", async () => {
    const w = await world();
    answer = () => list([prod({ category: undefined })]);
    await syncOrg(w.org.id, at());
    const card = (await sheets(w.org.id))[0]!;
    expect(card.category).toBeNull();
    expect((card.data as { sections: Array<{ key: string }> }).sections.map((s) => s.key)).toEqual(["benefit", "usage", "specs"]);
  });
});
