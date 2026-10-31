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

import type { Prisma } from "@prisma/client";
import TaskPage from "@/app/(app)/tasks/[id]/page";
import CardPageRoute from "@/app/(app)/cards/[id]/page";
import * as scoreRoute from "@/app/api/team-development/people/[id]/score/route";
import * as boardCsvRoute from "@/app/api/owner-board/csv/route";
import * as fieldsRoute from "@/app/api/projects/[id]/fields/route";
import * as fieldsCsvRoute from "@/app/api/projects/[id]/fields/csv/route";
import * as taskFieldRoute from "@/app/api/tasks/[id]/fields/[fieldId]/route";
import { withFeature } from "@/lib/features";
import { approvalsLinkedTo } from "@/server/services/approvals";
import { requireActor } from "@/server/policy/actor";
import { boardAccess } from "@/server/policy/board";
import { loadOverview, loadPerson } from "@/server/services/owner-board";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { html } from "./pages-access-helpers";
import { approvalsWorld, ask, flip, jar } from "./approvals-helpers";

/**
 * «ربط الأجزاء» — four small follow-ups that earlier features left open, against a real PostgreSQL.
 *
 *  1. «طلب موافقة» on a task and on a card: the block is drawn only while `approvals` is on and never for an external partner; the
 *     button enters the thing's own space and opens the linked form; the linked requests are shown only to who may read EACH request.
 *  2. «التسجيل اليومي» beside the score: days answered and the run of them, numbers only (never an answer's text), only to who may
 *     already open the person's file, never inside the composite, gone while `checkins` is off.
 *  3. «الوقت المسجّل» on the owner board: minutes per person, limited by the board's scope, gone while `timeTracking` is off.
 *  4. The CSV of a project's custom-field values: whoever sees the project, never a partner, formula-safe, with a BOM.
 */

const at = (iso: string) => new Date(iso);
const setSwitch = async (orgId: string, key: "checkins" | "timeTracking" | "customFields" | "approvals", on: boolean) => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
};
const actorOf = async (userId: string) => {
  await loginAs(userId);
  return requireActor();
};

// ═════════════════════════════════════ 1. «طلب موافقة» on a task and on a card ═════════════════════════════════════

async function approvalsOnThings() {
  const w = await approvalsWorld();
  const p = await makeProject(w.ws.id, "مشروع");
  const task = await makeTask({ orgId: w.orgId, workspaceId: w.ws.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: w.member.id, assigneeId: w.member.id, title: "مهمة للموافقة" });
  const card = await db.card.create({ data: { orgId: w.orgId, workspaceId: w.ws.id, createdById: w.member.id, kind: "NOTE", title: "لوحة للموافقة", position: 1000 } });
  return { ...w, task, card };
}
type AOnThings = Awaited<ReturnType<typeof approvalsOnThings>>;

const askAbout = (w: AOnThings, as: { id: string }, approverIds: string[], kind: "TASK" | "CARD", id: string, title = "طلب مرتبط") =>
  ask(w, as, approverIds, { title, link: { kind, id } });

describe("«طلب موافقة» on a task and a card: the linked requests, read by who may read each", () => {
  it("each request is shown to the requester, the people in its chain, the space's managers and the owner; nobody else of the space sees it", async () => {
    const w = await approvalsOnThings();
    const id = await askAbout(w, w.member, [w.lead.id], "TASK", w.task.id);
    for (const [label, who] of [["requester", w.member], ["named approver", w.lead], ["space ADMIN", w.admin], ["owner", w.owner]] as const) {
      const got = await approvalsLinkedTo(await actorOf(who.id), "TASK", w.task.id, w.ws.id);
      expect(got?.items.map((i) => i.id), label).toEqual([id]);
    }
    // a colleague of the same space who is not involved: no request, but the button
    const colleague = await approvalsLinkedTo(await actorOf(w.member2.id), "TASK", w.task.id, w.ws.id);
    expect(colleague).toEqual({ canAsk: true, items: [] });
    // the amount never travels with the block
    await loginAs(w.member.id);
    const money = await ask(w, w.member, [w.lead.id], { title: "بمبلغ", amount: 100, currency: "USD", link: { kind: "TASK", id: w.task.id } });
    const asRequester = await approvalsLinkedTo(await actorOf(w.member.id), "TASK", w.task.id, w.ws.id);
    expect(asRequester?.items.map((i) => i.id)).toContain(money);
    expect(asRequester?.items.every((i) => i.amount === null)).toBe(true);
  });

  it("a card is linked the same way and a request about a task is not shown on a card", async () => {
    const w = await approvalsOnThings();
    const forCard = await askAbout(w, w.member, [w.lead.id], "CARD", w.card.id);
    await askAbout(w, w.member, [w.lead.id], "TASK", w.task.id);
    const got = await approvalsLinkedTo(await actorOf(w.member.id), "CARD", w.card.id, w.ws.id);
    expect(got?.items.map((i) => i.id)).toEqual([forCard]);
  });

  it("an external partner and a company with the switch off get no block at all; a person outside the space cannot ask and reads nothing", async () => {
    const w = await approvalsOnThings();
    await askAbout(w, w.member, [w.lead.id], "TASK", w.task.id);
    expect(await approvalsLinkedTo(await actorOf(w.guest.id), "TASK", w.task.id, w.ws.id)).toBeNull();
    // somebody who works only in ANOTHER space: no request of this one, and no button for this one
    const outside = await approvalsLinkedTo(await actorOf(w.outsider.id), "TASK", w.task.id, w.ws.id);
    expect(outside).toEqual({ canAsk: false, items: [] });
    // another company's owner reads nothing of this company's task
    const foreign = await approvalsLinkedTo(await actorOf(w.foreign.owner.id), "TASK", w.task.id, w.ws.id);
    expect(foreign).toEqual({ canAsk: false, items: [] });
    await loginAs(w.owner.id);
    expect((await flip("approvals", false)).status).toBe(200);
    expect(await approvalsLinkedTo(await actorOf(w.member.id), "TASK", w.task.id, w.ws.id)).toBeNull();
    expect(await approvalsLinkedTo(await actorOf(w.owner.id), "TASK", w.task.id, w.ws.id)).toBeNull();
  });

  it("the task page draws the block with the button for staff, with the requests they may read, and nothing for a partner or while the switch is off", async () => {
    const w = await approvalsOnThings();
    const id = await askAbout(w, w.member, [w.lead.id], "TASK", w.task.id, "عنوان-طلب-ظاهر");
    jar().set(SPACE_COOKIE, w.ws.id);

    await loginAs(w.member.id);
    const markup = await html(TaskPage({ params: { id: w.task.id } }));
    expect(markup).toContain('data-linked-approvals="TASK"');
    expect(markup).toContain("data-linked-approvals-ask");
    expect(markup).toContain(`/approvals/${id}`);
    expect(markup).toContain("عنوان-طلب-ظاهر");
    const href = /href="([^"]*\/go\?[^"]*)"/.exec(markup)?.[1]?.replace(/&amp;/g, "&");
    const url = new URL(href!, "http://x.invalid");
    expect(url.searchParams.get("space")).toBe(w.ws.id);
    expect(url.searchParams.get("next")).toBe(`/approvals?new=1&link=TASK:${w.task.id}`);

    // a colleague who is not in the request's chain gets the button and not the request
    await loginAs(w.member2.id);
    const other = await html(TaskPage({ params: { id: w.task.id } }));
    expect(other).toContain("data-linked-approvals-ask");
    expect(other).not.toContain("عنوان-طلب-ظاهر");

    // an external partner's page has no block
    await loginAs(w.guest.id);
    const guestPage = await html(TaskPage({ params: { id: w.task.id } })).catch((e: unknown) => String(e));
    expect(guestPage).not.toContain("data-linked-approvals");
    expect(guestPage).not.toContain("عنوان-طلب-ظاهر");

    // switched off: no block for anybody, the owner included
    await loginAs(w.owner.id);
    await flip("approvals", false);
    for (const who of [w.member.id, w.owner.id]) {
      await loginAs(who);
      expect(await html(TaskPage({ params: { id: w.task.id } })), who).not.toContain("data-linked-approvals");
    }
  });

  it("the card page draws it too, linked with CARD", async () => {
    const w = await approvalsOnThings();
    await askAbout(w, w.member, [w.lead.id], "CARD", w.card.id, "طلب-بطاقة-ظاهر");
    jar().set(SPACE_COOKIE, w.ws.id);
    await loginAs(w.member.id);
    const markup = await html(CardPageRoute({ params: { id: w.card.id } }));
    expect(markup).toContain('data-linked-approvals="CARD"');
    expect(markup).toContain("طلب-بطاقة-ظاهر");
    const href = /href="([^"]*\/go\?[^"]*)"/.exec(markup)?.[1]?.replace(/&amp;/g, "&");
    expect(new URL(href!, "http://x.invalid").searchParams.get("next")).toBe(`/approvals?new=1&link=CARD:${w.card.id}`);
    await loginAs(w.member2.id);
    expect(await html(CardPageRoute({ params: { id: w.card.id } }))).not.toContain("طلب-بطاقة-ظاهر");
    await loginAs(w.owner.id);
    await flip("approvals", false);
    await loginAs(w.member.id);
    expect(await html(CardPageRoute({ params: { id: w.card.id } }))).not.toContain("data-linked-approvals");
  });
});

// ═════════════════════════════════════ 2. check-in answers beside the score ═════════════════════════════════════

const under = (orgId: string, userId: string, managerId: string | null) =>
  db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: { managerId } });

/** owner ── sup ── r1, r2     a peer under another supervisor, a guest, and another company. */
async function scoreWorld() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const mk = (name: string, role: "LEAD" | "MEMBER" = "MEMBER") => makeUser({ orgId, role, name });
  const sup = await mk("المسؤول", "LEAD");
  const sup2 = await mk("مسؤول آخر", "LEAD");
  const r1 = await mk("موظف واحد");
  const r2 = await mk("موظف اثنان");
  const peer = await mk("زميل من فريق آخر");
  await under(orgId, sup.id, t.owner.id);
  await under(orgId, sup2.id, t.owner.id);
  await under(orgId, r1.id, sup.id);
  await under(orgId, r2.id, sup.id);
  await under(orgId, peer.id, sup2.id);
  const outsider = await makeTeam();
  const a = await makeWorkspace(orgId, [{ userId: r1.id }, { userId: r2.id }, { userId: peer.id }], "مساحة التسجيل");
  const b = await makeWorkspace(orgId, [{ userId: r1.id }, { userId: r2.id }], "مساحة ثانية");
  return { ...t, orgId, sup, sup2, r1, r2, peer, outsider: outsider.owner, outsiderOrgId: outsider.org.id, a, b };
}
type ScoreWorld = Awaited<ReturnType<typeof scoreWorld>>;

const SECRET = "نص-إجابة-سري-جدا";
const round = (spaceId: string, day: string, participants: string[], answers: { userId: string; excused?: boolean }[]) =>
  db.checkinRound.create({
    data: {
      workspaceId: spaceId,
      day: new Date(`${day}T00:00:00.000Z`),
      openedAt: new Date(`${day}T06:00:00.000Z`),
      closedAt: new Date(`${day}T21:00:00.000Z`),
      questions: ["شو عملت؟"],
      participantIds: participants,
      answers: { create: answers.map((a) => ({ userId: a.userId, excused: a.excused ?? false, answers: a.excused ? [] : [SECRET] })) },
    },
  });

const scoreOf = async (viewer: string, userId: string) => {
  await loginAs(viewer);
  const res = await call(scoreRoute.GET, { url: "http://localhost/api/team-development/people/x/score?period=2026-10", params: { id: userId } });
  return { status: res.status, text: res.text, score: (res.json?.["score"] ?? null) as { score: number | null; extras: { checkins: { answered: number; streak: number } | null; trackedMinutes: number | null } } | null };
};

/** r1: answered 5, 6, then missed 7, then answered 8, 9 (the run is 2). r2: missed 5, answered 6 and 7, excused 8, answered 9 (the run is 3: the excused day is skipped). */
async function october(w: ScoreWorld) {
  const both = [w.r1.id, w.r2.id];
  await round(w.a.id, "2026-10-05", both, [{ userId: w.r1.id }]);
  await round(w.a.id, "2026-10-06", both, [{ userId: w.r1.id }, { userId: w.r2.id }]);
  await round(w.a.id, "2026-10-07", both, [{ userId: w.r2.id }]);
  await round(w.a.id, "2026-10-08", both, [{ userId: w.r1.id }, { userId: w.r2.id, excused: true }]);
  await round(w.a.id, "2026-10-09", both, [{ userId: w.r1.id }, { userId: w.r2.id }]);
}

describe("«التسجيل اليومي» beside the score: days answered and the run, numbers only", () => {
  it("shows the days answered and the run of answered days; a missed day ends the run, an excused day is skipped", async () => {
    const w = await scoreWorld();
    await october(w);
    expect((await scoreOf(w.owner.id, w.r1.id)).score?.extras.checkins).toEqual({ answered: 4, streak: 2 });
    expect((await scoreOf(w.owner.id, w.r2.id)).score?.extras.checkins).toEqual({ answered: 3, streak: 3 });
  });

  it("a day answered in two spaces counts once; a day missed in one space and answered in another is answered", async () => {
    const w = await scoreWorld();
    await round(w.a.id, "2026-10-05", [w.r1.id], [{ userId: w.r1.id }]);
    await round(w.b.id, "2026-10-05", [w.r1.id], [{ userId: w.r1.id }]);
    await round(w.a.id, "2026-10-06", [w.r1.id], []);
    await round(w.b.id, "2026-10-06", [w.r1.id], [{ userId: w.r1.id }]);
    expect((await scoreOf(w.owner.id, w.r1.id)).score?.extras.checkins).toEqual({ answered: 2, streak: 2 });
  });

  it("nobody who has no right to open the file gets it, and every reader sees the same numbers", async () => {
    const w = await scoreWorld();
    await october(w);
    for (const [label, id] of [["owner", w.owner.id], ["supervisor", w.sup.id], ["self", w.r1.id]] as const) {
      const got = await scoreOf(id, w.r1.id);
      expect(got.status, label).toBe(200);
      expect(got.score?.extras.checkins, label).toEqual({ answered: 4, streak: 2 });
    }
    for (const [label, id] of [["peer", w.peer.id], ["another supervisor", w.sup2.id], ["a colleague", w.r2.id], ["guest", w.guest.id], ["another company", w.outsider.id]] as const) {
      const got = await scoreOf(id, w.r1.id);
      expect(got.status, label).toBe(404);
      expect(got.text, label).not.toContain("answered");
    }
  });

  it("never carries an answer's text, and the raw answer of the same person never appears in the score's JSON", async () => {
    const w = await scoreWorld();
    await october(w);
    for (const id of [w.owner.id, w.sup.id, w.r1.id]) expect((await scoreOf(id, w.r1.id)).text).not.toContain(SECRET);
  });

  it("is shown BESIDE the score, never inside it: the composite is the same with or without check-ins", async () => {
    const w = await scoreWorld();
    const project = await makeProject(w.a.id, "مشروع");
    for (let i = 0; i < 3; i++) {
      await makeTask({ orgId: w.orgId, workspaceId: w.a.id, projectId: project.project.id, boardId: project.board.id, columnId: project.done.id, creatorId: w.owner.id, assigneeId: w.r1.id, dueDate: at(`2026-10-0${i + 5}T09:00:00Z`), completedAt: at(`2026-10-0${i + 2}T09:00:00Z`) });
    }
    const before = (await scoreOf(w.owner.id, w.r1.id)).score!;
    expect(before.score).not.toBeNull();
    expect(before.extras.checkins).toEqual({ answered: 0, streak: 0 });
    await october(w);
    const after = (await scoreOf(w.owner.id, w.r1.id)).score!;
    expect(after.score).toBe(before.score);
    expect(after.extras.checkins).toEqual({ answered: 4, streak: 2 });
  });

  it("is not on the screen at all while the `checkins` switch is off, and the score still answers", async () => {
    const w = await scoreWorld();
    await october(w);
    await setSwitch(w.orgId, "checkins", false);
    const got = await scoreOf(w.owner.id, w.r1.id);
    expect(got.status).toBe(200);
    expect(got.score?.extras.checkins).toBeNull();
    await setSwitch(w.orgId, "checkins", true);
    expect((await scoreOf(w.owner.id, w.r1.id)).score?.extras.checkins).toEqual({ answered: 4, streak: 2 });
  });

  it("counts only the rounds of the person's own company and only the days of the period", async () => {
    const w = await scoreWorld();
    await october(w);
    await round(w.a.id, "2026-09-30", [w.r1.id], [{ userId: w.r1.id }]); // the day before the period
    await round(w.a.id, "2026-11-01", [w.r1.id], [{ userId: w.r1.id }]); // the day after
    expect((await scoreOf(w.owner.id, w.r1.id)).score?.extras.checkins).toEqual({ answered: 4, streak: 2 });
    // another company's space cannot add to this company's number even when it names the same person
    const foreignWs = await makeWorkspace(w.outsiderOrgId, [], "غريبة");
    await round(foreignWs.id, "2026-10-12", [w.r1.id], [{ userId: w.r1.id }]);
    expect((await scoreOf(w.owner.id, w.r1.id)).score?.extras.checkins).toEqual({ answered: 4, streak: 2 });
  });
});

// ═════════════════════════════════════ 3. «الوقت المسجّل» on the owner board ═════════════════════════════════════

const NOW = at("2026-10-30T09:00:00Z");
const q = (extra: Record<string, string> = {}) => ({ from: "2026-10-20", to: "2026-10-30", ...extra });

async function boardWorld() {
  const t = await makeTeam();
  const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "Lead" });
  const spaceA = await makeWorkspace(t.org.id, [{ userId: lead.id, role: "ADMIN" }, { userId: t.member.id }, { userId: t.admin.id }], "مساحة أ");
  const spaceB = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id }], "مساحة ب");
  const entry = (userId: string, workspaceId: string, startedAt: string, minutes: number, over: { stopped?: boolean } = {}) =>
    db.timeEntry.create({
      data: {
        orgId: t.org.id,
        workspaceId,
        userId,
        taskTitle: "عمل",
        startedAt: at(startedAt),
        stoppedAt: over.stopped === false ? null : new Date(at(startedAt).getTime() + minutes * 60_000),
        seconds: over.stopped === false ? 0 : minutes * 60,
        source: "MANUAL",
      },
    });
  return { ...t, lead, spaceA, spaceB, entry };
}
const boardAs = async (userId: string) => {
  await loginAs(userId);
  return boardAccess(await requireActor());
};

describe("«الوقت المسجّل» on the owner board", () => {
  it("the owner reads the minutes of every person from every space; only finished entries that started in the window count", async () => {
    const w = await boardWorld();
    await w.entry(w.member.id, w.spaceA.id, "2026-10-21T08:00:00Z", 60);
    await w.entry(w.member.id, w.spaceB.id, "2026-10-22T08:00:00Z", 30);
    await w.entry(w.member.id, w.spaceA.id, "2026-10-23T08:00:00Z", 0, { stopped: false }); // a running timer: not counted
    await w.entry(w.member.id, w.spaceA.id, "2026-10-01T08:00:00Z", 500); // before the window
    await w.entry(w.admin.id, w.spaceB.id, "2026-10-25T08:00:00Z", 15);
    const o = await loadOverview(await boardAs(w.owner.id), q(), { now: NOW });
    expect(o.sections.map((c) => c.key)).toEqual(["time.minutes"]);
    expect(o.sections[0]).toMatchObject({ kind: "minutes" });
    expect(o.sectionValues[w.member.id]).toEqual({ "time.minutes": 90 });
    expect(o.sectionValues[w.admin.id]).toEqual({ "time.minutes": 15 });
    const person = await loadPerson(await boardAs(w.owner.id), w.member.id, q(), { now: NOW });
    expect(person.sectionValues).toEqual({ "time.minutes": 90 });
  });

  it("a team lead's board counts only the entries made inside the spaces they cover, and a person with only «لوحتي» reads their own", async () => {
    const w = await boardWorld();
    await w.entry(w.member.id, w.spaceA.id, "2026-10-21T08:00:00Z", 60);
    await w.entry(w.member.id, w.spaceB.id, "2026-10-22T08:00:00Z", 30);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.lead.id } }, data: { capabilities: ["board.team"] } });
    const o = await loadOverview(await boardAs(w.lead.id), q(), { now: NOW });
    expect(o.sectionValues[w.member.id]).toEqual({ "time.minutes": 60 }); // the 30 minutes of space B are not theirs to see
    expect(JSON.stringify(o)).not.toContain("مساحة ب");
    // «لوحتي»: the person's own page, everything of their own
    const self = await loadPerson(await boardAs(w.member.id), w.member.id, q(), { now: NOW });
    expect(self.sectionValues).toEqual({ "time.minutes": 90 });
  });

  it("a guest and a person with no board switch read nothing, and the column is gone while `timeTracking` is off", async () => {
    const w = await boardWorld();
    await w.entry(w.member.id, w.spaceA.id, "2026-10-21T08:00:00Z", 60);
    await expect(boardAs(w.guest.id)).rejects.toMatchObject({ message: "ownerboard.not_found" });
    await setSwitch(w.org.id, "timeTracking", false);
    const o = await loadOverview(await boardAs(w.owner.id), q(), { now: NOW });
    expect(o.sections).toEqual([]);
    expect(o.sectionValues[w.member.id] ?? {}).toEqual({});
    await setSwitch(w.org.id, "timeTracking", true);
    expect((await loadOverview(await boardAs(w.owner.id), q(), { now: NOW })).sections).toHaveLength(1);
  });

  it("the CSV of the people table carries the time as hours:minutes, like the screen", async () => {
    const w = await boardWorld();
    await w.entry(w.member.id, w.spaceA.id, new Date().toISOString(), 90);
    await loginAs(w.owner.id);
    const res = await (boardCsvRoute.GET as (req: Request) => Promise<Response>)(new Request("http://localhost/api/owner-board/csv?range=7d"));
    const text = await res.text();
    expect(text).toContain("الوقت المسجّل");
    expect(text).toContain("1:30");
  });
});

// ═════════════════════════════════════ 4. the CSV of a project's custom-field values ═════════════════════════════════════

async function fieldsWorld() {
  const team = await makeTeam();
  const colleague = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Colleague" });
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: colleague.id }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.guest.id, role: "GUEST" }], "مساحة");
  const made = await makeProject(ws.id, "مشروع");
  const mk = (title: string, assigneeId: string | null = team.member.id, projectId = made.project.id, boardId = made.board.id, columnId = made.todo.id) =>
    makeTask({ orgId: team.org.id, workspaceId: ws.id, projectId, boardId, columnId, creatorId: team.owner.id, assigneeId, title });
  return { ...team, colleague, ws, made, mk };
}
type FieldsWorld = Awaited<ReturnType<typeof fieldsWorld>>;

const addField = async (w: FieldsWorld, body: Record<string, unknown>) => {
  await loginAs(w.admin.id);
  const res = await call(fieldsRoute.POST, { params: { id: w.made.project.id }, body });
  return (res.json as { field: { id: string; options: { id: string; label: string }[] } }).field;
};
const setValue = async (taskId: string, fieldId: string, value: unknown) => {
  const res = await call(taskFieldRoute.PUT, { method: "PUT", params: { id: taskId, fieldId }, body: { value } });
  expect(res.status).toBe(200);
};
const csvOf = async (userId: string, projectId: string) => {
  await loginAs(userId);
  const res = await (fieldsCsvRoute.GET as unknown as (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>)(new Request("http://localhost/api/projects/x/fields/csv"), { params: { id: projectId } });
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  return { status: res.status, text: await res.text(), bom: [...bytes.slice(0, 3)], headers: res.headers };
};

describe("the CSV of a project's custom-field values", () => {
  it("a person who sees the project gets the values of its live fields: UTF-8 with a BOM, an attachment, one row per live task", async () => {
    const w = await fieldsWorld();
    const note = await addField(w, { label: "ملاحظة", type: "TEXT" });
    const qty = await addField(w, { label: "الكمية", type: "NUMBER", unit: "قطعة" });
    const kind = await addField(w, { label: "النوع", type: "SINGLE_CHOICE", options: [{ label: "عاجل" }, { label: "عادي" }] });
    const old = await addField(w, { label: "قديم", type: "TEXT" });
    const t1 = await w.mk("المهمة الأولى");
    const t2 = await w.mk("المهمة الثانية", null);
    const gone = await w.mk("مؤرشفة");
    await loginAs(w.member.id);
    await setValue(t1.id, note.id, "ملاحظة أولى");
    await setValue(t1.id, qty.id, "12.5");
    await setValue(t1.id, kind.id, kind.options[0]!.id);
    await setValue(t1.id, old.id, "لن يظهر");
    await setValue(gone.id, note.id, "مؤرشفة-لا-تظهر");
    await db.task.update({ where: { id: gone.id }, data: { archived: true } });
    await loginAs(w.admin.id);
    expect((await call((await import("@/app/api/projects/[id]/fields/[fieldId]/route")).PATCH, { method: "PATCH", params: { id: w.made.project.id, fieldId: old.id }, body: { archived: true } })).status).toBe(200);

    for (const who of [w.member, w.colleague, w.admin, w.owner]) {
      const out = await csvOf(who.id, w.made.project.id);
      expect(out.status, who.name).toBe(200);
      expect(out.bom, who.name).toEqual([0xef, 0xbb, 0xbf]);
      expect(out.headers.get("content-type")).toContain("text/csv");
      expect(out.headers.get("content-disposition")).toContain("attachment");
      const lines = out.text.trim().split("\r\n");
      expect(lines[0], who.name).toBe("الرقم,العنوان,الحالة,المسؤول,ملاحظة,الكمية (قطعة),النوع");
      expect(lines, who.name).toHaveLength(3);
      expect(lines[1]).toContain("المهمة الأولى");
      expect(lines[1]).toContain("ملاحظة أولى");
      expect(lines[1]).toContain(",12.5,عاجل");
      expect(lines[2]).toContain("المهمة الثانية");
      expect(out.text).not.toContain("لن يظهر");
      expect(out.text).not.toContain("مؤرشفة-لا-تظهر");
      expect(out.text).not.toContain("قديم");
    }
    void t2;
  });

  it("no cell can run as a formula in a spreadsheet: titles, texts, choices and labels typed by people are made safe", async () => {
    const w = await fieldsWorld();
    const note = await addField(w, { label: "=ملاحظة", type: "TEXT" });
    const kind = await addField(w, { label: "نوع", type: "SINGLE_CHOICE", options: [{ label: "+عاجل" }] });
    const task = await w.mk("=HYPERLINK(\"http://evil.example\")");
    await loginAs(w.member.id);
    await setValue(task.id, note.id, "@SUM(1+1)");
    await setValue(task.id, kind.id, kind.options[0]!.id);
    const out = await csvOf(w.member.id, w.made.project.id);
    expect(out.text).toContain("'=ملاحظة");
    expect(out.text).toContain("'=HYPERLINK");
    expect(out.text).toContain("'@SUM(1+1)");
    expect(out.text).toContain("'+عاجل");
    for (const line of out.text.replace(/^﻿/, "").split("\r\n")) for (const cell of line.split(",")) expect(cell).not.toMatch(/^[=+@]/);
  });

  it("an external partner gets nothing (not even the file's header), a person outside the space and another company get «not found», a switched-off company too", async () => {
    const w = await fieldsWorld();
    const note = await addField(w, { label: "ملاحظة", type: "TEXT" });
    const task = await w.mk("مهمة");
    await loginAs(w.member.id);
    await setValue(task.id, note.id, "قيمة-سرية");
    const guest = await csvOf(w.guest.id, w.made.project.id);
    expect(guest.status).toBe(403);
    expect(guest.text).not.toContain("قيمة-سرية");
    expect(guest.text).not.toContain("ملاحظة");
    const stranger = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "Stranger" });
    const other = await makeTeam();
    for (const person of [stranger, other.owner, other.admin]) {
      const out = await csvOf(person.id, w.made.project.id);
      expect([403, 404], person.name).toContain(out.status);
      expect(out.text).not.toContain("قيمة-سرية");
    }
    await setSwitch(w.org.id, "customFields", false);
    const off = await csvOf(w.owner.id, w.made.project.id);
    expect(off.status).toBe(404);
    expect(off.text).not.toContain("قيمة-سرية");
  });

  it("a project of a team follows the team: a member outside it gets «not found», the space's admin and a member of the team get the file", async () => {
    const w = await fieldsWorld();
    const team = await db.team.create({ data: { workspaceId: w.ws.id, name: "فريق مغلق", members: { create: [{ userId: w.colleague.id }] } } });
    await db.project.update({ where: { id: w.made.project.id }, data: { teamId: team.id } });
    const note = await addField(w, { label: "ملاحظة", type: "TEXT" });
    await w.mk("مهمة الفريق");
    expect((await csvOf(w.member.id, w.made.project.id)).status).toBe(404);
    expect((await csvOf(w.colleague.id, w.made.project.id)).status).toBe(200);
    expect((await csvOf(w.admin.id, w.made.project.id)).status).toBe(200);
    void note;
  });

  it("every export is audited with who, which project and how many rows (never a value)", async () => {
    const w = await fieldsWorld();
    const note = await addField(w, { label: "ملاحظة", type: "TEXT" });
    const task = await w.mk("مهمة");
    await loginAs(w.member.id);
    await setValue(task.id, note.id, "قيمة-للتدقيق");
    await csvOf(w.member.id, w.made.project.id);
    const rows = await db.auditLog.findMany({ where: { action: "customField.exported", orgId: w.org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: w.member.id, target: w.made.project.id });
    expect(JSON.stringify(rows[0]?.meta)).toBe(JSON.stringify({ rows: 1, fields: 1 }));
    expect(JSON.stringify(rows[0])).not.toContain("قيمة-للتدقيق");
  });
});
