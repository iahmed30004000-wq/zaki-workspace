import "./scoping-react";
import { describe, expect, it, vi } from "vitest";

// the pages call notFound(); no running Next app is needed here
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

import { renderToStaticMarkup } from "react-dom/server";
import type { Prisma } from "@prisma/client";
import * as overviewRoute from "@/app/api/owner-board/route";
import * as personRoute from "@/app/api/owner-board/people/[id]/route";
import * as csvRoute from "@/app/api/owner-board/csv/route";
import OwnerBoardPage from "@/app/(app)/owner/page";
import OwnerBoardPersonPage from "@/app/(app)/owner/people/[id]/page";
import { withFeature } from "@/lib/features";
import { requireActor } from "@/server/policy/actor";
import { boardAccess } from "@/server/policy/board";
import { loadOverview, loadPerson, type Overview, type PersonView } from "@/server/services/owner-board";
import type { BoardSection } from "@/server/services/owner-board-sections";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * «لوحة المالك» — the owner's control panel (2026-10-30), and its two limited switches «لوحتي» (`board.self`) and
 * «لوحة الفريق» (`board.team`).
 *
 * What this pins, against a real PostgreSQL:
 *  - who: the owner and a partner read everything; a person holding `board.team` reads the people of the spaces they manage
 *    and only the work inside them; `board.self` reads one's own page and nobody else's; a guest, a person with neither switch
 *    and the company with the feature switched off get 404 on the page and on every route (never 403);
 *  - the numbers: a day is the COMPANY's day (a completion at 00:30 Damascus is the new day though it is still the old one
 *    in UTC), a co-assignee counts once, a reopened task does not count and an archived one does, a person who is no longer
 *    ACTIVE is marked and still in the company's totals, a space filter never leaks another space's tasks;
 *  - privacy: message COUNTS only (no body anywhere in the answers), a window of at most 92 days, and reading leaves no
 *    audit row, no notification, no read mark.
 */

const NOW = new Date("2026-10-30T09:00:00Z"); // 12:00 in Damascus (UTC+3)
const at = (iso: string) => new Date(iso);

async function world() {
  const t = await makeTeam();
  const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "Lead" });
  const colleague = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Colleague" });
  const partner = await makeUser({ orgId: t.org.id, role: "OWNER", name: "Partner" });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: partner.id } }, data: { primaryOwner: false } });
  // space A: the lead manages it (its ADMIN); the member and the admin work in it. space B: the lead is not in it.
  const spaceA = await makeWorkspace(t.org.id, [{ userId: lead.id, role: "ADMIN" }, { userId: t.member.id }, { userId: t.admin.id }], "مساحة أ");
  const spaceB = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: colleague.id }], "مساحة ب");
  const a = await makeProject(spaceA.id, "مشروع أ");
  const b = await makeProject(spaceB.id, "مشروع ب");
  const task = (space: "a" | "b", title: string, opts: { assigneeId?: string | null; completedAt?: Date | null; dueDate?: Date | null; archived?: boolean; creatorId?: string } = {}) => {
    const w = space === "a" ? { ws: spaceA, p: a } : { ws: spaceB, p: b };
    return makeTask({
      orgId: t.org.id,
      workspaceId: w.ws.id,
      projectId: w.p.project.id,
      boardId: w.p.board.id,
      columnId: opts.completedAt ? w.p.done.id : w.p.todo.id,
      creatorId: opts.creatorId ?? t.owner.id,
      assigneeId: opts.assigneeId ?? null,
      title,
      dueDate: opts.dueDate ?? null,
      completedAt: opts.completedAt ?? null,
    }).then(async (row) => (opts.archived ? db.task.update({ where: { id: row.id }, data: { archived: true } }) : row));
  };
  return { ...t, lead, colleague, partner, spaceA, spaceB, a, b, task };
}
type World = Awaited<ReturnType<typeof world>>;

async function accessAs(userId: string) {
  await loginAs(userId);
  return boardAccess(await requireActor());
}
const q = (extra: Record<string, string> = {}) => ({ from: "2026-10-20", to: "2026-10-30", ...extra });

async function overviewAs(userId: string, query: Record<string, string> = {}): Promise<Overview> {
  return loadOverview(await accessAs(userId), q(query), { now: NOW });
}
async function personAs(viewer: string, userId: string, query: Record<string, string> = {}): Promise<PersonView> {
  return loadPerson(await accessAs(viewer), userId, q(query), { now: NOW });
}
const row = (o: Overview, userId: string) => o.people.find((p) => p.userId === userId);
const grant = (w: World, userId: string, data: { capabilities?: string[]; revokedCapabilities?: string[] }) =>
  db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId } }, data });
const setFeature = async (w: World, on: boolean) => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
  await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "ownerBoard", on) as Prisma.InputJsonValue } });
};
const get = (route: { GET: unknown }, init: { params?: Record<string, string>; query?: string } = {}) =>
  call(route.GET, { url: `http://localhost/api/owner-board${init.query ?? ""}`, params: init.params ?? {} });

/** The first three bytes of the CSV answer (a decoder drops a BOM, so the bytes are read raw). */
async function csvBytes(): Promise<number[]> {
  const res = await (csvRoute.GET as (req: Request) => Promise<Response>)(new Request("http://localhost/api/owner-board/csv"));
  return [...new Uint8Array(await res.arrayBuffer()).slice(0, 3)];
}

describe("who may open the board", () => {
  it("the owner and a partner read the overview, a person's page and the CSV", async () => {
    const w = await world();
    await w.task("a", "إنجاز", { assigneeId: w.member.id, completedAt: at("2026-10-29T09:00:00Z") });
    for (const viewer of [w.owner, w.partner]) {
      await loginAs(viewer.id);
      const overview = await get(overviewRoute);
      expect(overview.status, viewer.email).toBe(200);
      expect((overview.json?.["overview"] as Overview).mode).toBe("owner");
      expect((await get(personRoute, { params: { id: w.member.id } })).status).toBe(200);
      const csv = await get(csvRoute);
      expect(csv.status).toBe(200);
      expect(await csvBytes()).toEqual([0xef, 0xbb, 0xbf]);
    }
  });

  it("a guest and a person with neither switch get 404 on every route and on both pages; no 403 anywhere", async () => {
    const w = await world();
    await grant(w, w.colleague.id, { revokedCapabilities: ["board.self"] });
    for (const who of [w.guest, w.colleague]) {
      await loginAs(who.id);
      for (const res of [await get(overviewRoute), await get(personRoute, { params: { id: w.member.id } }), await get(personRoute, { params: { id: who.id } }), await get(csvRoute)]) {
        expect(res.status, who.email).toBe(404);
      }
      await expect(OwnerBoardPage({ searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(OwnerBoardPersonPage({ params: { id: who.id }, searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("an admin, a lead and a member hold «لوحتي»: their own page only; the overview, the CSV and anybody else's page are 404", async () => {
    const w = await world();
    for (const who of [w.admin, w.lead, w.member]) {
      await loginAs(who.id);
      const own = await get(personRoute, { params: { id: who.id } });
      expect(own.status, `${who.email} own page`).toBe(200);
      expect((own.json?.["view"] as PersonView).own).toBe(true);
      expect((await get(overviewRoute)).status, `${who.email} overview`).toBe(404);
      expect((await get(csvRoute)).status, `${who.email} csv`).toBe(404);
      for (const other of [w.owner, w.partner, w.colleague, w.guest, w.admin, w.lead, w.member].filter((p) => p.id !== who.id)) {
        expect((await get(personRoute, { params: { id: other.id } })).status, `${who.email} -> ${other.email}`).toBe(404);
      }
      // the page: the person's own view renders (no redirect), nobody else's does
      await expect(OwnerBoardPage({ searchParams: {} })).resolves.toBeTruthy();
      await expect(OwnerBoardPersonPage({ params: { id: w.owner.id }, searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("the owner and a partner render both pages", async () => {
    const w = await world();
    for (const viewer of [w.owner, w.partner]) {
      await loginAs(viewer.id);
      await expect(OwnerBoardPage({ searchParams: {} })).resolves.toBeTruthy();
      await expect(OwnerBoardPersonPage({ params: { id: w.member.id }, searchParams: {} })).resolves.toBeTruthy();
    }
  });

  it("a person who is not in the company, or a guest, does not exist for the owner either: 404", async () => {
    const w = await world();
    const stranger = await makeTeam();
    await loginAs(w.owner.id);
    expect((await get(personRoute, { params: { id: stranger.member.id } })).status).toBe(404);
    expect((await get(personRoute, { params: { id: w.guest.id } })).status).toBe(404);
    expect((await get(overviewRoute, { query: `?person=${stranger.member.id}` })).status).toBe(404);
    expect((await get(overviewRoute, { query: `?space=${stranger.org.id}` })).status).toBe(404);
  });

  it("the feature switched off closes every door for everybody, the owner included; switched on again it all comes back", async () => {
    const w = await world();
    await setFeature(w, false);
    for (const who of [w.owner, w.partner, w.member]) {
      await loginAs(who.id);
      expect((await get(overviewRoute)).status).toBe(404);
      expect((await get(personRoute, { params: { id: who.id } })).status).toBe(404);
      expect((await get(csvRoute)).status).toBe(404);
      await expect(OwnerBoardPage({ searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    }
    await setFeature(w, true);
    await loginAs(w.owner.id);
    expect((await get(overviewRoute)).status).toBe(200);
  });
});

describe("«لوحة الفريق» (board.team) and «لوحتي» (board.self): granted, not granted, revoked", () => {
  it("a lead is not granted «لوحة الفريق» by rank: 404 until the owner switches it on; revoking takes it away again", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    expect((await get(overviewRoute)).status).toBe(404);
    await grant(w, w.lead.id, { capabilities: ["board.team"] });
    expect((await get(overviewRoute)).status).toBe(200);
    await grant(w, w.lead.id, { capabilities: [], revokedCapabilities: ["board.team"] });
    expect((await get(overviewRoute)).status).toBe(404);
  });

  it("a team lead reads the people of the spaces they manage, and nobody else: not the owner, not a partner, not a guest, not themselves in the table", async () => {
    const w = await world();
    await grant(w, w.lead.id, { capabilities: ["board.team"] });
    const o = await overviewAs(w.lead.id);
    expect(o.mode).toBe("team");
    const ids = o.people.map((p) => p.userId).sort();
    // space A has the lead (the viewer), the member and the admin; the colleague is only in space B
    expect(ids).toEqual([w.member.id, w.admin.id].sort());
    expect(ids).not.toContain(w.owner.id);
    expect(ids).not.toContain(w.partner.id);
    expect(ids).not.toContain(w.guest.id);
    expect(ids).not.toContain(w.lead.id);
    // no company-wide totals
    expect(o.cards).toBeNull();
    // the space filter offers only the spaces they manage
    expect(o.spaces.map((s) => s.id)).toEqual([w.spaceA.id]);
  });

  it("outside their reach is 404: the owner's page, a partner's, the colleague who is only in another space, and another space's filter", async () => {
    const w = await world();
    await grant(w, w.lead.id, { capabilities: ["board.team"] });
    await loginAs(w.lead.id);
    for (const other of [w.owner, w.partner, w.colleague, w.guest]) {
      expect((await get(personRoute, { params: { id: other.id } })).status, other.email).toBe(404);
      expect((await get(overviewRoute, { query: `?person=${other.id}` })).status, `person filter ${other.email}`).toBe(404);
    }
    expect((await get(overviewRoute, { query: `?space=${w.spaceB.id}` })).status).toBe(404);
    expect((await get(personRoute, { params: { id: w.member.id }, query: `?space=${w.spaceB.id}` })).status).toBe(404);
    expect((await get(personRoute, { params: { id: w.member.id } })).status).toBe(200);
  });

  it("a team lead sees only the work done INSIDE their spaces: the same person's tasks and messages in another space never leak", async () => {
    const w = await world();
    await grant(w, w.lead.id, { capabilities: ["board.team"] });
    await w.task("a", "مهمة في أ", { assigneeId: w.member.id, completedAt: at("2026-10-28T08:00:00Z") });
    await w.task("b", "مهمة سرية في ب", { assigneeId: w.member.id, completedAt: at("2026-10-28T09:00:00Z") });
    await w.task("b", "مفتوحة سرية في ب", { assigneeId: w.member.id });
    const topicA = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "أ", spaceId: w.spaceA.id } });
    const topicB = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "ب", spaceId: w.spaceB.id } });
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: topicA.id, authorId: w.member.id, body: "x", createdAt: at("2026-10-28T08:00:00Z") } });
    await db.chatMessage.createMany({ data: [1, 2, 3].map(() => ({ orgId: w.org.id, conversationId: topicB.id, authorId: w.member.id, body: "y", createdAt: at("2026-10-28T08:00:00Z") })) });

    const o = await overviewAs(w.lead.id);
    const mine = row(o, w.member.id)!;
    expect([mine.completed, mine.openTasks, mine.messages]).toEqual([1, 0, 1]);

    const view = await personAs(w.lead.id, w.member.id);
    const titles = view.days.flatMap((d) => d.tasks.map((t) => t.title));
    expect(titles).toEqual(["مهمة في أ"]);
    expect(view.open).toEqual([]);
    expect(view.spaces.map((s) => s.name)).toEqual(["مساحة أ"]); // the member is in B too: not shown

    // and the owner sees all of it
    const all = await personAs(w.owner.id, w.member.id);
    expect(all.days.flatMap((d) => d.tasks.map((t) => t.title)).sort()).toEqual(["مهمة سرية في ب", "مهمة في أ"]);
    expect(all.person.messages).toBe(4);
    expect(all.spaces).toHaveLength(2);
  });

  it("the responses to a team lead carry nothing of the other space (JSON and CSV text)", async () => {
    const w = await world();
    await grant(w, w.lead.id, { capabilities: ["board.team"] });
    await w.task("b", "عنوان-سري-في-ب", { assigneeId: w.member.id, completedAt: at("2026-10-28T09:00:00Z") });
    await w.task("b", "مفتوحة-سرية-في-ب", { assigneeId: w.member.id });
    await loginAs(w.lead.id);
    const texts = [(await get(overviewRoute, { query: "?range=30" })).text, (await get(personRoute, { params: { id: w.member.id }, query: "?range=30" })).text, (await get(csvRoute, { query: "?range=30" })).text];
    for (const text of texts) {
      expect(text).not.toContain("سري-في-ب");
      expect(text).not.toContain("مساحة ب");
      expect(text).not.toContain(w.colleague.name);
      expect(text).not.toContain(w.owner.name);
    }
  });

  it("a team lead whose team is inside a space they do not manage reads that team only", async () => {
    const w = await world();
    const teamRow = await db.team.create({ data: { workspaceId: w.spaceB.id, name: "فريق", leadId: w.colleague.id } });
    await db.teamMember.createMany({ data: [{ teamId: teamRow.id, userId: w.colleague.id }, { teamId: teamRow.id, userId: w.member.id }] });
    await db.project.update({ where: { id: w.b.project.id }, data: { teamId: teamRow.id } });
    const other = await makeProject(w.spaceB.id, "مشروع بلا فريق");
    await makeTask({ orgId: w.org.id, workspaceId: w.spaceB.id, projectId: other.project.id, boardId: other.board.id, columnId: other.done.id, creatorId: w.owner.id, assigneeId: w.member.id, title: "خارج الفريق", completedAt: at("2026-10-28T09:00:00Z") });
    await w.task("b", "داخل الفريق", { assigneeId: w.member.id, completedAt: at("2026-10-28T09:00:00Z") });
    await grant(w, w.colleague.id, { capabilities: ["board.team"] });
    const view = await personAs(w.colleague.id, w.member.id);
    expect(view.days.flatMap((d) => d.tasks.map((t) => t.title))).toEqual(["داخل الفريق"]);
    const o = await overviewAs(w.colleague.id);
    expect(o.people.map((p) => p.userId)).toEqual([w.member.id]);
  });

  it("a lead who holds both switches reads their own page too; with «لوحتي» revoked, not even that", async () => {
    const w = await world();
    await grant(w, w.lead.id, { capabilities: ["board.team"] });
    await loginAs(w.lead.id);
    expect((await get(personRoute, { params: { id: w.lead.id } })).status).toBe(200);
    await grant(w, w.lead.id, { capabilities: ["board.team"], revokedCapabilities: ["board.self"] });
    expect((await get(personRoute, { params: { id: w.lead.id } })).status).toBe(404);
    expect((await get(overviewRoute)).status).toBe(200);
  });

  it("«لوحتي» revoked for a member: 404 on their own page; the owner is not affected by anything stored on his row", async () => {
    const w = await world();
    await grant(w, w.member.id, { revokedCapabilities: ["board.self"] });
    await loginAs(w.member.id);
    expect((await get(personRoute, { params: { id: w.member.id } })).status).toBe(404);
    await grant(w, w.owner.id, { revokedCapabilities: ["board.self", "board.team"] });
    await grant(w, w.partner.id, { revokedCapabilities: ["board.self", "board.team"] });
    for (const who of [w.owner, w.partner]) {
      await loginAs(who.id);
      expect((await get(overviewRoute)).status, who.email).toBe(200);
    }
  });

  it("a guest never: even with both switches stored on their row", async () => {
    const w = await world();
    await grant(w, w.guest.id, { capabilities: ["board.self", "board.team"] });
    await loginAs(w.guest.id);
    expect((await get(overviewRoute)).status).toBe(404);
    expect((await get(personRoute, { params: { id: w.guest.id } })).status).toBe(404);
  });
});

describe("the numbers: the company's day, who is credited, and what is left out", () => {
  it("a day is the company's day: 00:30 in Damascus is the NEW day although it is still the old one in UTC", async () => {
    const w = await world();
    await w.task("a", "23:59:59 أمس", { assigneeId: w.member.id, completedAt: at("2026-10-28T20:59:59Z") }); // 23:59:59 Oct 28 Damascus
    await w.task("a", "00:00:00 اليوم", { assigneeId: w.member.id, completedAt: at("2026-10-28T21:00:00Z") }); // 00:00:00 Oct 29 Damascus
    await w.task("a", "00:30 اليوم", { assigneeId: w.member.id, completedAt: at("2026-10-28T21:30:00Z") }); // 00:30 Oct 29 Damascus
    await w.task("a", "23:30 الليلة", { assigneeId: w.member.id, completedAt: at("2026-10-29T20:30:00Z") }); // 23:30 Oct 29 Damascus
    const v = await personAs(w.owner.id, w.member.id);
    const by = Object.fromEntries(v.days.map((d) => [d.day, d.tasks.map((t) => t.title).sort()]));
    expect(by["2026-10-28"]).toEqual(["23:59:59 أمس"]);
    expect(by["2026-10-29"]).toEqual(["00:00:00 اليوم", "00:30 اليوم", "23:30 الليلة"].sort());
    expect(by["2026-10-30"]).toEqual([]); // a day with nothing is a row of zeros, never missing
    // the sparkline is one bar per day of the window, and the 21:30Z task is on Oct 29 in it too
    expect(v.person.spark).toHaveLength(11);
    expect(v.person.spark[v.window.days.indexOf("2026-10-29")]).toBe(3);
    expect(v.person.spark[v.window.days.indexOf("2026-10-28")]).toBe(1);
    // first and last of the day are the company's wall clock instants
    const d29 = v.days.find((d) => d.day === "2026-10-29")!;
    expect(d29.first).toBe("2026-10-28T21:00:00.000Z");
    expect(d29.last).toBe("2026-10-29T20:30:00.000Z");
  });

  it("the window starts and ends at the company's midnight, not UTC's", async () => {
    const w = await world();
    await w.task("a", "قبل", { assigneeId: w.member.id, completedAt: at("2026-10-27T20:59:59Z") }); // Oct 27 23:59:59 Damascus: outside from=28
    await w.task("a", "داخل", { assigneeId: w.member.id, completedAt: at("2026-10-27T21:00:00Z") }); // Oct 28 00:00:00: inside
    const v = await personAs(w.owner.id, w.member.id, { from: "2026-10-28", to: "2026-10-29" });
    expect(v.days.flatMap((d) => d.tasks.map((t) => t.title))).toEqual(["داخل"]);
    expect(v.window.days).toEqual(["2026-10-28", "2026-10-29"]);
  });

  it("an organization's own zone counts: the same instant is another day for a company in another zone", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { timezone: "America/Los_Angeles" } });
    await w.task("a", "مهمة", { assigneeId: w.member.id, completedAt: at("2026-10-29T03:00:00Z") }); // Oct 28 20:00 in Los Angeles
    const v = await personAs(w.owner.id, w.member.id);
    expect(v.days.find((d) => d.tasks.length)?.day).toBe("2026-10-28");
    expect(v.window.timeZone).toBe("America/Los_Angeles");
  });

  it("a co-assignee is credited once, however many ways they hold the task; an assignee who is also co-assignee once", async () => {
    const w = await world();
    const task = await w.task("a", "مشتركة", { assigneeId: w.member.id, completedAt: at("2026-10-29T08:00:00Z") });
    await db.taskCoAssignee.createMany({ data: [{ taskId: task.id, userId: w.member.id }, { taskId: task.id, userId: w.admin.id }] });
    const o = await overviewAs(w.owner.id);
    expect(row(o, w.member.id)!.completed).toBe(1);
    expect(row(o, w.admin.id)!.completed).toBe(1);
    expect(o.cards!.completed).toBe(1); // the company's card counts the TASK once
  });

  it("a reopened task does not count; an archived completed task does", async () => {
    const w = await world();
    await w.task("a", "اتفتحت من جديد", { assigneeId: w.member.id, completedAt: null });
    await w.task("a", "مؤرشفة منجزة", { assigneeId: w.member.id, completedAt: at("2026-10-29T08:00:00Z"), archived: true });
    await w.task("a", "مؤرشفة غير منجزة", { assigneeId: w.member.id, archived: true });
    const o = await overviewAs(w.owner.id);
    const p = row(o, w.member.id)!;
    expect(p.completed).toBe(1);
    expect(p.openTasks).toBe(1); // only the reopened one: an archived task is not open
    expect(o.cards).toMatchObject({ completed: 1, open: 1 });
  });

  it("a task nobody holds is credited to whoever the activity log says finished it; with no record it counts only in the totals", async () => {
    const w = await world();
    const recorded = await w.task("a", "بلا مسؤول، مسجّل", { completedAt: at("2026-10-29T08:00:00Z") });
    await db.taskActivity.create({ data: { taskId: recorded.id, actorId: w.admin.id, event: "task.completed" } });
    await w.task("a", "بلا مسؤول، غير مسجّل", { completedAt: at("2026-10-29T08:30:00Z") });
    const o = await overviewAs(w.owner.id);
    expect(row(o, w.admin.id)!.completed).toBe(1);
    expect(o.people.reduce((n, p) => n + p.completed, 0)).toBe(1);
    expect(o.cards!.completed).toBe(2);
  });

  it("a person who is no longer ACTIVE is marked and keeps their completed work in the company's totals; a guest is never a row", async () => {
    const w = await world();
    await w.task("a", "من الموقوف", { assigneeId: w.colleague.id, completedAt: at("2026-10-29T08:00:00Z") });
    await w.task("a", "من الزائر", { assigneeId: w.guest.id, completedAt: at("2026-10-29T08:00:00Z") });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.colleague.id } }, data: { status: "SUSPENDED" } });
    const o = await overviewAs(w.owner.id);
    expect(row(o, w.colleague.id)).toMatchObject({ status: "SUSPENDED", completed: 1 });
    expect(row(o, w.guest.id)).toBeUndefined();
    expect(row(o, w.member.id)!.status).toBe("ACTIVE");
    expect(o.cards!.completed).toBe(2);
    // a suspended person with nothing in the window is not on the table at all
    const idle = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Idle" });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: idle.id } }, data: { status: "OFFBOARDED" } });
    expect(row(await overviewAs(w.owner.id), idle.id)).toBeUndefined();
  });

  it("a space filter limits everything and never leaks another space's tasks, steps or messages", async () => {
    const w = await world();
    await w.task("a", "في أ", { assigneeId: w.member.id, completedAt: at("2026-10-29T08:00:00Z") });
    await w.task("b", "في ب", { assigneeId: w.member.id, completedAt: at("2026-10-29T08:00:00Z") });
    await w.task("b", "مفتوحة في ب", { assigneeId: w.member.id });
    const stepTask = await w.task("b", "خطوات في ب", { assigneeId: w.member.id });
    await db.taskStep.create({ data: { orgId: w.org.id, taskId: stepTask.id, title: "s", done: true, doneById: w.member.id, doneAt: at("2026-10-29T08:00:00Z"), position: 1 } });
    const topicB = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "ب", spaceId: w.spaceB.id } });
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: topicB.id, authorId: w.member.id, body: "b", createdAt: at("2026-10-29T08:00:00Z") } });

    const inA = await overviewAs(w.owner.id, { space: w.spaceA.id });
    expect(row(inA, w.member.id)).toMatchObject({ completed: 1, openTasks: 0, steps: 0, messages: 0 });
    expect(inA.cards).toMatchObject({ completed: 1, open: 0, messages: 0 });
    const inB = await overviewAs(w.owner.id, { space: w.spaceB.id });
    expect(row(inB, w.member.id)).toMatchObject({ completed: 1, openTasks: 2, steps: 1, messages: 1 });
    expect(inB.people.map((p) => p.userId)).not.toContain(w.lead.id); // not a member of B
    const view = await personAs(w.owner.id, w.member.id, { space: w.spaceA.id });
    expect(view.days.flatMap((d) => d.tasks.map((t) => t.title))).toEqual(["في أ"]);
    expect(view.open).toEqual([]);
  });

  it("steps ticked are counted by who ticked them and when (the company's day); unticked ones are not", async () => {
    const w = await world();
    const task = await w.task("a", "مهمة", { assigneeId: w.member.id });
    const step = (done: boolean, doneAt: Date | null, doneById: string | null) => db.taskStep.create({ data: { orgId: w.org.id, taskId: task.id, title: "خطوة", done, doneAt, doneById, position: 1 } });
    await step(true, at("2026-10-28T21:30:00Z"), w.member.id); // 00:30 Oct 29
    await step(true, at("2026-10-29T08:00:00Z"), w.member.id);
    await step(true, at("2026-10-29T08:00:00Z"), w.admin.id);
    await step(false, null, null);
    const v = await personAs(w.owner.id, w.member.id);
    expect(v.person.steps).toBe(2);
    expect(v.days.find((d) => d.day === "2026-10-29")!.steps).toBe(2);
    expect(v.days.find((d) => d.day === "2026-10-28")!.steps).toBe(0);
  });

  it("the on-time rate is finished on or before the due day ÷ finished with a due day; nothing to divide is null, not 0%", async () => {
    const w = await world();
    const due = at("2026-10-28T21:00:00Z"); // the start of Oct 29 in Damascus
    await w.task("a", "في موعدها", { assigneeId: w.member.id, completedAt: at("2026-10-29T20:00:00Z"), dueDate: due }); // 23:00 Oct 29: same day
    await w.task("a", "متأخرة", { assigneeId: w.member.id, completedAt: at("2026-10-29T21:30:00Z"), dueDate: due }); // 00:30 Oct 30: a day late
    await w.task("a", "بلا موعد", { assigneeId: w.member.id, completedAt: at("2026-10-29T08:00:00Z") });
    await w.task("a", "وحيدة بلا موعد", { assigneeId: w.admin.id, completedAt: at("2026-10-29T08:00:00Z") });
    const o = await overviewAs(w.owner.id);
    expect(row(o, w.member.id)).toMatchObject({ completed: 3, withDue: 2, onTime: 1, late: 1, onTimeRate: 50 });
    expect(row(o, w.admin.id)).toMatchObject({ completed: 1, withDue: 0, onTimeRate: null });
    expect(o.cards).toMatchObject({ completed: 4, late: 1 });
  });

  it("open and overdue are measured against the company's today", async () => {
    const w = await world();
    await w.task("a", "متأخرة", { assigneeId: w.member.id, dueDate: at("2026-10-29T10:00:00Z") });
    await w.task("a", "اليوم", { assigneeId: w.member.id, dueDate: at("2026-10-29T21:30:00Z") }); // Oct 30 00:30: due today, not overdue
    await w.task("a", "بلا موعد", { assigneeId: w.member.id });
    const o = await overviewAs(w.owner.id);
    expect(row(o, w.member.id)).toMatchObject({ openTasks: 3, overdue: 1 });
    expect(o.cards).toMatchObject({ open: 3, overdue: 1 });
    const v = await personAs(w.owner.id, w.member.id);
    expect(v.open.map((t) => [t.title, t.overdue])).toEqual([["متأخرة", true], ["اليوم", false], ["بلا موعد", false]]);
  });

  it("the cards: average days to finish, active and idle people, and the «اليوم» strip", async () => {
    const w = await world();
    const done = await w.task("a", "مهمة", { assigneeId: w.member.id, completedAt: at("2026-10-30T07:00:00Z") });
    await db.task.update({ where: { id: done.id }, data: { createdAt: at("2026-10-28T07:00:00Z") } });
    const o = await overviewAs(w.owner.id);
    expect(o.cards!.avgDays).toBeCloseTo(2, 5);
    expect(o.cards!.activePeople).toBe(1);
    expect(o.cards!.idlePeople).toBe(o.people.filter((p) => p.status === "ACTIVE").length - 1);
    expect(o.today!.done.map((r) => r.userId)).toEqual([w.member.id]);
    expect(o.today!.done[0]).toMatchObject({ tasks: 1, steps: 0, messages: 0 });
    expect(o.today!.idle.map((p) => p.userId)).not.toContain(w.member.id);
    expect(o.today!.idle.map((p) => p.userId)).toContain(w.admin.id);
    // a completion yesterday is not in «اليوم»
    await db.task.update({ where: { id: done.id }, data: { completedAt: at("2026-10-29T07:00:00Z") } });
    expect((await overviewAs(w.owner.id)).today!.done).toEqual([]);
  });

  it("the person filter narrows the table, the cards and the strip to one person", async () => {
    const w = await world();
    await w.task("a", "ع", { assigneeId: w.member.id, completedAt: at("2026-10-29T08:00:00Z") });
    await w.task("a", "ع٢", { assigneeId: w.admin.id, completedAt: at("2026-10-29T08:00:00Z") });
    const o = await overviewAs(w.owner.id, { person: w.member.id });
    expect(o.people.map((p) => p.userId)).toEqual([w.member.id]);
    expect(o.cards).toMatchObject({ completed: 1, activePeople: 1, idlePeople: 0 });
  });

  it("sorts by any column, both ways, ties by name", async () => {
    const w = await world();
    await w.task("a", "١", { assigneeId: w.member.id, completedAt: at("2026-10-29T08:00:00Z") });
    await w.task("a", "٢", { assigneeId: w.member.id, completedAt: at("2026-10-29T08:00:00Z") });
    await w.task("a", "٣", { assigneeId: w.admin.id, completedAt: at("2026-10-29T08:00:00Z") });
    const desc = await overviewAs(w.owner.id, { sort: "completed", dir: "desc" });
    expect(desc.people.slice(0, 2).map((p) => p.userId)).toEqual([w.member.id, w.admin.id]);
    const asc = await overviewAs(w.owner.id, { sort: "completed", dir: "asc" });
    expect(asc.people.at(-1)!.userId).toBe(w.member.id);
    const byName = await overviewAs(w.owner.id, { sort: "name" });
    expect(byName.filters).toMatchObject({ sort: "name", dir: "asc" });
    expect(byName.people.map((p) => p.name)).toEqual([...byName.people.map((p) => p.name)].sort((x, y) => x.localeCompare(y, "ar")));
    expect((await overviewAs(w.owner.id, { sort: "nonsense" })).filters.sort).toBe("completed");
  });

  it("the window is at most 92 days: 92 passes, 93 is refused with a 422, a wrong day is refused, presets work", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await get(overviewRoute, { query: "?from=2026-07-31&to=2026-10-30" })).status).toBe(200); // 92 days
    const tooLong = await get(overviewRoute, { query: "?from=2026-07-30&to=2026-10-30" }); // 93 days
    expect(tooLong.status).toBe(422);
    expect(tooLong.text).toContain("ownerboard.range_too_long");
    expect((await get(overviewRoute, { query: "?from=2026-10-30&to=2026-10-01" })).status).toBe(422);
    expect((await get(overviewRoute, { query: "?from=2026-02-30&to=2026-03-01" })).status).toBe(422);
    const days = async (range: string) => ((await get(overviewRoute, { query: `?range=${range}` })).json?.["overview"] as Overview).window.days.length;
    expect([await days("today"), await days("7"), await days("14"), await days("30")]).toEqual([1, 7, 14, 30]);
    expect(((await get(overviewRoute)).json?.["overview"] as Overview).window.days).toHaveLength(14); // the default
  });
});

describe("privacy: counts only, no bodies, no trace", () => {
  it("message COUNTS equal the rows (deleted and system lines left out) and no body appears anywhere in the answers", async () => {
    const w = await world();
    const SECRET = `رسالة-سرية-${uid()}`;
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "موضوع", spaceId: w.spaceA.id } });
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM", dmKey: `${w.member.id}:${w.admin.id}` } });
    const base = { orgId: w.org.id, authorId: w.member.id };
    await db.chatMessage.createMany({
      data: [
        { ...base, conversationId: topic.id, body: SECRET, createdAt: at("2026-10-28T21:30:00Z") }, // 00:30 Oct 29
        { ...base, conversationId: topic.id, body: `${SECRET} 2`, createdAt: at("2026-10-29T08:00:00Z") },
        { ...base, conversationId: dm.id, body: `${SECRET} dm`, createdAt: at("2026-10-29T09:00:00Z") },
        { ...base, conversationId: topic.id, body: `${SECRET} محذوفة`, deletedAt: at("2026-10-29T10:00:00Z"), createdAt: at("2026-10-29T09:30:00Z") },
        { ...base, conversationId: topic.id, body: `${SECRET} نظام`, kind: "SYSTEM", createdAt: at("2026-10-29T09:40:00Z") },
        { ...base, conversationId: topic.id, body: `${SECRET} قديمة`, createdAt: at("2026-09-01T09:40:00Z") },
      ],
    });
    const expected = await db.chatMessage.count({
      where: { orgId: w.org.id, authorId: w.member.id, deletedAt: null, kind: { not: "SYSTEM" }, createdAt: { gte: at("2026-10-19T21:00:00Z"), lt: at("2026-10-30T21:00:00Z") } },
    });
    expect(expected).toBe(3);
    const o = await overviewAs(w.owner.id);
    expect(row(o, w.member.id)!.messages).toBe(expected);
    expect(o.cards!.messages).toBe(expected);
    const v = await personAs(w.owner.id, w.member.id);
    expect(v.days.find((d) => d.day === "2026-10-29")!.messages).toBe(3);

    await loginAs(w.owner.id);
    const texts = [
      (await get(overviewRoute, { query: "?range=30" })).text,
      (await get(personRoute, { params: { id: w.member.id }, query: "?range=30" })).text,
      (await get(csvRoute, { query: "?range=30" })).text,
      JSON.stringify(o),
      JSON.stringify(v),
    ];
    for (const text of texts) expect(text).not.toContain("رسالة-سرية");
    // the pages' rendered trees carry no body either
    const page = renderToStaticMarkup(await OwnerBoardPersonPage({ params: { id: w.member.id }, searchParams: {} }));
    expect(page).toContain(w.member.name);
    expect(page).not.toContain("رسالة-سرية");
  });

  it("reading leaves no trace: no audit row, no notification, no task activity, no read mark, nothing written at all", async () => {
    const w = await world();
    await w.task("a", "مهمة", { assigneeId: w.member.id, completedAt: at("2026-10-29T08:00:00Z") });
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "ت", spaceId: w.spaceA.id } });
    await db.conversationMember.create({ data: { conversationId: topic.id, userId: w.member.id, lastReadAt: at("2026-10-01T00:00:00Z") } });
    const snapshot = async () => ({
      audit: await db.auditLog.count(),
      notifications: await db.notification.count(),
      activity: await db.taskActivity.count(),
      reads: JSON.stringify(await db.conversationMember.findMany({ orderBy: { id: "asc" }, select: { id: true, lastReadAt: true } })),
      tasks: JSON.stringify(await db.task.findMany({ where: { orgId: w.org.id }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true } })),
      users: JSON.stringify(await db.user.findMany({ where: { memberships: { some: { organizationId: w.org.id } } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true } })),
    });
    const before = await snapshot();
    for (const viewer of [w.owner, w.partner, w.member]) {
      await loginAs(viewer.id);
      await get(overviewRoute);
      await get(personRoute, { params: { id: viewer.id } });
      await get(personRoute, { params: { id: w.member.id } });
      await get(csvRoute);
      await OwnerBoardPage({ searchParams: {} });
      await OwnerBoardPersonPage({ params: { id: viewer.id }, searchParams: {} });
    }
    await grant(w, w.lead.id, { capabilities: ["board.team"] });
    await loginAs(w.lead.id);
    await get(overviewRoute);
    expect(await snapshot()).toEqual(before);
  });
});

describe("the CSV", () => {
  it("is UTF-8 with a BOM, carries exactly the columns of the table, and makes a cell starting with = + - @ safe", async () => {
    const w = await world();
    const evil = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "=HYPERLINK(\"http://x\")" });
    const plus = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "+1 يوسف" });
    await w.task("a", "ع", { assigneeId: evil.id, completedAt: at("2026-10-29T08:00:00Z") });
    await loginAs(w.owner.id);
    const res = await get(csvRoute, { query: "?range=30" });
    expect(res.headers.get("content-type")).toContain("text/csv; charset=utf-8");
    expect(await csvBytes()).toEqual([0xef, 0xbb, 0xbf]);
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]!.split(",")).toHaveLength(11); // name, rank, status, 6 numbers, last activity, then the registered section «الوقت المسجّل»
    expect(res.text).toContain("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(res.text).toContain("'+1 يوسف");
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(lines.length - 1).toBe((await overviewAs(w.owner.id, { from: "2026-10-01", to: "2026-10-30" })).people.length);
    void plus;
  });
});

describe("the extension point: sections add columns without touching the board", () => {
  const fake: BoardSection = {
    id: "fake",
    columns: [{ key: "fake.minutes", labelKey: "ownerboard.col.steps", formulaKey: "ownerboard.col.steps.formula", kind: "minutes" }],
    load: async (ctx) => new Map(ctx.userIds.map((id) => [id, { "fake.minutes": 90 }])),
  };

  it("the registry holds only «الوقت المسجّل»; a registered section adds its columns and values; a failing one is skipped; an empty list changes nothing", async () => {
    const w = await world();
    const access = await accessAs(w.owner.id);
    expect((await loadOverview(access, q(), { now: NOW })).sections.map((c) => c.key)).toEqual(["time.minutes"]);
    expect((await loadOverview(access, q(), { now: NOW, sections: [] })).sections).toEqual([]);
    const broken: BoardSection = { id: "broken", columns: [{ key: "broken.x", labelKey: "a", formulaKey: "b", kind: "count" }], load: async () => Promise.reject(new Error("no table")) };
    const o = await loadOverview(access, q(), { now: NOW, sections: [fake, broken] });
    expect(o.sections.map((c) => c.key)).toEqual(["fake.minutes"]);
    expect(o.sectionValues[w.member.id]).toEqual({ "fake.minutes": 90 });
    const v = await loadPerson(access, w.member.id, q(), { now: NOW, sections: [fake] });
    expect(v.sectionValues).toEqual({ "fake.minutes": 90 });
    // a team lead's section is asked only for the people in reach
    await grant(w, w.lead.id, { capabilities: ["board.team"] });
    const seen: string[][] = [];
    const spy: BoardSection = { ...fake, load: async (ctx) => (seen.push([...ctx.userIds]), new Map()) };
    await loadOverview(await accessAs(w.lead.id), q(), { now: NOW, sections: [spy] });
    expect(seen[0]!.sort()).toEqual([w.member.id, w.admin.id].sort());
  });
});
