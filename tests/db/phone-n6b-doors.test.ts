import { describe, expect, it } from "vitest";
import { GET as calendarGET } from "@/app/api/calendar/route";
import { GET as peopleGET } from "@/app/api/people/route";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * The phone's two new read-only doors (M2 N6, batch 2): «التقويم» (`GET /api/calendar`) reads the very `calendarScreenFor` the calendar page reads, and
 * the staff directory (`GET /api/people`) the very `staffDirectory` of the page «الفريق». Proven against a real database: a task of a space the person
 * is not in never shows, «مهامي فقط» narrows, the month is the asked one; the directory lists ACTIVE people only and refuses a partner or a person whose
 * `directory.view` was switched off.
 */

/** The company's month of an instant, "YYYY-MM" (the test's tasks sit mid-month, far from any zone's edge). */
const monthOf = (d: Date) => d.toISOString().slice(0, 7);
function midMonth(offset = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 15, 9, 0, 0));
}

async function world() {
  const t = await makeTeam();
  const outsider = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Outsider" });
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.admin.id, role: "ADMIN" },
    { userId: t.member.id, role: "MEMBER" },
    { userId: t.guest.id, role: "GUEST" },
  ]);
  const other = await makeWorkspace(t.org.id, [{ userId: outsider.id, role: "MEMBER" }]);
  const p = await makeProject(ws.id);
  const q = await makeProject(other.id);
  const base = { orgId: t.org.id, workspaceId: ws.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: t.member.id };
  const mineTask = await makeTask({ ...base, assigneeId: t.member.id, title: "Mine this month", dueDate: midMonth() });
  const adminTask = await makeTask({ ...base, assigneeId: t.admin.id, title: "Admin this month", dueDate: midMonth() });
  const doneTask = await makeTask({ ...base, assigneeId: t.member.id, title: "Done this month", dueDate: midMonth(), completedAt: new Date() });
  const nextTask = await makeTask({ ...base, assigneeId: t.member.id, title: "Next month", dueDate: midMonth(1) });
  const foreign = await makeTask({ orgId: t.org.id, workspaceId: other.id, projectId: q.project.id, boardId: q.board.id, columnId: q.todo.id, creatorId: outsider.id, assigneeId: outsider.id, title: "Other space", dueDate: midMonth() });
  return { ...t, outsider, ws, other, mineTask, adminTask, doneTask, nextTask, foreign };
}

type Cal = { space: { id: string; name: string } | null; month: string; todayIso: string; timeZone: string; editable: boolean; mine: boolean; tasks: { id: string; key: string; title: string; dueDate: string }[] };
const calendarOf = (query = "") => call(calendarGET, { url: `http://localhost/api/calendar${query}` });

describe("GET /api/calendar — «التقويم» of the space the person is in", () => {
  it("a member reads the open tasks due this month in their space, never a done one or one of another space", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await calendarOf();
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const body = r.json as Cal;
    expect(body.space?.id).toBe(w.ws.id);
    expect(body.month).toBe(monthOf(midMonth()));
    expect(body.editable).toBe(true);
    const ids = body.tasks.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([w.mineTask.id, w.adminTask.id]));
    expect(ids).not.toContain(w.doneTask.id);
    expect(ids).not.toContain(w.nextTask.id);
    expect(ids).not.toContain(w.foreign.id);
    expect(body.tasks.find((x) => x.id === w.mineTask.id)).toMatchObject({ title: "Mine this month", dueDate: midMonth().toISOString() });
  });

  it("«مهامي فقط» keeps only the person's own tasks, and another month is read when asked", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const mine = (await calendarOf("?mine=1")).json as Cal;
    expect(mine.mine).toBe(true);
    expect(mine.tasks.map((x) => x.id)).toEqual([w.mineTask.id]);
    const next = (await calendarOf(`?month=${monthOf(midMonth(1))}`)).json as Cal;
    expect(next.month).toBe(monthOf(midMonth(1)));
    expect(next.tasks.map((x) => x.id)).toEqual([w.nextTask.id]);
  });

  it("somebody outside the space never sees its tasks; a malformed month is refused", async () => {
    const w = await world();
    await loginAs(w.outsider.id);
    const body = (await calendarOf()).json as Cal;
    expect(body.tasks.map((x) => x.id)).not.toContain(w.mineTask.id);
    expect(body.tasks.map((x) => x.id)).not.toContain(w.adminTask.id);
    expect((await calendarOf("?month=2026-13-01")).status).toBe(422);
  });

  it("an external partner reads the space they share but may not move a task to another day", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const r = await calendarOf();
    expect(r.status).toBe(200);
    expect((r.json as Cal).editable).toBe(false);
  });
});

type People = { people: { id: string; name: string; jobTitle: string | null; role: string; email: string | null }[] };
const peopleOf = () => call(peopleGET, { url: "http://localhost/api/people" });

describe("GET /api/people — the staff directory", () => {
  it("a member reads the company's ACTIVE people, the owner first; a suspended person is not listed", async () => {
    const w = await world();
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.outsider.id } }, data: { status: "SUSPENDED" } });
    await loginAs(w.member.id);
    const r = await peopleOf();
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const body = r.json as People;
    const ids = body.people.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([w.owner.id, w.admin.id, w.member.id]));
    expect(ids).not.toContain(w.outsider.id);
    expect(body.people[0]?.id).toBe(w.owner.id);
  });

  it("an external partner is refused, and so is a member whose directory.view was switched off", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    expect((await peopleOf()).status).toBe(403);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } }, data: { revokedCapabilities: ["directory.view"] } });
    await loginAs(w.member.id);
    expect((await peopleOf()).status).toBe(403);
  });
});
