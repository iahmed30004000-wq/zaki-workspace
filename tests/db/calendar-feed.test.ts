import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import * as feedRoute from "@/app/api/calendar/feed/[token]/route";
import * as linksRoute from "@/app/api/me/calendar-feed/route";
import * as linkRoute from "@/app/api/me/calendar-feed/[id]/route";
import { withFeature } from "@/lib/features";
import { dayOfInstant } from "@/lib/due-day";
import { zonedWallTime } from "@/lib/zoned-time";
import { appUrl } from "@/server/env";
import { FEED_LIMITS, MAX_ACTIVE_TOKENS, buildFeedFor, resetFeedLimitersForTests } from "@/server/services/calendar-feed";
import { call, db, loginAs, logout, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «اشتراك التقويم»: a person's private calendar feed (GET /api/calendar/feed/<token>.ics), against a real database.
 *
 * What this pins:
 *  - the link is made by the person, shown ONCE, and only its SHA-256 is stored; the list never carries a token;
 *  - the feed holds ONLY that person's own work: their tasks (alone or beside others) with a due day, open, inside the
 *    window; their pending reminders; open milestones of projects they can see. Nothing of another person, nothing of a space
 *    they are not in, nothing of a team they are not in, and never a task's description;
 *  - every refusal is the same empty 404: unknown, malformed, revoked, suspended, offboarded, a guest, sessions ended
 *    (`tokenVersion`), the company's switch off; a person who lost a space stops seeing its items on the next fetch;
 *  - the answer is `text/calendar`, private, cookie-less, with an ETag (304 when nothing changed);
 *  - the limits: per link and per address (429 + Retry-After); the window (30 days back, 365 ahead) and the cap.
 */

beforeEach(() => {
  resetFeedLimitersForTests();
});

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const unfold = (text: string) => text.replace(/\r\n /g, "");
const DAY = 86_400_000;
const ZONE = "Asia/Damascus";
const HOST = () => new URL(appUrl()).hostname;
let ipCounter = 0;
const freshIp = () => `10.20.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

/** A due DAY as the app stores it: noon of the company's zone, `days` from now. */
const dueDay = (days: number, now = new Date()) => {
  const p = new Date(now.getTime() + days * DAY);
  return zonedWallTime({ year: p.getUTCFullYear(), month: p.getUTCMonth() + 1, day: p.getUTCDate(), hour: 12 }, ZONE);
};

async function world() {
  const t = await makeTeam();
  const mate = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "زميل" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: mate.id }, { userId: t.admin.id, role: "ADMIN" }], "مساحة");
  const elsewhere = await makeWorkspace(t.org.id, [{ userId: mate.id }, { userId: t.admin.id, role: "ADMIN" }], "مساحة ثانية");
  const mine = await makeProject(ws.id, "مشروع الربيع");
  const theirs = await makeProject(elsewhere.id, "مشروع بعيد");
  const task = (over: { projectOf?: typeof mine; ws?: typeof ws } & Partial<Parameters<typeof makeTask>[0]> = {}) => {
    const p = over.projectOf ?? mine;
    const { projectOf: _p, ws: space, ...rest } = over;
    return makeTask({ orgId: t.org.id, workspaceId: (space ?? ws).id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: t.owner.id, assigneeId: t.member.id, ...rest });
  };
  return { ...t, mate, ws, elsewhere, mine, theirs, task };
}
type World = Awaited<ReturnType<typeof world>>;

async function makeLink(userId: string, label?: string) {
  await loginAs(userId);
  const res = await call(linksRoute.POST, { body: label === undefined ? {} : { label } });
  expect(res.status, res.text).toBe(201);
  return { token: res.json!["token"] as string, url: res.json!["url"] as string, id: (res.json!["entry"] as { id: string }).id };
}

const feed = (token: string, headers: Record<string, string> = {}) =>
  call(feedRoute.GET, { params: { token: `${token}.ics` }, headers: { "x-forwarded-for": freshIp(), ...headers } });

async function setSwitch(orgId: string, key: "calendarFeed" | "reminders" | "milestones", on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

describe("«اشتراك التقويم»: making a link", () => {
  it("shows the token ONCE and keeps only its SHA-256", async () => {
    const w = await world();
    const { token, url, id } = await makeLink(w.member.id, "جوالي");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
    expect(url).toBe(`${appUrl()}/api/calendar/feed/${token}.ics`);

    const row = await db.calendarFeedToken.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).toBe(sha256(token));
    expect(row).toMatchObject({ orgId: w.org.id, userId: w.member.id, label: "جوالي", revokedAt: null, lastUsedAt: null });
    expect(JSON.stringify(row)).not.toContain(token);
    // no other column of the table, and nothing in the audit trail, holds the plain token
    const raw = await db.$queryRawUnsafe<unknown[]>(`SELECT * FROM "CalendarFeedToken" WHERE id = $1`, id);
    expect(JSON.stringify(raw)).not.toContain(token);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { orgId: w.org.id } }))).not.toContain(token);

    // the list names the link but never carries the token or the address
    const list = await call(linksRoute.GET);
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(token);
    expect(list.json!["tokens"]).toEqual([{ id, label: "جوالي", createdAt: row.createdAt.toISOString(), lastUsedAt: null, stale: false }]);
    expect(list.headers.get("cache-control")).toBe("no-store");
  });

  it("makes a different token every time, and gives an unnamed link a default label", async () => {
    const w = await world();
    const a = await makeLink(w.member.id);
    const b = await makeLink(w.member.id, "  ");
    expect(a.token).not.toBe(b.token);
    expect((await db.calendarFeedToken.findUniqueOrThrow({ where: { id: a.id } })).label).toBe("تقويمي");
  });

  it("allows five live links; a revoked one frees its place", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const made: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i++) made.push((await makeLink(w.member.id, `رابط ${i}`)).id);
    const sixth = await call(linksRoute.POST, { body: {} });
    expect(sixth.status).toBe(403);
    expect(sixth.json?.["message"]).toBe("calfeed.too_many");
    expect((await call(linkRoute.DELETE, { method: "DELETE", params: { id: made[0]! } })).status).toBe(200);
    expect((await call(linksRoute.POST, { body: {} })).status).toBe(201);
  });

  it("refuses an over-long label, a guest, and nobody signed in", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const long = await call(linksRoute.POST, { body: { label: "ا".repeat(61) } });
    expect(long.status).toBe(422);
    expect(JSON.stringify(long.json)).toContain("calfeed.label_long");

    await loginAs(w.guest.id);
    const guest = await call(linksRoute.POST, { body: {} });
    expect(guest.status).toBe(403);
    expect(guest.json?.["message"]).toBe("calfeed.guest");
    expect((await call(linksRoute.GET)).status).toBe(403);

    logout();
    expect((await call(linksRoute.POST, { body: {} })).status).toBe(401);
    expect((await call(linksRoute.GET)).status).toBe(401);
  });

  it("only the person revokes their own link; somebody else's is «not found» and stays alive", async () => {
    const w = await world();
    const mine = await makeLink(w.member.id);
    await loginAs(w.mate.id);
    const other = await call(linkRoute.DELETE, { method: "DELETE", params: { id: mine.id } });
    expect(other.status).toBe(404);
    expect(other.json?.["message"]).toBe("calfeed.not_found");
    expect((await feed(mine.token)).status).toBe(200);
    // and the list of the other person never shows it
    expect((await call(linksRoute.GET)).json!["tokens"]).toEqual([]);
  });

  it("the company's switch off: the session routes answer 404 (features.off), and a link made before stays alive for later", async () => {
    const w = await world();
    const link = await makeLink(w.member.id);
    await setSwitch(w.org.id, "calendarFeed", false);
    await loginAs(w.member.id);
    for (const res of [await call(linksRoute.GET), await call(linksRoute.POST, { body: {} })]) {
      expect(res.status).toBe(404);
      expect(res.json?.["message"]).toBe("features.off");
    }
    expect((await feed(link.token)).status).toBe(404);
    await setSwitch(w.org.id, "calendarFeed", true);
    expect((await feed(link.token)).status).toBe(200);
  });
});

describe("«اشتراك التقويم»: what the feed holds", () => {
  it("answers as a private calendar file: text/calendar, CRLF, no cookie, an ETag", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const res = await feed(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(res.text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(res.text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(unfold(res.text)).toContain("X-WR-CALNAME:ذكي — شغلي\r\n");
    expect(res.text).toContain("X-WR-TIMEZONE:Asia/Damascus\r\n");
  });

  it("holds the person's open tasks with a due day: a day as VALUE=DATE, a time as UTC, and a co-assigned one too", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const day = await w.task({ title: "اكتب العرض", dueDate: dueDay(10) });
    const at = new Date(Date.now() + 20 * DAY);
    at.setUTCHours(6, 30, 0, 0); // 09:30 in Damascus: not noon, so a time
    const timed = await w.task({ title: "اجتماع العميل", dueDate: at });
    const co = await w.task({ title: "مهمة مشتركة", assigneeId: w.mate.id, dueDate: dueDay(12) });
    await db.taskCoAssignee.create({ data: { taskId: co.id, userId: w.member.id } });

    const text = unfold((await feed(token)).text);
    expect(text).toContain(`UID:task-${day.id}@${HOST()}\r\n`);
    expect(text).toContain("SUMMARY:اكتب العرض\r\n");
    const expectedDay = dayOfInstant(dueDay(10), ZONE).replace(/-/g, "");
    expect(text).toContain(`DTSTART;VALUE=DATE:${expectedDay}\r\n`);
    expect(text).toContain(`UID:task-${timed.id}@${HOST()}\r\n`);
    expect(text).toMatch(/DTSTART:\d{8}T063000Z\r\n/);
    expect(text).toContain(`UID:task-${co.id}@${HOST()}\r\n`);
    // no alarm for a task: only reminders ring
    expect(text).not.toContain("VALARM");
  });

  it("links back to the item and names the project, but never carries the task's description (nor anything of a price)", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const t = await w.task({ title: "اتصل بالمورّد", dueDate: dueDay(5) });
    await db.task.update({ where: { id: t.id }, data: { description: "السعر 4500 دينار، رقم الزبون 0799123456 — سرّي" } });

    const body = await feed(token);
    const text = unfold(body.text);
    expect(text).toContain("DESCRIPTION:المشروع: مشروع الربيع\\n" + `${appUrl()}/tasks/${t.id}\r\n`);
    expect(text).toContain(`URL:${appUrl()}/tasks/${t.id}\r\n`);
    for (const secret of ["4500", "0799123456", "سرّي", "السعر"]) expect(body.text, secret).not.toContain(secret);
  });

  it("holds only what is the person's: not a colleague's task, not an unassigned one, not a done, archived, undated or out-of-window one", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const ok = await w.task({ title: "داخل", dueDate: dueDay(3) });
    const hidden = {
      colleague: await w.task({ title: "للزميل", assigneeId: w.mate.id, dueDate: dueDay(3) }),
      unassigned: await w.task({ title: "بلا أحد", assigneeId: null, dueDate: dueDay(3) }),
      done: await w.task({ title: "منتهية", dueDate: dueDay(3), completedAt: new Date() }),
      undated: await w.task({ title: "بلا موعد", dueDate: null }),
      tooOld: await w.task({ title: "قديمة", dueDate: dueDay(-45) }),
      tooFar: await w.task({ title: "بعيدة", dueDate: dueDay(400) }),
    };
    const archived = await w.task({ title: "مؤرشفة", dueDate: dueDay(3) });
    await db.task.update({ where: { id: archived.id }, data: { archived: true } });

    const text = unfold((await feed(token)).text);
    expect(text).toContain(`UID:task-${ok.id}@`);
    for (const [name, t] of Object.entries(hidden)) expect(text, name).not.toContain(`task-${t.id}@`);
    expect(text).not.toContain(`task-${archived.id}@`);
  });

  it("nothing of another person: a colleague's link shows the colleague's tasks and none of mine", async () => {
    const w = await world();
    const mine = await w.task({ title: "عملي", dueDate: dueDay(3) });
    const theirs = await w.task({ title: "عمله", assigneeId: w.mate.id, dueDate: dueDay(4) });
    const mate = await makeLink(w.mate.id);
    const text = unfold((await feed(mate.token)).text);
    expect(text).toContain(`task-${theirs.id}@`);
    expect(text).not.toContain(`task-${mine.id}@`);
  });

  it("nothing from a space the person is not in, and the item disappears the moment they lose the space", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const inside = await w.task({ title: "في مساحتي", dueDate: dueDay(3) });
    // assigned to the member but sitting in a space the member is not in
    const outside = await w.task({ title: "في مساحة غيري", ws: w.elsewhere, projectOf: w.theirs, dueDate: dueDay(3) });
    let text = unfold((await feed(token)).text);
    expect(text).toContain(`task-${inside.id}@`);
    expect(text).not.toContain(`task-${outside.id}@`);

    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.member.id } } });
    text = unfold((await feed(token)).text);
    expect(text).not.toContain(`task-${inside.id}@`);
  });

  it("respects teams inside a space: a project of a team the person is not in shows nothing, one of their own team does", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const x = await db.team.create({ data: { workspaceId: w.ws.id, name: "فريق س", members: { create: [{ userId: w.member.id }] } } });
    const y = await db.team.create({ data: { workspaceId: w.ws.id, name: "فريق ص", members: { create: [{ userId: w.mate.id }] } } });
    const px = await makeProject(w.ws.id, "مشروع س");
    const py = await makeProject(w.ws.id, "مشروع ص");
    await db.project.update({ where: { id: px.project.id }, data: { teamId: x.id } });
    await db.project.update({ where: { id: py.project.id }, data: { teamId: y.id } });
    const own = await w.task({ title: "فريقي", projectOf: px, dueDate: dueDay(3) });
    const foreign = await w.task({ title: "فريق غيري", projectOf: py, dueDate: dueDay(3) });
    const text = unfold((await feed(token)).text);
    expect(text).toContain(`task-${own.id}@`);
    expect(text).not.toContain(`task-${foreign.id}@`);
  });

  it("holds the person's pending reminders with ONE alarm each; fired, dismissed, a colleague's and one on a task they can no longer read are left out", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const soon = new Date(Date.now() + 2 * DAY);
    const seenTask = await w.task({ title: "مهمة التذكير", dueDate: dueDay(30) });
    const lostTask = await w.task({ title: "مهمة غابت", ws: w.elsewhere, projectOf: w.theirs, assigneeId: w.mate.id });
    const mk = (over: Partial<Prisma.ReminderUncheckedCreateInput>) => db.reminder.create({ data: { orgId: w.org.id, userId: w.member.id, title: "تذكير", dueAt: soon, ...over } });
    const pending = await mk({ title: "اتصل بالمورّد, قبل الظهر" });
    const onTask = await mk({ title: "راجع المهمة", taskId: seenTask.id });
    const fired = await mk({ title: "انطلق", status: "FIRED", firedAt: new Date() });
    const dismissed = await mk({ title: "انتهى", status: "DISMISSED" });
    const colleagues = await mk({ title: "تذكير الزميل", userId: w.mate.id });
    const lost = await mk({ title: "على مهمة غابت", taskId: lostTask.id });

    const res = await feed(token);
    const text = unfold(res.text);
    expect(text).toContain(`UID:reminder-${pending.id}@${HOST()}\r\n`);
    expect(text).toContain("SUMMARY:تذكير: اتصل بالمورّد\\, قبل الظهر\r\n");
    expect(text).toContain(`UID:reminder-${onTask.id}@`);
    expect(text).toContain(`URL:${appUrl()}/tasks/${seenTask.id}\r\n`);
    for (const r of [fired, dismissed, colleagues, lost]) expect(text, r.title).not.toContain(`reminder-${r.id}@`);
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(text).toMatch(/TRIGGER:PT0M\r\nEND:VALARM/);
  });

  it("reminders and milestones follow their own switches", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const r = await db.reminder.create({ data: { orgId: w.org.id, userId: w.member.id, title: "تذكير", dueAt: new Date(Date.now() + DAY) } });
    const m = await db.milestone.create({ data: { projectId: w.mine.project.id, name: "تسليم النسخة", targetDate: dueDay(15) } });
    let text = unfold((await feed(token)).text);
    expect(text).toContain(`reminder-${r.id}@`);
    expect(text).toContain(`milestone-${m.id}@`);
    await setSwitch(w.org.id, "reminders", false);
    await setSwitch(w.org.id, "milestones", false);
    text = unfold((await feed(token)).text);
    expect(text).not.toContain(`reminder-${r.id}@`);
    expect(text).not.toContain(`milestone-${m.id}@`);
  });

  it("holds open milestones of the projects the person can see, as an all-day event with the project and a link; not completed ones, not another space's or another team's", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const open = await db.milestone.create({ data: { projectId: w.mine.project.id, name: "تسليم النسخة الأولى", description: "تفاصيل خاصة بالعميل", targetDate: dueDay(15) } });
    const done = await db.milestone.create({ data: { projectId: w.mine.project.id, name: "منجز", status: "COMPLETED", targetDate: dueDay(16) } });
    const far = await db.milestone.create({ data: { projectId: w.theirs.project.id, name: "في مساحة بعيدة", targetDate: dueDay(17) } });
    const y = await db.team.create({ data: { workspaceId: w.ws.id, name: "فريق ص", members: { create: [{ userId: w.mate.id }] } } });
    const py = await makeProject(w.ws.id, "مشروع ص");
    await db.project.update({ where: { id: py.project.id }, data: { teamId: y.id } });
    const teamed = await db.milestone.create({ data: { projectId: py.project.id, name: "فريق غيري", targetDate: dueDay(18) } });

    const body = await feed(token);
    const text = unfold(body.text);
    expect(text).toContain(`UID:milestone-${open.id}@${HOST()}\r\n`);
    expect(text).toContain("SUMMARY:معلم: تسليم النسخة الأولى\r\n");
    expect(text).toContain("DESCRIPTION:المشروع: مشروع الربيع\\n" + `${appUrl()}/projects/${w.mine.project.id}\r\n`);
    expect(body.text).not.toContain("تفاصيل خاصة بالعميل"); // the milestone's own description never leaves
    for (const m of [done, far, teamed]) expect(text, m.name).not.toContain(`milestone-${m.id}@`);
  });
});

describe("«اشتراك التقويم»: who may read, and when it stops", () => {
  const denied = async (token: string) => {
    const res = await feed(token);
    expect(res.status).toBe(404);
    expect(res.text).toBe(""); // no detail, whatever the reason
    expect(res.headers.get("content-type") ?? "").not.toContain("json");
    expect(res.headers.get("set-cookie")).toBeNull();
  };

  it("an unknown or malformed link is the same empty 404", async () => {
    await denied("A".repeat(43));
    await denied("short");
    await denied("../../etc/passwd");
    await denied("%E0%A4%A"); // a broken percent-escape
  });

  it("a revoked link stops at once", async () => {
    const w = await world();
    const link = await makeLink(w.member.id);
    expect((await feed(link.token)).status).toBe(200);
    expect((await call(linkRoute.DELETE, { method: "DELETE", params: { id: link.id } })).status).toBe(200);
    await denied(link.token);
    // revoking it leaves the row (history) with its time, and the list stops offering it
    expect((await db.calendarFeedToken.findUniqueOrThrow({ where: { id: link.id } })).revokedAt).not.toBeNull();
    expect((await call(linksRoute.GET)).json!["tokens"]).toEqual([]);
  });

  it("a suspended or offboarded person gets 404, and is served again when ACTIVE", async () => {
    const w = await world();
    const link = await makeLink(w.member.id);
    for (const status of ["SUSPENDED", "OFFBOARDED"] as const) {
      await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } }, data: { status } });
      await denied(link.token);
    }
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } }, data: { status: "ACTIVE" } });
    expect((await feed(link.token)).status).toBe(200);
  });

  it("a guest (an external partner) gets 404 even with a link written by hand", async () => {
    const w = await world();
    const token = "G".repeat(43);
    await db.calendarFeedToken.create({ data: { orgId: w.org.id, userId: w.guest.id, tokenHash: sha256(token), label: "ضيف", sessionVersion: w.guest.tokenVersion } });
    await denied(token);
    // and a member demoted to a guest after making the link
    const link = await makeLink(w.member.id);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } }, data: { role: "GUEST" } });
    await denied(link.token);
  });

  it("a change of the session version (suspend, reset, «log out everywhere») kills the link, and the list says it stopped", async () => {
    const w = await world();
    const link = await makeLink(w.member.id);
    expect((await feed(link.token)).status).toBe(200);
    await db.user.update({ where: { id: w.member.id }, data: { tokenVersion: { increment: 1 } } });
    await denied(link.token);
    await loginAs(w.member.id);
    const list = await call(linksRoute.GET);
    expect((list.json!["tokens"] as { stale: boolean }[])[0]!.stale).toBe(true);
    // a link made after the change works
    const fresh = await makeLink(w.member.id);
    expect((await feed(fresh.token)).status).toBe(200);
  });

  it("the company's switch off: 404 for every link", async () => {
    const w = await world();
    const link = await makeLink(w.member.id);
    await setSwitch(w.org.id, "calendarFeed", false);
    await denied(link.token);
  });

  it("a link of one company never reads another's: the token is bound to its organization", async () => {
    const w = await world();
    const other = await makeTeam();
    const link = await makeLink(w.member.id);
    // pointing the row at a company the person is not in leaves nothing to serve
    await db.calendarFeedToken.update({ where: { id: link.id }, data: { orgId: other.org.id } });
    await denied(link.token);
  });

  it("records when a link was last used, and the list shows it", async () => {
    const w = await world();
    const link = await makeLink(w.member.id);
    expect((await db.calendarFeedToken.findUniqueOrThrow({ where: { id: link.id } })).lastUsedAt).toBeNull();
    await feed(link.token);
    const row = await db.calendarFeedToken.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.lastUsedAt).not.toBeNull();
    await loginAs(w.member.id);
    const listed = (await call(linksRoute.GET)).json!["tokens"] as { lastUsedAt: string | null }[];
    expect(listed[0]!.lastUsedAt).toBe(row.lastUsedAt!.toISOString());
  });
});

describe("«اشتراك التقويم»: ETag and 304", () => {
  it("answers 304 to an unchanged feed and a fresh 200 after the person's work changed", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const t = await w.task({ title: "قبل", dueDate: dueDay(5) });
    const first = await feed(token);
    const etag = first.headers.get("etag")!;
    const again = await feed(token, { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe("private, max-age=300");

    await db.task.update({ where: { id: t.id }, data: { title: "بعد" } });
    const changed = await feed(token, { "if-none-match": etag });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    expect(unfold(changed.text)).toContain("SUMMARY:بعد\r\n");
  });

  it("a person who lost access is never answered 304: the checks run before the validator", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const etag = (await feed(token)).headers.get("etag")!;
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } }, data: { status: "SUSPENDED" } });
    expect((await feed(token, { "if-none-match": etag })).status).toBe(404);
  });
});

describe("«اشتراك التقويم»: limits", () => {
  it("one link is limited by itself (429 + Retry-After), and another link is not affected", async () => {
    const w = await world();
    const a = await makeLink(w.member.id);
    const b = await makeLink(w.mate.id);
    for (let i = 0; i < FEED_LIMITS.perToken.limit; i++) expect((await feed(a.token)).status, `request ${i + 1}`).toBe(200);
    const limited = await feed(a.token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.text).toBe("");
    expect((await feed(b.token)).status).toBe(200);
  });

  it("an unknown link is limited too (the count is by what the address says, not by what exists)", async () => {
    const guess = "Z".repeat(43);
    for (let i = 0; i < FEED_LIMITS.perToken.limit; i++) expect((await feed(guess)).status).toBe(404);
    expect((await feed(guess)).status).toBe(429);
  });

  it("one address is limited across links, and another address is not", async () => {
    const w = await world();
    const { token } = await makeLink(w.member.id);
    const ip = "203.0.113.9";
    for (let i = 0; i < FEED_LIMITS.perIp.limit; i++) {
      const res = await call(feedRoute.GET, { params: { token: `${"x".repeat(40)}${String(i).padStart(3, "0")}.ics` }, headers: { "x-forwarded-for": ip } });
      expect(res.status).toBe(404);
    }
    const blocked = await call(feedRoute.GET, { params: { token: `${token}.ics` }, headers: { "x-forwarded-for": ip } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await call(feedRoute.GET, { params: { token: `${token}.ics` }, headers: { "x-forwarded-for": "203.0.113.10" } })).status).toBe(200);
  });
});

describe("«اشتراك التقويم»: the window and the cap", () => {
  const NOW = new Date("2031-06-15T09:00:00.000Z");

  it("holds 30 days back to 365 days ahead and nothing outside", async () => {
    const w = await world();
    const make = (title: string, days: number) => w.task({ title, dueDate: dueDay(days, NOW) });
    const inside = [await make("قبل 29 يوماً", -29), await make("بعد 364 يوماً", 364), await make("اليوم", 0)];
    const outside = [await make("قبل 31 يوماً", -31), await make("بعد 366 يوماً", 366)];
    const text = unfold(await buildFeedFor({ userId: w.member.id, orgId: w.org.id }, { now: NOW }));
    for (const t of inside) expect(text, t.title).toContain(`task-${t.id}@`);
    for (const t of outside) expect(text, t.title).not.toContain(`task-${t.id}@`);
  });

  it("never holds more than the cap, keeping the soonest", async () => {
    const w = await world();
    const made = [];
    for (let i = 1; i <= 6; i++) made.push(await w.task({ title: `مهمة ${i}`, dueDate: dueDay(i, NOW) }));
    await db.reminder.create({ data: { orgId: w.org.id, userId: w.member.id, title: "تذكير بعيد", dueAt: new Date(NOW.getTime() + 100 * DAY) } });
    const text = unfold(await buildFeedFor({ userId: w.member.id, orgId: w.org.id }, { now: NOW, maxEvents: 4 }));
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    for (const t of made.slice(0, 4)) expect(text, t.title).toContain(`task-${t.id}@`);
    for (const t of made.slice(4)) expect(text, t.title).not.toContain(`task-${t.id}@`);
    expect(text).not.toContain("تذكير بعيد");
  });

  it("an empty week is still a valid calendar", async () => {
    const w = await world();
    const text = await buildFeedFor({ userId: w.member.id, orgId: w.org.id }, { now: NOW });
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).not.toContain("BEGIN:VEVENT");
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
