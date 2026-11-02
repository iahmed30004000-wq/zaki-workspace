import "./scoping-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// the pages call redirect() / notFound(); the client parts call useRouter(): no running Next app is needed here
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import type { Prisma } from "@prisma/client";
import HomePage from "@/app/(app)/page";
import OwnerPage from "@/app/(app)/owner/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import * as aiRoute from "@/app/api/control-panel/ai/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { setLocalTransportForTests, type LocalHttpRequest, type LocalTransport } from "@/server/ai/local-transport";
import { requireActor } from "@/server/policy/actor";
import { loadAnalytics } from "@/server/services/analytics";
import { controlPanelAccess, loadPanelHome, loadPanelReports } from "@/server/services/control-panel";
import { resetZakiAiCacheForTests, zakiAiStatus } from "@/server/services/zaki-ai";
import { getSettings } from "@/server/services/owner-assistant-settings";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { html } from "./today-helpers";

/**
 * «لوحة التحكم» — the owner's panel on the home screen, «التقارير» merged into it, and «زاكي أي أي» connected, against a real PostgreSQL.
 *
 * What this pins:
 *  - who: the OWNER rank alone (the primary owner and a partner); an admin, a lead, a member and a guest get «not found» on the panel, on its
 *    routes and on «اليوم»; the two switches («لوحة التحكم» and «لوحة المالك» under it) take it away from the owner too, and the pages are then
 *    exactly what they were;
 *  - the numbers: the company's day, a task counted once, the sentences that follow from them (overdue and where, late people, idle people,
 *    unassigned, stale, ideas waiting, the week against the one before) and nothing invented for a quiet company;
 *  - the reports: the same totals as the old report, an 8-week series in the right buckets, one row per space, a space filter that cannot reach
 *    another company's space;
 *  - «زاكي أي أي»: not saved / not reachable / connected / model missing, the key write-only and never in an answer, an address that is not
 *    internal refused, and the owner's assistant switched over ONLY when the test passed.
 */

const NOW = new Date("2026-10-30T09:00:00Z"); // 12:00 in Damascus (UTC+3), a Friday
const DAY = 86_400_000;
const ago = (days: number, base: Date = NOW) => new Date(base.getTime() - days * DAY);
const GATEWAY_KEY = "zk-agent-LOCALAI-never-appears-9876543210abcd"; // scan-secrets:ignore
const ADDRESS = "http://hermes-agent:8642";

beforeEach(() => resetZakiAiCacheForTests());
afterEach(() => {
  setLocalTransportForTests(null);
  resetZakiAiCacheForTests();
  vi.restoreAllMocks();
});

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world() {
  const t = await makeTeam();
  const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "ليلى" });
  const sara = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "سارة" });
  const omar = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "عمر" });
  const partner = await makeUser({ orgId: t.org.id, role: "OWNER", name: "الشريك" });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: partner.id } }, data: { primaryOwner: false } });
  const sales = await makeWorkspace(t.org.id, [{ userId: sara.id }, { userId: omar.id }, { userId: lead.id, role: "ADMIN" }], "المبيعات");
  const media = await makeWorkspace(t.org.id, [{ userId: sara.id }], "التسويق");
  const ps = await makeProject(sales.id, "مشروع المبيعات");
  const pm = await makeProject(media.id, "مشروع التسويق");
  const task = async (where: "sales" | "media", title: string, o: { assigneeId?: string | null; completedAt?: Date | null; dueDate?: Date | null; createdAt?: Date; updatedAt?: Date } = {}) => {
    const w = where === "sales" ? { ws: sales, p: ps } : { ws: media, p: pm };
    const row = await makeTask({
      orgId: t.org.id,
      workspaceId: w.ws.id,
      projectId: w.p.project.id,
      boardId: w.p.board.id,
      columnId: o.completedAt ? w.p.done.id : w.p.todo.id,
      creatorId: t.owner.id,
      assigneeId: o.assigneeId ?? null,
      title,
      dueDate: o.dueDate ?? null,
      completedAt: o.completedAt ?? null,
    });
    // `updatedAt` is stamped by the database layer on every write: set both dates by hand (a raw statement leaves them alone)
    if (o.createdAt || o.updatedAt) {
      await db.$executeRaw`UPDATE "Task" SET "createdAt" = ${o.createdAt ?? row.createdAt}, "updatedAt" = ${o.updatedAt ?? o.createdAt ?? row.updatedAt} WHERE "id" = ${row.id}`;
    }
    return row;
  };
  return { ...t, lead, sara, omar, partner, sales, media, ps, pm, task };
}
type World = Awaited<ReturnType<typeof world>>;

async function accessAs(userId: string) {
  await loginAs(userId);
  return controlPanelAccess(await requireActor());
}

/** A busy week: late work, work finished today and last week, a person with nothing to show, a task nobody holds, one that stopped. */
async function busyWeek(w: World) {
  // finished today (12:00 Damascus: the day began at 21:00 UTC the day before)
  await w.task("sales", "خلصت اليوم 1", { assigneeId: w.sara.id, completedAt: ago(0.1), dueDate: ago(0.5), createdAt: ago(5) });
  await w.task("sales", "خلصت اليوم 2", { assigneeId: w.sara.id, completedAt: ago(0.05), dueDate: ago(3), createdAt: ago(8) }); // late: due 3 days before
  // finished earlier this week, and in the week before it
  await w.task("sales", "خلصت قبل يومين", { assigneeId: w.omar.id, completedAt: ago(2), dueDate: ago(2), createdAt: ago(6) });
  for (let i = 0; i < 4; i++) await w.task("media", `الأسبوع الماضي ${i}`, { assigneeId: w.sara.id, completedAt: ago(9 + i), dueDate: ago(9 + i), createdAt: ago(15) });
  // late and open: 3 for sara (sales 2 + media 1), 1 for omar
  await w.task("sales", "متأخرة 1", { assigneeId: w.sara.id, dueDate: ago(4), createdAt: ago(10) });
  await w.task("sales", "متأخرة 2", { assigneeId: w.sara.id, dueDate: ago(6), createdAt: ago(10) });
  await w.task("media", "متأخرة 3", { assigneeId: w.sara.id, dueDate: ago(2), createdAt: ago(10) });
  await w.task("sales", "متأخرة 4", { assigneeId: w.omar.id, dueDate: ago(1), createdAt: ago(10) });
  // nobody holds it, and one that has not been touched for 20 days
  await w.task("sales", "بدون مسؤول", { assigneeId: null, createdAt: ago(1) });
  await w.task("sales", "واقفة", { assigneeId: w.omar.id, dueDate: null, createdAt: ago(30), updatedAt: ago(20) });
}

// ───────────────────────────────────────── who ─────────────────────────────────────────

describe("who may open the control panel", () => {
  it("the owner and a partner read it; an admin, a lead, a member and a guest get «not found»", async () => {
    const w = await world();
    for (const owner of [w.owner, w.partner]) {
      await loginAs(owner.id);
      const access = await controlPanelAccess(await requireActor());
      expect(access).toMatchObject({ mode: "owner", orgId: w.org.id, companyWide: true });
      expect((await call(aiRoute.GET)).status, owner.name).toBe(200);
    }
    for (const person of [w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      await expect(controlPanelAccess(await requireActor()), person.name).rejects.toMatchObject({ name: "NotFoundError" });
      expect((await call(aiRoute.GET)).status, person.name).toBe(404);
      expect((await call(aiRoute.POST, { body: { baseUrl: ADDRESS, model: "hermes-agent" } })).status, person.name).toBe(404);
    }
    expect(await db.aiSettings.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("with «لوحة التحكم» off, or «لوحة المالك» under it, even the owner gets «not found» and the pages are as they were", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect(await html(await HomePage())).toContain('data-testid="control-panel"');

    await setFeature(w.org.id, "controlPanel", false);
    await expect(controlPanelAccess(await requireActor())).rejects.toMatchObject({ name: "NotFoundError" });
    expect((await call(aiRoute.GET)).status).toBe(404);
    expect(await html(await HomePage())).not.toContain('data-testid="control-panel"');
    const old = await html(await OwnerPage({ searchParams: {} }));
    expect(old).toContain(AR["ownerboard.title.owner"]);
    expect(old).not.toContain('data-testid="cp-nav"');
    // «التقارير» is its own page again for the owner
    await expect(AnalyticsPage()).resolves.toBeTruthy();

    await setFeature(w.org.id, "controlPanel", true);
    await setFeature(w.org.id, "ownerBoard", false);
    await expect(controlPanelAccess(await requireActor())).rejects.toMatchObject({ name: "NotFoundError" });
    expect(await html(await HomePage())).not.toContain('data-testid="control-panel"');
    await expect(AnalyticsPage()).resolves.toBeTruthy();
  });

  it("«اليوم» draws the panel for the owner and for nobody else", async () => {
    const w = await world();
    for (const person of [w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      expect(await html(await HomePage()), person.name).not.toContain('data-testid="control-panel"');
    }
    for (const owner of [w.owner, w.partner]) {
      await loginAs(owner.id);
      const page = await html(await HomePage());
      expect(page, owner.name).toContain('data-testid="control-panel"');
      expect(page).toContain(AR["cp.title"]);
      expect(page).toContain('data-testid="zaki-ai-chip"');
    }
  });

  it("/owner is the panel for the owner (four sections), and the old board for a lead who holds the team switch", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    for (const v of ["overview", "people", "reports", "ai"]) {
      const page = await html(await OwnerPage({ searchParams: { v } }));
      expect(page, v).toContain('data-testid="cp-nav"');
      expect(page, v).toContain(`data-section="${v}"`);
    }
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.lead.id } }, data: { capabilities: ["board.team"] } });
    await loginAs(w.lead.id);
    const board = await html(await OwnerPage({ searchParams: { v: "reports" } }));
    expect(board).not.toContain('data-testid="cp-nav"');
    expect(board).toContain(AR["ownerboard.title.team"]);
  });

  it("/analytics sends the owner into «التقارير» of the panel; an admin keeps the old page", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await expect(AnalyticsPage()).rejects.toThrow("NEXT_REDIRECT:/owner?v=reports");
    await loginAs(w.admin.id);
    await expect(AnalyticsPage()).resolves.toBeTruthy();
  });
});

// ───────────────────────────────────────── the numbers ─────────────────────────────────────────

describe("the panel's numbers and sentences", () => {
  it("the cards: done today (a task once), the company's overdue and open work, the week against the week before, the on-time rate", async () => {
    const w = await world();
    await busyWeek(w);
    const home = await loadPanelHome(await accessAs(w.owner.id), NOW);
    expect(home.today).toBe("2026-10-30");
    expect(home.kpis).toMatchObject({
      doneToday: 2,
      overdue: 4,
      open: 6,
      completedWeek: 3, // two today and one two days ago
      completedPrev: 4, // the four of nine to twelve days ago... of which those within the previous 7 days
      staff: expect.any(Number),
    });
    // the week: today(2) + 2 days ago(1): 3 finished, the three with a day: 2 on time (one was 3 days late)
    expect(home.kpis.onTimeRate).toBe(67);
    expect(home.kpis.activeToday).toBeGreaterThanOrEqual(1);
  });

  it("the sentences: the overdue and where most of it is, the late people, the idle ones, unassigned, stale — each only when true", async () => {
    const w = await world();
    await busyWeek(w);
    const home = await loadPanelHome(await accessAs(w.owner.id), NOW);
    const by = (id: string) => home.insights.find((i) => i.id === id);
    expect(by("overdue")).toMatchObject({ tone: "warn", params: { n: 4, space: "المبيعات", spaceN: 3 } });
    expect(by("late_people")?.params["names"]).toBe("سارة (3)");
    expect(by("late_people")?.people).toEqual([w.sara.id]);
    expect(by("unassigned")?.params).toEqual({ n: 1 });
    expect(by("stale")?.params).toMatchObject({ n: 1 });
    // the idle: staff who recorded nothing in 3 days (the lead, the admin, the member and the guest-less rest) are named, sara and omar are not
    const idle = by("idle_people");
    expect(idle?.people).not.toContain(w.sara.id);
    expect(idle?.people).not.toContain(w.omar.id);
    // warnings first, then what to know, then the good news
    const tones = home.insights.map((i) => i.tone);
    expect(tones.lastIndexOf("warn")).toBeLessThan(tones.indexOf("good") === -1 ? Infinity : tones.indexOf("good"));
    expect(by("all_clear")).toBeUndefined();
  });

  it("an idea that waited more than 7 days for its first look is counted; a fresh one and a reviewed one are not", async () => {
    const w = await world();
    const idea = (title: string, status: "NEW" | "UNDER_REVIEW", createdAt: Date) =>
      db.idea.create({ data: { orgId: w.org.id, creatorId: w.owner.id, title, status, createdAt } });
    await idea("قديمة", "NEW", ago(10));
    await idea("جديدة", "NEW", ago(1));
    await idea("انراجعت", "UNDER_REVIEW", ago(30));
    const home = await loadPanelHome(await accessAs(w.owner.id), NOW);
    expect(home.insights.find((i) => i.id === "ideas_waiting")?.params).toEqual({ n: 1, days: 7 });
  });

  it("a quiet company with nobody late: «ما في شي يستدعي الانتباه» and no warning", async () => {
    const w = await world();
    // everybody acted today; nothing is late
    await w.task("sales", "اليوم 1", { assigneeId: w.sara.id, completedAt: ago(0.1), dueDate: ago(0.1), createdAt: ago(2) });
    const everybody = [w.owner, w.partner, w.admin, w.lead, w.member, w.sara, w.omar];
    for (const person of everybody) {
      await db.chatMessage.deleteMany({ where: { authorId: person.id } });
    }
    const home = await loadPanelHome(await accessAs(w.owner.id), NOW);
    expect(home.kpis.overdue).toBe(0);
    expect(home.insights.some((i) => i.tone === "warn" && i.id !== "idle_people" && i.id !== "trend_down")).toBe(false);
  });

  it("reading leaves no trace: no audit row, no notification, no workspace membership for the owner", async () => {
    const w = await world();
    await busyWeek(w);
    const before = { audit: await db.auditLog.count({ where: { orgId: w.org.id } }), notes: await db.notification.count(), members: await db.workspaceMember.count({ where: { workspaceId: w.sales.id } }) };
    await loadPanelHome(await accessAs(w.owner.id), NOW);
    await loadPanelReports(await accessAs(w.owner.id), {}, NOW);
    expect(await db.auditLog.count({ where: { orgId: w.org.id } })).toBe(before.audit);
    expect(await db.notification.count()).toBe(before.notes);
    expect(await db.workspaceMember.count({ where: { workspaceId: w.sales.id } })).toBe(before.members);
  });

  it("another company's work never counts", async () => {
    const w = await world();
    const other = await world();
    await busyWeek(other);
    const home = await loadPanelHome(await accessAs(w.owner.id), NOW);
    expect(home.kpis).toMatchObject({ doneToday: 0, overdue: 0, open: 0, completedWeek: 0 });
  });
});

// ───────────────────────────────────────── the reports ─────────────────────────────────────────

describe("the merged reports", () => {
  it("the totals are the old report's totals, and the owner reads every space", async () => {
    const w = await world();
    await busyWeek(w);
    const access = await accessAs(w.owner.id);
    const r = await loadPanelReports(access, {}, NOW);
    const spaces = await db.workspace.findMany({ where: { organizationId: w.org.id }, select: { id: true } });
    const old = await loadAnalytics(w.org.id, spaces.map((s) => s.id), NOW);
    expect(r.totals).toMatchObject({ total: old.total, open: old.open, completed: old.completed, overdue: old.overdue, created30: old.created30, completed30: old.completed30, upcoming7: old.upcoming7 });
    expect(r.spaces.map((s) => s.name).sort()).toEqual(["التسويق", "المبيعات"]);
    expect(r.bySpace.map((s) => [s.name, s.open, s.overdue])).toEqual([
      ["المبيعات", 5, 3],
      ["التسويق", 1, 1],
    ]);
    expect(r.workload.find((x) => x.userId === w.sara.id)?.n).toBe(3);
  });

  it("the weekly series puts a task in the week it was made and the week it was finished (company days, 7 per bar, the last bar ends today)", async () => {
    const w = await world();
    await w.task("sales", "اليوم", { assigneeId: w.sara.id, createdAt: ago(0.2) }); // bucket 0
    await w.task("sales", "قبل 6 أيام", { assigneeId: w.sara.id, createdAt: ago(6) }); // still bucket 0
    await w.task("sales", "قبل 8 أيام", { assigneeId: w.sara.id, createdAt: ago(8) }); // bucket 1
    await w.task("sales", "قبل 20 يوم", { assigneeId: w.sara.id, createdAt: ago(20), completedAt: ago(15) }); // created bucket 2, finished bucket 2
    await w.task("sales", "قديمة جدًا", { assigneeId: w.sara.id, createdAt: ago(100) }); // outside the 8 weeks
    const r = await loadPanelReports(await accessAs(w.owner.id), {}, NOW);
    expect(r.series).toHaveLength(8);
    expect(r.series.map((p) => p.ago)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    const at = (ago: number) => r.series.find((p) => p.ago === ago)!;
    expect(at(0)).toMatchObject({ created: 2, completed: 0 });
    expect(at(1)).toMatchObject({ created: 1 });
    expect(at(2)).toMatchObject({ created: 1, completed: 1 });
    expect(r.series.reduce((n, p) => n + p.created, 0)).toBe(4);
  });

  it("a space filter narrows every number; a space of another company is «not found»", async () => {
    const w = await world();
    await busyWeek(w);
    const other = await world();
    const access = await accessAs(w.owner.id);
    const media = await loadPanelReports(access, { space: w.media.id }, NOW);
    expect(media.spaceId).toBe(w.media.id);
    expect(media.totals.total).toBe(5);
    expect(media.bySpace.map((s) => s.name)).toEqual(["التسويق"]);
    await expect(loadPanelReports(access, { space: other.sales.id }, NOW)).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("the page of the section draws the totals, the chart, the table of spaces and a space select", async () => {
    const w = await world();
    await busyWeek(w);
    await loginAs(w.owner.id);
    const page = await html(await OwnerPage({ searchParams: { v: "reports" } }));
    for (const id of ["cp-reports", "cp-series"]) expect(page).toContain(`data-testid="${id}"`);
    expect(page).toContain("المبيعات");
    expect(page).toContain(AR["cp.rep.by_space"]);
    // the old report's own words are reused, not copied
    expect(page).toContain(AR["analytics.openByPriority"]);
  });
});

// ───────────────────────────────────────── «زاكي أي أي» ─────────────────────────────────────────

/** A service that speaks the OpenAI-compatible dialect: lists `models` and answers a ping; `needKey` refuses a call without the Bearer key. */
function fakeAgent(opts: { models?: string[]; needKey?: string; log?: LocalHttpRequest[] } = {}): LocalTransport {
  return async (req) => {
    opts.log?.push(req);
    if (opts.needKey && req.headers["authorization"] !== `Bearer ${opts.needKey}`) return { status: 401, text: JSON.stringify({ error: "no" }) };
    if (req.method === "GET" && req.url.endsWith("/v1/models")) return { status: 200, text: JSON.stringify({ data: (opts.models ?? ["hermes-agent"]).map((id) => ({ id })) }) };
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "أهلا" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }) };
  };
}
const connect = (body: Record<string, unknown>) => call(aiRoute.POST, { body });

describe("«زاكي أي أي» — is it connected", () => {
  it("nothing saved: «غير مربوط», with the address and the model name to suggest and nothing asked of the network", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const log: LocalHttpRequest[] = [];
    setLocalTransportForTests(fakeAgent({ log }));
    const res = await call(aiRoute.GET);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ state: "not_set", inUse: false, baseUrl: null, model: null, hasKey: false, suggested: { baseUrl: ADDRESS, model: "hermes-agent" } });
    expect(log).toEqual([]);
  });

  it("«اربط واختبر»: saves the address, the model and the key, tests with the key, and makes the owner's assistant use it", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const log: LocalHttpRequest[] = [];
    setLocalTransportForTests(fakeAgent({ needKey: GATEWAY_KEY, log }));
    const res = await connect({ baseUrl: ADDRESS, model: "hermes-agent", key: GATEWAY_KEY, confirmLocal: false });
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ state: "connected", inUse: true, baseUrl: ADDRESS, model: "hermes-agent", hasKey: true, keyLast4: GATEWAY_KEY.slice(-4), confirmedLocal: false, models: ["hermes-agent"] });
    // only the list of models was asked: the agent was never asked a question
    expect(log.map((r) => `${r.method} ${r.url}`)).toEqual([`GET ${ADDRESS}/v1/models`, `GET ${ADDRESS}/v1/models`]);
    expect(log.every((r) => r.headers["authorization"] === `Bearer ${GATEWAY_KEY}`)).toBe(true);
    const saved = await getSettings(w.org.id);
    expect(saved).toMatchObject({ ownerProvider: "openai", gatewayBaseUrl: ADDRESS, gatewayModel: "hermes-agent", hasGatewayKey: true, gatewayConfirmedLocal: false });
    // the key is write-only: in no answer and in no row in clear
    expect(res.text).not.toContain(GATEWAY_KEY);
    expect(JSON.stringify(await db.aiSettings.findMany())).not.toContain(GATEWAY_KEY);
    // and a status read says the same
    resetZakiAiCacheForTests();
    expect((await call(aiRoute.GET)).json).toMatchObject({ state: "connected", inUse: true });
  });

  it("a wrong key is «ما بيرد» with the refusal's sentence; what was typed stays saved, and the owner's assistant is NOT switched over", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    setLocalTransportForTests(fakeAgent({ needKey: "the-real-key-0123456789abcdef" }));
    const res = await connect({ baseUrl: ADDRESS, model: "hermes-agent", key: GATEWAY_KEY });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ state: "unreachable", inUse: false, reason: "assistant.err_key_rejected", hasKey: true });
    expect(AR["assistant.err_key_rejected"]).toBeTruthy();
    expect((await getSettings(w.org.id)).ownerProvider).toBe("claude");
  });

  it("a service that is down: unreachable with a dictionary key; once it is back, the same button connects", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    setLocalTransportForTests(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 172.18.0.5:8642"), { code: "ECONNREFUSED" });
    });
    const down = await connect({ baseUrl: ADDRESS, model: "hermes-agent" });
    expect(down.json).toMatchObject({ state: "unreachable", reason: "assistant.err_local_down", inUse: false });
    expect(down.text).not.toContain("172.18.0.5");
    setLocalTransportForTests(fakeAgent());
    expect((await connect({ baseUrl: ADDRESS, model: "hermes-agent" })).json).toMatchObject({ state: "connected", inUse: true });
  });

  it("a model the service does not list is «النموذج مش موجود», and is not switched over", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    setLocalTransportForTests(fakeAgent({ models: ["another-model"] }));
    const res = await connect({ baseUrl: ADDRESS, model: "hermes-agent" });
    expect(res.json).toMatchObject({ state: "model_missing", reason: "assistant.err_local_missing", inUse: false });
    expect((await getSettings(w.org.id)).ownerProvider).toBe("claude");
  });

  it("an address that is not on the owner's own network is refused with a sentence, and nothing is saved", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    setLocalTransportForTests(fakeAgent());
    for (const baseUrl of ["https://api.openai.com", "http://169.254.169.254", "http://example.com:8642", "ftp://hermes-agent", "http://user:pw@hermes-agent:8642"]) {
      const res = await connect({ baseUrl, model: "hermes-agent" });
      expect(res.status, baseUrl).toBe(422);
    }
    expect((await connect({ baseUrl: ADDRESS, model: "bad model name!" })).status).toBe(422);
    expect((await connect({ baseUrl: ADDRESS, model: "hermes-agent", extra: 1 })).status).toBe(422);
    expect(await db.aiSettings.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("the owner's tick «النموذج محلي» is kept, and the status says which kind of model it is treated as", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    setLocalTransportForTests(fakeAgent());
    expect((await connect({ baseUrl: ADDRESS, model: "hermes-agent", confirmLocal: true })).json).toMatchObject({ state: "connected", confirmedLocal: true });
    expect((await getSettings(w.org.id)).gatewayConfirmedLocal).toBe(true);
    // a new address starts unconfirmed again (the confirmation belongs to ONE address)
    expect((await connect({ baseUrl: "http://other-agent:8642", model: "hermes-agent" })).json).toMatchObject({ confirmedLocal: false });
  });

  it("the status is kept 30 seconds (one question to the network), and «fresh» asks again", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const log: LocalHttpRequest[] = [];
    setLocalTransportForTests(fakeAgent({ log }));
    await connect({ baseUrl: ADDRESS, model: "hermes-agent" });
    log.length = 0;
    await zakiAiStatus(w.org.id, { now: NOW });
    await zakiAiStatus(w.org.id, { now: new Date(NOW.getTime() + 5_000) });
    expect(log.length).toBeLessThanOrEqual(1);
    const after = log.length;
    await zakiAiStatus(w.org.id, { now: new Date(NOW.getTime() + 10_000), fresh: true });
    expect(log.length).toBe(after + 1);
    await zakiAiStatus(w.org.id, { now: new Date(NOW.getTime() + 60_000) });
    expect(log.length).toBe(after + 2);
  });

  it("with «مساعد المالك» off the agent can be connected but the status says nothing asks it", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await setFeature(w.org.id, "ownerAssistant", false);
    setLocalTransportForTests(fakeAgent());
    expect((await connect({ baseUrl: ADDRESS, model: "hermes-agent" })).json).toMatchObject({ state: "connected", assistantOn: false });
  });

  it("the panel's section draws the state, the steps to take and the form; the chip is on «اليوم»", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const page = await html(await OwnerPage({ searchParams: { v: "ai" } }));
    expect(page).toContain('data-testid="zaki-ai-panel"');
    expect(page).toContain('data-testid="zaki-ai-chip"');
  });
});
