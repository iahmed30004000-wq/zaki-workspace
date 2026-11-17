import { afterEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as listRoute from "@/app/api/knowledge/route";
import * as sheetRoute from "@/app/api/knowledge/[id]/route";
import * as statusRoute from "@/app/api/knowledge/[id]/status/route";
import * as copyRoute from "@/app/api/knowledge/[id]/copy/route";
import * as settingsRoute from "@/app/api/knowledge/settings/route";
import * as parseRoute from "@/app/api/knowledge/parse/route";
import * as askRoute from "@/app/api/knowledge/[id]/ask/route";
import * as cardRoute from "@/app/api/cards/[id]/route";
import * as cardsRoute from "@/app/api/cards/route";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * Q1.1: the product sheet and its door. Against a real PostgreSQL.
 *
 * Pins: the switch off = 404 for everybody; a guest never (404); only the space's managers and the named editors write; a non-editor
 * never reads a sheet nobody approved and is always served the last APPROVED version with the LIVE price; an edit by an editor who
 * may not approve waits in review while the old version keeps being served; the owner (or a named approver) approves; the ordinary
 * card routes cannot see a sheet; the limits are enforced by the server; the copies are counted in the log; the settings are the
 * owner's.
 */

const afterEachCleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of afterEachCleanup.splice(0)) await fn();
});

async function setSettings(orgId: string, patch: Record<string, unknown>, features: Record<string, boolean> = {}) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let settings: Record<string, unknown> = { ...((org.settings as Record<string, unknown> | null) ?? {}), ...patch };
  for (const [k, on] of Object.entries(features)) settings = withFeature(settings, k as never, on);
  await db.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
}

async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  const agent = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Agent" });
  const named = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Named editor" });
  const outsider = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(
    team.org.id,
    [{ userId: team.admin.id }, { userId: team.member.id }, { userId: agent.id }, { userId: named.id }, { userId: team.guest.id, role: "GUEST" }],
    "المعرفة",
  );
  await setSettings(team.org.id, { knowledgeSpaceId: space.id, knowledgeEditorIds: [named.id], knowledgeApproverIds: [] }, { knowledgeCards: opts.on !== false });
  return { ...team, agent, named, outsider, space };
}
type World = Awaited<ReturnType<typeof world>>;

interface Sheet {
  id: string;
  name: string;
  status: string;
  version: number;
  approvedVersion: number | null;
  data: { tagline: string; sections: Array<{ key: string; items?: string[]; text?: string }>; caution?: { text: string }; faq: unknown[] } | null;
  external: { price: number; stale: boolean; currency: string } | null;
  canEdit: boolean;
  canApprove: boolean;
  gaps?: string[];
}
const sheetOf = (r: { json: Record<string, unknown> | null }) => r.json?.["sheet"] as Sheet;

const BASE = "http://localhost/api/knowledge";
const create = (body: unknown) => call(listRoute.POST, { method: "POST", url: BASE, body });
const list = (q = "") => call(listRoute.GET, { url: `${BASE}${q}` });
const get = (id: string) => call(sheetRoute.GET, { url: `${BASE}/${id}`, params: { id } });
const patch = (id: string, body: unknown) => call(sheetRoute.PATCH, { method: "PATCH", url: `${BASE}/${id}`, params: { id }, body });
const del = (id: string) => call(sheetRoute.DELETE, { method: "DELETE", url: `${BASE}/${id}`, params: { id } });
// the screen always sends the version it shows: so does the helper (the one it reads now), unless a test passes another
const status = async (id: string, to: string, version?: number) => {
  const seen = version ?? (await db.card.findUniqueOrThrow({ where: { id }, select: { version: true } })).version;
  return call(statusRoute.PUT, { method: "PUT", url: `${BASE}/${id}/status`, params: { id }, body: { status: to, version: seen } });
};

const data = (over: Record<string, unknown> = {}) => ({
  tagline: "زيت مساج دافي",
  badges: [],
  sections: [{ key: "benefit", title: "لشو بينفع", kind: "chips", items: ["آلام الظهر"] }],
  faq: [],
  ...over,
});

const snapshot = (price: number, over: Record<string, unknown> = {}) => ({ code: "H-1", name: "حراك", price, currency: "USD", offers: [], stockStatus: "in_stock", fetchedAt: new Date().toISOString(), ...over });
const link = (cardId: string, ext: Record<string, unknown>) => db.card.update({ where: { id: cardId }, data: { external: ext as Prisma.InputJsonValue } });

/** An editor (the space's manager) writes a sheet; the owner approves it. */
async function approved(w: World, over: Record<string, unknown> = {}) {
  await loginAs(w.admin.id);
  const made = await create({ title: "حراك", category: "العناية بالبشرة والجسم", data: data(over) });
  expect(made.status, made.text).toBe(201);
  const id = sheetOf(made).id;
  await link(id, snapshot(20));
  await loginAs(w.owner.id);
  expect((await status(id, "APPROVED")).status).toBe(200);
  return id;
}

describe("the switch and who may come in", () => {
  it("with the switch off, every door answers 404", async () => {
    const w = await world({ on: false });
    await loginAs(w.owner.id);
    expect((await list()).status).toBe(404);
    expect((await create({ title: "x" })).status).toBe(404);
    expect((await call(settingsRoute.GET, { url: `${BASE}/settings` })).status).toBe(404);
  });
  it("a guest never comes in, even into the space", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.guest.id);
    expect((await list()).status).toBe(404);
    expect((await get(id)).status).toBe(404);
    expect((await create({ title: "x" })).status).toBe(404);
  });
  it("a person outside the knowledge space reads nothing", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.outsider.id);
    expect((await get(id)).status).toBe(404);
    const l = await list();
    expect(l.status === 404 || (l.json?.["sheets"] as unknown[]).length === 0).toBe(true);
  });
  it("without a knowledge space the list says so", async () => {
    const w = await world();
    await setSettings(w.org.id, { knowledgeSpaceId: null });
    await loginAs(w.owner.id);
    const r = await list();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ configured: false, sheets: [] });
  });
});

describe("who writes", () => {
  it("the space's manager and a named editor write; a member and an agent do not (403)", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    expect((await create({ title: "من المشرفة" })).status).toBe(201);
    await loginAs(w.named.id);
    expect((await create({ title: "من المسمّاة" })).status).toBe(201);
    for (const who of [w.member, w.agent]) {
      await loginAs(who.id);
      expect((await create({ title: "ممنوع" })).status).toBe(403);
    }
    expect(await db.card.count({ where: { orgId: w.org.id, kind: "PRODUCT" } })).toBe(2);
  });
  it("a new sheet is a draft with every section of its category's template and no caution", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const made = sheetOf(await create({ title: "جهاز", category: "إلكترونيات" }));
    expect(made).toMatchObject({ status: "DRAFT", approvedVersion: null, canEdit: true });
    expect(made.data!.sections.map((s) => s.key)).toEqual(["benefit", "how", "operation", "specs", "warranty"]);
    expect(made.data!.caution).toBeUndefined();
  });
  it("the server holds the limits (422)", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const bad = await create({ title: "س", data: data({ tagline: "ا".repeat(121) }) });
    expect(bad.status).toBe(422);
    const made = sheetOf(await create({ title: "س" }));
    expect((await patch(made.id, { version: made.version, data: data({ faq: Array.from({ length: 31 }, () => ({ q: "س", a: "ج" })) }) })).status).toBe(422);
  });
  it("the ordinary card routes cannot make or see a sheet", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.admin.id);
    expect((await call(cardsRoute.POST, { method: "POST", url: "http://localhost/api/cards", body: { spaceId: w.space.id, kind: "PRODUCT", title: "x" } })).status).toBe(422);
    expect((await call(cardRoute.GET, { url: `http://localhost/api/cards/${id}`, params: { id } })).status).toBe(404);
    const generic = await call(cardsRoute.GET, { url: `http://localhost/api/cards?spaceId=${w.space.id}` });
    expect(JSON.stringify(generic.json)).not.toContain(id);
  });
});

describe("what a reader who is not an editor sees", () => {
  it("never a sheet nobody approved", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const draft = sheetOf(await create({ title: "مسودة" }));
    await loginAs(w.member.id);
    expect((await get(draft.id)).status).toBe(404);
    expect(JSON.stringify((await list()).json)).not.toContain(draft.id);
    await loginAs(w.admin.id);
    expect(JSON.stringify((await list()).json)).toContain(draft.id);
  });
  it("the approved sheet with the live price; a member holds the price a guest never does", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.member.id);
    const r = sheetOf(await get(id));
    expect(r).toMatchObject({ status: "APPROVED", canEdit: false, canApprove: false });
    expect(r.external).toMatchObject({ price: 20, currency: "USD", stale: false });
    expect(r.gaps).toBeUndefined();
  });
  it("the price is live: a new price shows without a new approval, and an old one is marked stale", async () => {
    const w = await world();
    const id = await approved(w);
    await link(id, snapshot(25));
    await loginAs(w.member.id);
    expect(sheetOf(await get(id)).external!.price).toBe(25);
    await link(id, snapshot(25, { fetchedAt: new Date(Date.now() - 31 * 60_000).toISOString() }));
    expect(sheetOf(await get(id)).external!.stale).toBe(true);
  });
  it("an edit by an editor who may not approve waits in review while the old version keeps being served", async () => {
    const w = await world();
    const id = await approved(w, { tagline: "القديم" });
    await loginAs(w.admin.id);
    const cur = sheetOf(await get(id));
    const edited = await patch(id, { version: cur.version, data: data({ tagline: "الجديد" }) });
    expect(edited.status, edited.text).toBe(200);
    expect(sheetOf(edited)).toMatchObject({ status: "REVIEW", approvedVersion: cur.version, version: cur.version + 1 });
    expect(sheetOf(edited).data!.tagline).toBe("الجديد");
    await loginAs(w.member.id);
    const served = sheetOf(await get(id));
    expect(served.data!.tagline).toBe("القديم");
    expect(served.external!.price).toBe(20);
    await loginAs(w.owner.id);
    expect((await status(id, "APPROVED")).status).toBe(200);
    await loginAs(w.member.id);
    expect(sheetOf(await get(id)).data!.tagline).toBe("الجديد");
  });
  it("an edit by the owner of an approved sheet stays approved", async () => {
    const w = await world();
    const id = await approved(w, { tagline: "القديم" });
    await loginAs(w.owner.id);
    const cur = sheetOf(await get(id));
    const edited = sheetOf(await patch(id, { version: cur.version, data: data({ tagline: "من المالك" }) }));
    expect(edited).toMatchObject({ status: "APPROVED", approvedVersion: cur.version + 1 });
    await loginAs(w.member.id);
    expect(sheetOf(await get(id)).data!.tagline).toBe("من المالك");
  });
  it("the caution is the team's: an editor sees it, a reader never does", async () => {
    const w = await world();
    const id = await approved(w, { caution: { text: "لا تعد بالشفاء" } });
    await loginAs(w.admin.id);
    expect(sheetOf(await get(id)).data!.caution).toEqual({ text: "لا تعد بالشفاء" });
    await loginAs(w.member.id);
    const r = await get(id);
    expect(sheetOf(r).data!.caution).toBeUndefined();
    expect(r.text).not.toContain("لا تعد بالشفاء");
  });
});

describe("approval", () => {
  it("the owner approves; a named approver approves; an editor who is neither cannot (403)", async () => {
    const w = await world();
    await setSettings(w.org.id, { knowledgeApproverIds: [w.named.id] });
    await loginAs(w.admin.id);
    const a = sheetOf(await create({ title: "أ" }));
    const b = sheetOf(await create({ title: "ب" }));
    expect((await status(a.id, "APPROVED")).status).toBe(403);
    expect((await status(a.id, "REVIEW")).status).toBe(200);
    expect((await status(a.id, "APPROVED")).status).toBe(403);
    await loginAs(w.named.id);
    expect((await status(a.id, "APPROVED")).status).toBe(200);
    await loginAs(w.owner.id);
    expect((await status(b.id, "APPROVED")).status).toBe(200);
    expect((await db.card.findUniqueOrThrow({ where: { id: b.id } })).approvedVersion).toBe(1);
  });
  it("a member who is not an editor cannot move a status or delete (403)", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.member.id);
    expect((await status(id, "REVIEW")).status).toBe(403);
    expect((await del(id)).status).toBe(403);
    expect((await patch(id, { version: 1, title: "x" })).status).toBe(403);
  });
  it("deleting an approved sheet (an approver's act) hides it from everybody and removes nothing", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.admin.id);
    expect((await del(id)).status).toBe(403);
    await loginAs(w.owner.id);
    expect((await del(id)).status).toBe(200);
    await loginAs(w.member.id);
    expect((await get(id)).status).toBe(404);
    expect(await db.card.count({ where: { id } })).toBe(1);
  });
});

describe("the list", () => {
  it("finds by the Arabic folding and by category, and an editor sees what each sheet lacks", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.admin.id);
    const other = sheetOf(await create({ title: "قميص", category: "ملابس" }));
    const all = (await list()).json!["sheets"] as Array<{ id: string; gaps?: string[] }>;
    expect(all.map((s) => s.id).sort()).toEqual([id, other.id].sort());
    expect(all.find((s) => s.id === other.id)!.gaps).toEqual(["photo", "tagline", "sections", "faq"]);
    expect(((await list("?q=قمیص")).json!["sheets"] as unknown[]).length).toBe(1);
    expect(((await list(`?category=${encodeURIComponent("ملابس")}`)).json!["sheets"] as Array<{ id: string }>).map((s) => s.id)).toEqual([other.id]);
    await loginAs(w.member.id);
    const seen = (await list()).json!["sheets"] as Array<{ id: string; gaps?: string[] }>;
    expect(seen.map((s) => s.id)).toEqual([id]);
    expect(seen[0]!.gaps).toBeUndefined();
  });
});

describe("the log", () => {
  it("a copy is counted: who copied what, to the owner's trail", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.member.id);
    const r = await call(copyRoute.POST, { method: "POST", url: `${BASE}/${id}/copy`, params: { id }, body: { what: "offer" } });
    expect(r.status).toBe(200);
    const rows = await db.auditLog.findMany({ where: { orgId: w.org.id, target: id, action: "card.copied" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(w.member.id);
    expect(rows[0]!.meta).toMatchObject({ what: "offer" });
    await loginAs(w.guest.id);
    expect((await call(copyRoute.POST, { method: "POST", url: `${BASE}/${id}/copy`, params: { id }, body: { what: "offer" } })).status).toBe(404);
  });
});

describe("the settings are the owner's", () => {
  const URL_S = `${BASE}/settings`;
  it("only the owner reads or writes them (403)", async () => {
    const w = await world();
    for (const who of [w.admin, w.member]) {
      await loginAs(who.id);
      expect((await call(settingsRoute.GET, { url: URL_S })).status).toBe(403);
      expect((await call(settingsRoute.PUT, { method: "PUT", url: URL_S, body: { spaceId: w.space.id } })).status).toBe(403);
    }
  });
  it("saves the space, the editors, the approvers and the delivery sentence; refuses a space or a person of another company", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const stranger = await makeTeam();
    const otherSpace = await makeWorkspace(stranger.org.id, [{ userId: stranger.member.id }], "غريب");
    const ok = await call(settingsRoute.PUT, { method: "PUT", url: URL_S, body: { spaceId: w.space.id, editorIds: [w.admin.id], approverIds: [w.named.id], deliveryLine: "توصيل مجاني · دفع عند الاستلام" } });
    expect(ok.status, ok.text).toBe(200);
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    expect(org.settings).toMatchObject({ knowledgeSpaceId: w.space.id, knowledgeEditorIds: [w.admin.id], knowledgeApproverIds: [w.named.id], knowledgeDeliveryLine: "توصيل مجاني · دفع عند الاستلام" });
    expect((await call(settingsRoute.PUT, { method: "PUT", url: URL_S, body: { spaceId: otherSpace.id } })).status).toBe(422);
    expect((await call(settingsRoute.PUT, { method: "PUT", url: URL_S, body: { spaceId: w.space.id, editorIds: [stranger.member.id] } })).status).toBe(422);
    expect((await call(settingsRoute.PUT, { method: "PUT", url: URL_S, body: { spaceId: w.space.id, editorIds: [w.guest.id] } })).status).toBe(422);
  });
  it("keeps the company's other settings (the switches) when it saves", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await call(settingsRoute.PUT, { method: "PUT", url: URL_S, body: { spaceId: w.space.id } });
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    expect(JSON.stringify(org.settings)).toContain("knowledgeCards");
  });
});

describe("«اسألي مشرفتك»", () => {
  const ask = (id: string, question: string) => call(askRoute.POST, { method: "POST", url: `${BASE}/${id}/ask`, params: { id }, body: { question } });
  it("a question nothing answers becomes a ticket for the named approver", async () => {
    const w = await world();
    await setSettings(w.org.id, { knowledgeApproverIds: [w.named.id] });
    const id = await approved(w);
    await loginAs(w.admin.id);
    const r = await ask(id, "هل بينفع للحوامل؟");
    expect(r.status, r.text).toBe(201);
    const t = await db.ticket.findUniqueOrThrow({ where: { id: r.json!["ticketId"] as string } });
    expect(t.assigneeId).toBe(w.named.id);
    expect(t.title).toContain("حراك");
    expect(t.description).toBe("هل بينفع للحوامل؟");
  });
  it("without a named approver it goes to the owner; a guest cannot ask (404)", async () => {
    const w = await world();
    const id = await approved(w);
    await loginAs(w.admin.id);
    const r = await ask(id, "كم مدة الكفالة؟");
    expect(r.status, r.text).toBe(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: r.json!["ticketId"] as string } })).assigneeId).toBe(w.owner.id);
    await loginAs(w.guest.id);
    expect((await ask(id, "كم مدة الكفالة؟")).status).toBe(404);
    await loginAs(w.admin.id);
    expect((await ask(id, "ab")).status).toBe(422);
  });
});

describe("«الصقي كرت قديم»", () => {
  it("an editor gets the parsed card for the category's template; a member is refused", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const r = await call(parseRoute.POST, { method: "POST", url: `${BASE}/parse`, body: { text: "حراك\nالوصف: زيت دافي\nلشو بينفع:\n- ظهر\nالسعر: 20$", category: "العناية بالبشرة والجسم" } });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ name: "حراك", priceSeen: 1 });
    expect((r.json!["data"] as { tagline: string }).tagline).toBe("زيت دافي");
    await loginAs(w.member.id);
    expect((await call(parseRoute.POST, { method: "POST", url: `${BASE}/parse`, body: { text: "x" } })).status).toBe(403);
  });
});
