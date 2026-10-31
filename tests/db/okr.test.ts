import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as goalsRoute from "@/app/api/goals/route";
import * as goalRoute from "@/app/api/goals/[id]/route";
import * as addRoute from "@/app/api/goals/[id]/key-results/route";
import * as krRoute from "@/app/api/key-results/[id]/route";
import * as updatesRoute from "@/app/api/key-results/[id]/updates/route";
import { withFeature } from "@/lib/features";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * «الأهداف والنتائج» — key results, owner, quarter, check-ins and a status light on the existing goals (the owner's approved backlog,
 * 2026-10-31). Against a real PostgreSQL, this pins:
 *  - an objective gets 1 to 5 measurable key results (never a sixth, even from simultaneous requests), its progress is the average of
 *    theirs and the stored number is kept in step;
 *  - a check-in is append-only (the previous value is recorded, no route edits or deletes a row) and refused on a key result that
 *    follows tasks; a project's or tasks' finished work moves a linked key result by itself;
 *  - who writes: the goal's owner, the space's admin and the company's owner; a plain member who holds the edit box but is neither
 *    is refused; a guest never; a space the person is not in is «not found»; reading writes nothing (the owner reads in silence);
 *  - the light is set by a person and never by the system;
 *  - the `okr` switch off: the routes answer «not found», a new goal cannot use any of it, the page is as before, and everything
 *    stored comes back with the switch.
 */

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
const enter = (spaceId: string) => jar().set(SPACE_COOKIE, spaceId);

interface GoalOut {
  id: string;
  title: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  progress: number;
  manualProgress: number;
  fromKeyResults: boolean;
  ownerId: string | null;
  ownerName: string | null;
  light: string | null;
  lightSetAt: string | null;
  canEdit: boolean;
  canAct: boolean;
  keyResults: KrOut[];
}
interface KrOut {
  id: string;
  title: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string;
  percent: number;
  linked: { kind: string; done: number; total: number } | null;
}

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const lead = await makeUser({ orgId, role: "MEMBER", name: "قائد المساحة" });
  const mate = await makeUser({ orgId, role: "MEMBER", name: "زميل" });
  const stranger = await makeUser({ orgId, role: "MEMBER", name: "غريب" });
  const ws = await makeWorkspace(
    orgId,
    [{ userId: team.admin.id, role: "ADMIN" }, { userId: lead.id, role: "ADMIN" }, { userId: team.member.id }, { userId: mate.id }],
    `مساحة ${uid()}`,
  );
  const other = await makeWorkspace(orgId, [{ userId: stranger.id, role: "ADMIN" }, { userId: team.admin.id, role: "ADMIN" }], `ثانية ${uid()}`);
  return { ...team, lead, mate, stranger, ws, other };
}
type World = Awaited<ReturnType<typeof world>>;

async function setBoxes(orgId: string, userId: string, capabilities: string[]) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: { capabilities } });
}

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "okr", on) as Prisma.InputJsonValue } });
}

const KR = (title: string, over: Record<string, unknown> = {}) => ({ title, startValue: 0, targetValue: 100, unit: "عميل", ...over });

/** An objective made through the API by the given person, in the given space. */
async function makeGoal(w: World, by: string, body: Record<string, unknown> = {}, space = w.ws.id) {
  await loginAs(by);
  enter(space);
  const res = await call(goalsRoute.POST, { body: { title: "زيادة المبيعات", period: "MONTHLY", anchorDate: "2026-11-10", ...body } });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return (res.json as { goal: { id: string } }).goal.id;
}

async function listAs(userId: string, space: string) {
  await loginAs(userId);
  enter(space);
  const res = await call(goalsRoute.GET);
  expect(res.status).toBe(200);
  return res.json as { goals: GoalOut[]; okr: boolean; spaceId: string };
}

const messageOf = (res: { json: unknown }) => (res.json as { message?: string; details?: { message: string }[] }).message;
const issueOf = (res: { json: unknown }) => (res.json as { details?: { message: string }[] }).details?.[0]?.message;

describe("«الأهداف والنتائج»: an objective with key results", () => {
  it("is created with an owner and key results; its progress is their average, and the stored number follows", async () => {
    const w = await world();
    const id = await makeGoal(w, w.admin.id, {
      ownerId: w.member.id,
      keyResults: [KR("عملاء جدد", { currentValue: 50 }), KR("طلبات مكتملة", { targetValue: 10, currentValue: 10, unit: "طلب" })],
    });
    const listed = await listAs(w.admin.id, w.ws.id);
    expect(listed.okr).toBe(true);
    expect(listed.spaceId).toBe(w.ws.id);
    const goal = listed.goals.find((g) => g.id === id)!;
    expect(goal.ownerId).toBe(w.member.id);
    expect(goal.ownerName).toBe("Member");
    expect(goal.keyResults.map((k) => [k.title, k.percent, k.unit])).toEqual([["عملاء جدد", 50, "عميل"], ["طلبات مكتملة", 100, "طلب"]]);
    expect(goal.fromKeyResults).toBe(true);
    expect(goal.progress).toBe(75);
    expect(goal.canEdit).toBe(true);
    // a goal with no key result keeps the number moved by hand
    const plain = await makeGoal(w, w.admin.id, { title: "هدف بلا نتائج", progress: 40 });
    const again = (await listAs(w.admin.id, w.ws.id)).goals.find((g) => g.id === plain)!;
    expect(again.keyResults).toEqual([]);
    expect(again.fromKeyResults).toBe(false);
    expect(again.progress).toBe(40);
  });

  it("a goal with no owner named is its creator's; naming none again hands it back", async () => {
    const w = await world();
    const id = await makeGoal(w, w.admin.id);
    expect((await listAs(w.admin.id, w.ws.id)).goals[0]!.ownerId).toBe(w.admin.id);
    await loginAs(w.admin.id);
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { ownerId: w.member.id } })).status).toBe(200);
    expect((await listAs(w.admin.id, w.ws.id)).goals[0]!.ownerName).toBe("Member");
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { ownerId: null } })).status).toBe(200);
    expect((await listAs(w.admin.id, w.ws.id)).goals[0]!.ownerId).toBe(w.admin.id);
  });

  it("the owner of a goal must be somebody of its space: not a guest, not a stranger, not a suspended person", async () => {
    const w = await world();
    const suspended = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "موقوف" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: suspended.id } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: suspended.id } }, data: { status: "SUSPENDED" } });
    await loginAs(w.admin.id);
    enter(w.ws.id);
    for (const ownerId of [w.guest.id, w.stranger.id, suspended.id, "no-such-user"]) {
      const res = await call(goalsRoute.POST, { body: { title: "هدف", period: "WEEKLY", anchorDate: "2026-11-10", ownerId } });
      expect(res.status, ownerId).toBe(422);
      expect(issueOf(res), ownerId).toBe("okr.owner_invalid");
    }
    expect(await db.goal.count({ where: { orgId: w.org.id } })).toBe(0);
    // the company's owner has no row in the space and may still be named
    const res = await call(goalsRoute.POST, { body: { title: "هدف المالك", period: "WEEKLY", anchorDate: "2026-11-10", ownerId: w.owner.id } });
    expect(res.status).toBe(201);
  });

  it("a quarter is the calendar quarter, in the company's zone", async () => {
    const w = await world();
    await makeGoal(w, w.admin.id, { period: "QUARTERLY", anchorDate: "2026-11-15" });
    const goal = (await listAs(w.admin.id, w.ws.id)).goals[0]!;
    expect(goal.period).toBe("QUARTERLY");
    // Damascus is UTC+3 in the autumn: the quarter begins at 1 October 00:00 local (30 September 21:00Z)
    expect(goal.periodStart).toBe("2026-09-30T21:00:00.000Z");
    expect(goal.periodEnd).toBe("2026-12-31T20:59:59.999Z");
  });
});

describe("«الأهداف والنتائج»: at most five key results", () => {
  it("the sixth is refused, and nothing is written for it", async () => {
    const w = await world();
    const id = await makeGoal(w, w.admin.id, { keyResults: [KR("1"), KR("2"), KR("3"), KR("4")].map((k, i) => ({ ...k, title: `نتيجة ${i + 1}` })) });
    await loginAs(w.admin.id);
    expect((await call(addRoute.POST, { params: { id }, body: KR("نتيجة خامسة") })).status).toBe(201);
    const sixth = await call(addRoute.POST, { params: { id }, body: KR("نتيجة سادسة") });
    expect(sixth.status).toBe(422);
    expect(issueOf(sixth)).toBe("okr.max_five");
    expect(await db.keyResult.count({ where: { goalId: id } })).toBe(5);
  });

  it("six at creation is refused, and no goal is left behind", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    enter(w.ws.id);
    const res = await call(goalsRoute.POST, { body: { title: "هدف كبير", period: "WEEKLY", anchorDate: "2026-11-10", keyResults: Array.from({ length: 6 }, (_, i) => KR(`نتيجة ${i + 1}`)) } });
    expect(res.status).toBe(422);
    expect(await db.goal.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("eight simultaneous additions make five, never more", async () => {
    const w = await world();
    const id = await makeGoal(w, w.admin.id);
    await loginAs(w.admin.id);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call(addRoute.POST, { params: { id }, body: KR(`نتيجة ${i + 1}`) })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 422)).toHaveLength(3);
    expect(await db.keyResult.count({ where: { goalId: id } })).toBe(5);
    const positions = (await db.keyResult.findMany({ where: { goalId: id }, select: { position: true } })).map((k) => k.position).sort();
    expect(positions).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("«الأهداف والنتائج»: check-ins are append-only", () => {
  async function withKr(w: World) {
    const id = await makeGoal(w, w.admin.id, { ownerId: w.member.id, keyResults: [KR("عملاء جدد", { targetValue: 10, unit: "عميل" })] });
    const kr = await db.keyResult.findFirstOrThrow({ where: { goalId: id } });
    return { id, kr };
  }

  it("the goal's owner records a value and a note; the previous value is kept, the progress follows", async () => {
    const w = await world();
    const { id, kr } = await withKr(w);
    await loginAs(w.member.id);
    const first = await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 4, note: "أول اتفاقيتين" } });
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const second = await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 7 } });
    expect(second.status).toBe(201);
    expect((second.json as { progress: number }).progress).toBe(70);
    const rows = await db.keyResultUpdate.findMany({ where: { keyResultId: kr.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.previousValue, r.value, r.note, r.authorId])).toEqual([[0, 4, "أول اتفاقيتين", w.member.id], [4, 7, "", w.member.id]]);
    expect((await db.goal.findUniqueOrThrow({ where: { id }, select: { progress: true } })).progress).toBe(70);
    const history = await call(updatesRoute.GET, { params: { id: kr.id } });
    const list = (history.json as { updates: { value: number; authorName: string }[] }).updates;
    expect(list.map((u) => u.value)).toEqual([7, 4]);
    expect(list[0]!.authorName).toBe("Member");
  });

  it("two check-ins at once each keep the value they replaced", async () => {
    const w = await world();
    const { kr } = await withKr(w);
    await loginAs(w.member.id);
    const both = await Promise.all([1, 2].map((value) => call(updatesRoute.POST, { params: { id: kr.id }, body: { value } })));
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    const rows = await db.keyResultUpdate.findMany({ where: { keyResultId: kr.id }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    // a chain: the second one replaced what the first one wrote
    expect(rows[1]!.previousValue).toBe(rows[0]!.value);
    expect(rows[0]!.previousValue).toBe(0);
  });

  it("no route edits or deletes a check-in: the history route has a GET and a POST only", () => {
    expect(Object.keys(updatesRoute).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k)).sort()).toEqual(["GET", "POST"]);
  });

  it("a number that is not a number, or a note that is too long, is refused", async () => {
    const w = await world();
    const { kr } = await withKr(w);
    await loginAs(w.member.id);
    expect((await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: "كثير" } })).status).toBe(422);
    expect((await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 3, note: "ن".repeat(501) } })).status).toBe(422);
    expect(await db.keyResultUpdate.count({ where: { keyResultId: kr.id } })).toBe(0);
  });

  it("removing a goal takes its key results and their history with it", async () => {
    const w = await world();
    const { id, kr } = await withKr(w);
    await loginAs(w.member.id);
    await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 2 } });
    await loginAs(w.admin.id);
    enter(w.ws.id);
    expect((await call(goalRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    expect(await db.keyResult.count({ where: { goalId: id } })).toBe(0);
    expect(await db.keyResultUpdate.count({ where: { keyResultId: kr.id } })).toBe(0);
  });
});

describe("«الأهداف والنتائج»: who may write", () => {
  async function setup() {
    const w = await world();
    const id = await makeGoal(w, w.admin.id, { ownerId: w.member.id, keyResults: [KR("عملاء جدد")] });
    const kr = await db.keyResult.findFirstOrThrow({ where: { goalId: id } });
    return { w, id, kr };
  }

  it("a teammate who is neither the owner nor an admin can not check in, change the light or edit", async () => {
    const { w, id, kr } = await setup();
    await loginAs(w.mate.id);
    enter(w.ws.id);
    const checkin = await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 5 } });
    expect(checkin.status).toBe(403);
    expect(messageOf(checkin)).toBe("goals.not_owner");
    const light = await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { light: "AT_RISK" } });
    expect(light.status).toBe(403);
    expect(messageOf(light)).toBe("goals.not_owner");
    expect(await db.keyResultUpdate.count({ where: { keyResultId: kr.id } })).toBe(0);
    expect((await db.goal.findUniqueOrThrow({ where: { id }, select: { light: true } })).light).toBeNull();
    // they still read it, and see they may not act
    const goal = (await listAs(w.mate.id, w.ws.id)).goals.find((g) => g.id === id)!;
    expect(goal.canAct).toBe(false);
    expect(goal.canEdit).toBe(false);
    expect(goal.keyResults).toHaveLength(1);
  });

  it("a member holding «يضيف ويعدّل» who is not the owner can not add, edit or remove key results, nor delete or retitle the goal", async () => {
    const { w, id, kr } = await setup();
    await setBoxes(w.org.id, w.mate.id, ["goals.edit", "goals.delete"]);
    await loginAs(w.mate.id);
    enter(w.ws.id);
    expect((await call(addRoute.POST, { params: { id }, body: KR("دخيلة") })).status).toBe(403);
    expect((await call(krRoute.PATCH, { method: "PATCH", params: { id: kr.id }, body: { title: "غيّرتها" } })).status).toBe(403);
    expect((await call(krRoute.DELETE, { method: "DELETE", params: { id: kr.id } })).status).toBe(403);
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { title: "عنوان جديد" } })).status).toBe(403);
    expect((await call(goalRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(403);
    expect(await db.keyResult.count({ where: { goalId: id } })).toBe(1);
    expect((await db.goal.findUniqueOrThrow({ where: { id }, select: { title: true } })).title).toBe("زيادة المبيعات");
  });

  it("the owner may check in and set the light with only «يشوف», but not change the structure without «يضيف ويعدّل»", async () => {
    const { w, id, kr } = await setup();
    await loginAs(w.member.id);
    enter(w.ws.id);
    expect((await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 5 } })).status).toBe(201);
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { light: "BEHIND" } })).status).toBe(200);
    const edit = await call(krRoute.PATCH, { method: "PATCH", params: { id: kr.id }, body: { title: "اسم جديد" } });
    expect(edit.status).toBe(403);
    expect(messageOf(edit)).toBe("goals.role_denied");
    // with the box, the owner edits their own key result
    await setBoxes(w.org.id, w.member.id, ["goals.edit"]);
    expect((await call(krRoute.PATCH, { method: "PATCH", params: { id: kr.id }, body: { title: "اسم جديد" } })).status).toBe(200);
    expect((await call(addRoute.POST, { params: { id }, body: KR("نتيجة ثانية") })).status).toBe(201);
  });

  it("the space's admin and the company's owner act for any goal of the space", async () => {
    const { w, id, kr } = await setup();
    await loginAs(w.lead.id);
    enter(w.ws.id);
    await setBoxes(w.org.id, w.lead.id, ["goals.edit"]);
    expect((await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 1 } })).status).toBe(201);
    expect((await call(addRoute.POST, { params: { id }, body: KR("من القائد") })).status).toBe(201);
    await loginAs(w.owner.id);
    expect((await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 2 } })).status).toBe(201);
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { light: "ON_TRACK" } })).status).toBe(200);
  });

  it("a person of another space gets «not found» for the goal, its key results and its history, and nothing is written", async () => {
    const { w, id, kr } = await setup();
    await loginAs(w.stranger.id);
    enter(w.other.id);
    for (const res of [
      await call(addRoute.POST, { params: { id }, body: KR("تسلل") }),
      await call(krRoute.PATCH, { method: "PATCH", params: { id: kr.id }, body: { title: "تسلل" } }),
      await call(krRoute.DELETE, { method: "DELETE", params: { id: kr.id } }),
      await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 9 } }),
      await call(updatesRoute.GET, { params: { id: kr.id } }),
    ]) {
      expect([403, 404]).toContain(res.status);
      expect(JSON.stringify(res.json)).not.toContain("عملاء جدد");
    }
    expect(await db.keyResult.count({ where: { goalId: id } })).toBe(1);
    expect(await db.keyResultUpdate.count({ where: { keyResultId: kr.id } })).toBe(0);
    // an admin of the OTHER space, who is not in this one, gets «not found» too
    await loginAs(w.stranger.id);
    expect((await listAs(w.stranger.id, w.other.id)).goals).toEqual([]);
  });

  it("a guest gets 403 `guest.no_access` from every route, and nothing is written", async () => {
    const { w, id, kr } = await setup();
    await loginAs(w.guest.id);
    enter(w.ws.id);
    for (const res of [
      await call(goalsRoute.GET),
      await call(addRoute.POST, { params: { id }, body: KR("ضيف") }),
      await call(krRoute.PATCH, { method: "PATCH", params: { id: kr.id }, body: { title: "ضيف" } }),
      await call(krRoute.DELETE, { method: "DELETE", params: { id: kr.id } }),
      await call(updatesRoute.GET, { params: { id: kr.id } }),
      await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 3 } }),
    ]) {
      expect(res.status).toBe(403);
      expect(messageOf(res)).toBe("guest.no_access");
      expect(JSON.stringify(res.json)).not.toContain("عملاء جدد");
    }
    expect(await db.keyResultUpdate.count({ where: { keyResultId: kr.id } })).toBe(0);
  });

  it("the company's owner reads the goals and the history without leaving a trace", async () => {
    const { w, kr } = await setup();
    await loginAs(w.member.id);
    enter(w.ws.id);
    await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 3, note: "تقدّم" } });
    const count = async () => ({
      audit: await db.auditLog.count({ where: { orgId: w.org.id } }),
      notices: await db.notification.count(),
      members: await db.workspaceMember.count({ where: { workspaceId: w.ws.id } }),
      updates: await db.keyResultUpdate.count(),
      krs: await db.keyResult.count(),
    });
    const before = await count();
    await loginAs(w.owner.id);
    enter(w.ws.id);
    const goals = await call(goalsRoute.GET);
    expect(goals.status).toBe(200);
    expect((goals.json as { goals: GoalOut[] }).goals[0]!.keyResults).toHaveLength(1);
    const history = await call(updatesRoute.GET, { params: { id: kr.id } });
    expect(history.status).toBe(200);
    expect((history.json as { updates: unknown[] }).updates).toHaveLength(1);
    expect(await count()).toEqual(before);
  });
});

describe("«الأهداف والنتائج»: the status light is a person's", () => {
  it("is set and cleared by a person; the system never sets it, however far behind the goal is", async () => {
    const w = await world();
    // a period long over and nothing done: the screen would suggest «بخطر», the data still says nobody set a light
    const id = await makeGoal(w, w.admin.id, { period: "WEEKLY", anchorDate: "2026-01-05", keyResults: [KR("نتيجة")] });
    const kr = await db.keyResult.findFirstOrThrow({ where: { goalId: id } });
    await loginAs(w.admin.id);
    await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 1 } });
    await listAs(w.admin.id, w.ws.id);
    let row = await db.goal.findUniqueOrThrow({ where: { id }, select: { light: true, lightSetAt: true } });
    expect(row).toEqual({ light: null, lightSetAt: null });

    await loginAs(w.admin.id);
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { light: "AT_RISK" } })).status).toBe(200);
    row = await db.goal.findUniqueOrThrow({ where: { id }, select: { light: true, lightSetAt: true } });
    expect(row.light).toBe("AT_RISK");
    expect(row.lightSetAt).not.toBeNull();
    expect((await listAs(w.admin.id, w.ws.id)).goals[0]!.light).toBe("AT_RISK");

    await loginAs(w.admin.id);
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { light: null } })).status).toBe(200);
    expect(await db.goal.findUniqueOrThrow({ where: { id }, select: { light: true, lightSetAt: true } })).toEqual({ light: null, lightSetAt: null });
    // a colour that is not one of the three is refused
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { light: "GREEN" } })).status).toBe(422);
  });
});

describe("«الأهداف والنتائج»: a key result that follows tasks", () => {
  async function tasks(w: World, n: number, done: number, space = w.ws.id) {
    const made = await makeProject(space, "مشروع الإطلاق");
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(
        await makeTask({
          orgId: w.org.id,
          workspaceId: space,
          projectId: made.project.id,
          boardId: made.board.id,
          columnId: i < done ? made.done.id : made.todo.id,
          creatorId: w.admin.id,
          completedAt: i < done ? new Date() : null,
        }),
      );
    }
    return { ...made, rows };
  }

  it("follows a project's finished tasks, with the target defaulting to all of them", async () => {
    const w = await world();
    const p = await tasks(w, 3, 1);
    const id = await makeGoal(w, w.admin.id, { keyResults: [{ title: "إطلاق المشروع", projectId: p.project.id, unit: "مهمة" }] });
    let goal = (await listAs(w.admin.id, w.ws.id)).goals.find((g) => g.id === id)!;
    expect(goal.keyResults[0]).toMatchObject({ currentValue: 1, targetValue: 3, percent: 33, linked: { kind: "project", done: 1, total: 3 } });
    expect(goal.progress).toBe(33);
    // a task is finished: the number moves by itself
    await db.task.update({ where: { id: p.rows[1]!.id }, data: { completedAt: new Date() } });
    goal = (await listAs(w.admin.id, w.ws.id)).goals.find((g) => g.id === id)!;
    expect(goal.keyResults[0]).toMatchObject({ currentValue: 2, percent: 67 });
    // an archived task of the project is not counted
    await db.task.update({ where: { id: p.rows[2]!.id }, data: { archived: true } });
    goal = (await listAs(w.admin.id, w.ws.id)).goals.find((g) => g.id === id)!;
    expect(goal.keyResults[0]).toMatchObject({ currentValue: 2, linked: { total: 2 } });
    // the target stays what it was set to (3): two of three
    expect(goal.keyResults[0]!.percent).toBe(67);
  });

  it("follows chosen tasks; a check-in is refused on either kind", async () => {
    const w = await world();
    const p = await tasks(w, 4, 2);
    const id = await makeGoal(w, w.admin.id, {
      keyResults: [{ title: "مهمتين محددتين", taskIds: [p.rows[0]!.id, p.rows[3]!.id], targetValue: 2 }, { title: "المشروع كله", projectId: p.project.id }],
    });
    const goal = (await listAs(w.admin.id, w.ws.id)).goals.find((g) => g.id === id)!;
    expect(goal.keyResults[0]).toMatchObject({ currentValue: 1, targetValue: 2, percent: 50, linked: { kind: "tasks", done: 1, total: 2 } });
    await loginAs(w.admin.id);
    for (const kr of goal.keyResults) {
      const res = await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 1 } });
      expect(res.status).toBe(422);
      expect(issueOf(res)).toBe("okr.linked_no_checkin");
    }
    expect(await db.keyResultUpdate.count({ where: { keyResult: { goalId: id } } })).toBe(0);
    // unlinking gives the hand back
    expect((await call(krRoute.PATCH, { method: "PATCH", params: { id: goal.keyResults[1]!.id }, body: { projectId: null, targetValue: 10 } })).status).toBe(200);
    expect((await call(updatesRoute.POST, { params: { id: goal.keyResults[1]!.id }, body: { value: 4 } })).status).toBe(201);
  });

  it("refuses a project or tasks of another space, a project and tasks together, and a target-less hand-fed key result", async () => {
    const w = await world();
    const mine = await tasks(w, 1, 0);
    const theirs = await tasks(w, 1, 0, w.other.id);
    const id = await makeGoal(w, w.admin.id);
    await loginAs(w.admin.id);
    enter(w.ws.id);
    const post = (body: Record<string, unknown>) => call(addRoute.POST, { params: { id }, body });
    expect(issueOf(await post({ title: "مشروع غريب", projectId: theirs.project.id }))).toBe("okr.link_not_found");
    expect(issueOf(await post({ title: "مهمة غريبة", taskIds: [theirs.rows[0]!.id] }))).toBe("okr.link_not_found");
    expect(issueOf(await post({ title: "مهمة مجهولة", taskIds: ["nope"] }))).toBe("okr.link_not_found");
    expect(issueOf(await post({ title: "الاثنين", projectId: mine.project.id, taskIds: [mine.rows[0]!.id] }))).toBe("okr.link_one_only");
    expect(issueOf(await post({ title: "بلا رقم مطلوب" }))).toBe("okr.target_required");
    expect(await db.keyResult.count({ where: { goalId: id } })).toBe(0);
  });
});

describe("«الأهداف والنتائج»: editing a key result", () => {
  it("changes its texts and numbers and keeps the history; removing one re-averages the goal", async () => {
    const w = await world();
    const id = await makeGoal(w, w.admin.id, { keyResults: [KR("نتيجة أولى", { currentValue: 100 }), KR("نتيجة ثانية", { currentValue: 0 })] });
    expect((await listAs(w.admin.id, w.ws.id)).goals[0]!.progress).toBe(50);
    const [a, b] = await db.keyResult.findMany({ where: { goalId: id }, orderBy: { position: "asc" } });
    await loginAs(w.admin.id);
    await call(updatesRoute.POST, { params: { id: b!.id }, body: { value: 20, note: "بداية" } });
    const patched = await call(krRoute.PATCH, { method: "PATCH", params: { id: b!.id }, body: { title: "ب معدّلة", targetValue: 40, unit: "طلب" } });
    expect(patched.status).toBe(200);
    expect((patched.json as { keyResult: KrOut }).keyResult).toMatchObject({ title: "ب معدّلة", targetValue: 40, unit: "طلب", currentValue: 20, percent: 50 });
    expect(await db.keyResultUpdate.count({ where: { keyResultId: b!.id } })).toBe(1);
    expect((await call(krRoute.PATCH, { method: "PATCH", params: { id: b!.id }, body: {} })).status).toBe(422);
    expect((await call(krRoute.DELETE, { method: "DELETE", params: { id: b!.id } })).status).toBe(200);
    const goal = (await listAs(w.admin.id, w.ws.id)).goals[0]!;
    expect(goal.keyResults.map((k) => k.id)).toEqual([a!.id]);
    expect(goal.progress).toBe(100);
  });
});

describe("«الأهداف والنتائج»: the switch", () => {
  it("off: the routes answer «not found», a new goal can not use any of it and the page is as before; on: everything is back", async () => {
    const w = await world();
    const id = await makeGoal(w, w.admin.id, { ownerId: w.member.id, keyResults: [KR("نتيجة", { currentValue: 30 })] });
    await makeGoal(w, w.admin.id, { title: "هدف ربعي", period: "QUARTERLY" });
    const kr = await db.keyResult.findFirstOrThrow({ where: { goalId: id } });
    await db.goal.update({ where: { id }, data: { light: "BEHIND", progress: 30 } });

    await setSwitch(w.org.id, false);
    await loginAs(w.admin.id);
    enter(w.ws.id);
    for (const res of [
      await call(addRoute.POST, { params: { id }, body: KR("جديدة") }),
      await call(krRoute.PATCH, { method: "PATCH", params: { id: kr.id }, body: { title: "x1" } }),
      await call(krRoute.DELETE, { method: "DELETE", params: { id: kr.id } }),
      await call(updatesRoute.GET, { params: { id: kr.id } }),
      await call(updatesRoute.POST, { params: { id: kr.id }, body: { value: 5 } }),
      await call(goalsRoute.POST, { body: { title: "ربعي", period: "QUARTERLY", anchorDate: "2026-11-10" } }),
      await call(goalsRoute.POST, { body: { title: "فيه نتائج", period: "WEEKLY", anchorDate: "2026-11-10", keyResults: [KR("نتيجة")] } }),
      await call(goalsRoute.POST, { body: { title: "فيه مسؤول", period: "WEEKLY", anchorDate: "2026-11-10", ownerId: w.member.id } }),
      await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { light: "ON_TRACK" } }),
    ]) {
      expect(res.status, JSON.stringify(res.json)).toBe(404);
      expect(messageOf(res)).toBe("features.off");
    }
    const off = await call(goalsRoute.GET);
    const offBody = off.json as { goals: GoalOut[]; okr: boolean };
    expect(offBody.okr).toBe(false);
    // as before: no quarterly goal, no key results, no owner, no light, the hand-moved number
    expect(offBody.goals.map((g) => g.title)).toEqual(["زيادة المبيعات"]);
    expect(offBody.goals[0]).toMatchObject({ keyResults: [], ownerId: null, light: null, fromKeyResults: false, progress: 30 });
    // the ordinary goal edits still work
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { progress: 55 } })).status).toBe(200);
    expect(await db.keyResult.count({ where: { goalId: id } })).toBe(1);

    // and who may edit is as before «الأهداف والنتائج»: the box alone, not being the goal's owner
    await setBoxes(w.org.id, w.mate.id, ["goals.edit", "goals.delete"]);
    await loginAs(w.mate.id);
    enter(w.ws.id);
    const offList = (await call(goalsRoute.GET)).json as { goals: GoalOut[] };
    expect(offList.goals[0]!.canEdit).toBe(true);
    expect((await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { title: "عدّلها زميل" } })).status).toBe(200);
    // on again, the same person is refused: they are neither its owner nor an admin
    await setSwitch(w.org.id, true);
    const refused = await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { title: "مرة ثانية" } });
    expect(refused.status).toBe(403);
    expect(messageOf(refused)).toBe("goals.not_owner");
    const on = (await listAs(w.admin.id, w.ws.id)).goals.find((g) => g.id === id)!;
    expect(on.keyResults).toHaveLength(1);
    expect(on.light).toBe("BEHIND");
    expect(on.ownerName).toBe("Member");
    expect((await listAs(w.admin.id, w.ws.id)).goals.map((g) => g.period).sort()).toEqual(["MONTHLY", "QUARTERLY"]);
  });
});
