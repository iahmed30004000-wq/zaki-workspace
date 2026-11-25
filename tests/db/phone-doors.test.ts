import { describe, expect, it } from "vitest";
import { GET as sheetGET } from "@/app/api/tasks/[id]/sheet/route";
import { GET as todayGET } from "@/app/api/today/route";
import { GET as myWorkGET } from "@/app/api/my-work/route";
import { call, db, loginAs, makeOrg, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { todayNoon } from "./today-helpers";

/**
 * The phone's three read-only doors (M2 N2): «اليوم», «مهامي» and one task's sheet. They read the very services the site's pages read,
 * so the rules are the pages' rules — proven here against a real database: a person outside the space gets nothing, a partner never
 * edits and never sees a reward, «طلب» marks exactly the people above the viewer, and nothing of the server's own bookkeeping leaves.
 */

async function world() {
  const t = await makeTeam();
  const outsider = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Outsider" });
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.admin.id, role: "ADMIN" },
    { userId: t.member.id, role: "MEMBER" },
    { userId: t.guest.id, role: "GUEST" },
  ]);
  const p = await makeProject(ws.id);
  const task = await makeTask({
    orgId: t.org.id,
    workspaceId: ws.id,
    projectId: p.project.id,
    boardId: p.board.id,
    columnId: p.todo.id,
    creatorId: t.member.id,
    assigneeId: t.member.id,
    title: "Phone door task",
    // «due today» as a whole day (noon, no hour): an hour of «now» is late a moment later
    dueDate: todayNoon("Asia/Damascus"),
  });
  return { ...t, outsider, ws, ...p, task };
}

const sheetOf = (id: string) => call(sheetGET, { params: { id }, url: `http://localhost/api/tasks/${id}/sheet` });

describe("GET /api/tasks/[id]/sheet — one task as its page shows it", () => {
  it("a member of the space reads it, may edit it, and gets the board's columns in order", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await sheetOf(w.task.id);
    expect(r.status).toBe(200);
    const sheet = r.json as Record<string, any>;
    expect(sheet.task.title).toBe("Phone door task");
    expect(sheet.task.key).toBe(`${w.org.keyPrefix}-${w.task.number}`);
    expect(sheet.canEdit).toBe(true);
    expect(sheet.columns.map((c: { id: string }) => c.id)).toEqual([w.todo.id, w.done.id]);
    expect(sheet.viewerId).toBe(w.member.id);
    // the steps card exists while its switch is on (on by default)
    expect(sheet.steps).not.toBeNull();
    // the server's own bookkeeping never leaves
    expect(sheet).not.toHaveProperty("internal");
  });

  it("«طلب» marks exactly the people of a higher rank than the viewer", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const sheet = (await sheetOf(w.task.id)).json as { members: { id: string; request: boolean }[] };
    const flag = Object.fromEntries(sheet.members.map((m) => [m.id, m.request]));
    expect(flag[w.admin.id]).toBe(true);
    expect(flag[w.member.id]).toBe(false);
    // the outsider is not in the space: never offered
    expect(flag).not.toHaveProperty(w.outsider.id);
  });

  it("somebody outside the space, or of another company, gets «not found»", async () => {
    const w = await world();
    await loginAs(w.outsider.id);
    expect((await sheetOf(w.task.id)).status).toBe(404);
    const other = await makeOrg();
    const stranger = await makeUser({ orgId: other.id, role: "OWNER" });
    await loginAs(stranger.id);
    expect((await sheetOf(w.task.id)).status).toBe(404);
  });

  it("a partner in the space reads it but never edits it, and is handed no reward", async () => {
    const w = await world();
    await db.task.update({ where: { id: w.task.id }, data: { rewardStatus: "OPEN", rewardAmountMinor: 5000, rewardCurrency: "JOD" } });
    await loginAs(w.guest.id);
    const r = await sheetOf(w.task.id);
    expect(r.status).toBe(200);
    const sheet = r.json as Record<string, any>;
    expect(sheet.canEdit).toBe(false);
    expect(sheet.reward).toBeNull();
    expect(sheet.lens.rewards).toBe(false);
    expect(JSON.stringify(sheet)).not.toContain("5000");
  });
});

describe("GET /api/my-work — «مهامي» as the page reads it", () => {
  it("the assignee finds their task due today, with every tab's count", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await call(myWorkGET, { url: "http://localhost/api/my-work?tab=today" });
    expect(r.status).toBe(200);
    const data = r.json as { tab: string; rows: { task: { id: string } }[]; counts: Record<string, number> };
    expect(data.tab).toBe("today");
    expect(data.rows.map((x) => x.task.id)).toContain(w.task.id);
    expect(data.counts.today).toBeGreaterThanOrEqual(1);
    expect(Object.keys(data.counts).sort()).toEqual(["completed", "created", "mine", "overdue", "today", "upcoming"]);
  });

  it("an unknown tab falls back to «اليوم», and somebody outside the space sees none of it", async () => {
    const w = await world();
    await loginAs(w.outsider.id);
    const r = await call(myWorkGET, { url: "http://localhost/api/my-work?tab=nope" });
    expect(r.status).toBe(200);
    const data = r.json as { tab: string; rows: { task: { id: string } }[] };
    expect(data.tab).toBe("today");
    expect(data.rows.map((x) => x.task.id)).not.toContain(w.task.id);
  });
});

describe("GET /api/today — «اليوم» as the page reads it", () => {
  it("the assignee's day carries their task, and the mission card points at it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await call(todayGET, { url: "http://localhost/api/today" });
    expect(r.status).toBe(200);
    const data = r.json as Record<string, any>;
    const ids = [...data.today.tasks.overdue, ...data.today.tasks.today].map((t: { id: string }) => t.id);
    expect(ids).toContain(w.task.id);
    expect(data.mission?.id).toBe(w.task.id);
    expect(data.cards).toHaveProperty("reminders");
  });

  it("a partner gets the partner's day: no dashboard, no time, no check-in", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const r = await call(todayGET, { url: "http://localhost/api/today" });
    expect(r.status).toBe(200);
    const data = r.json as Record<string, any>;
    expect(data.dashboard).toBeNull();
    expect(data.cards.time).toBe(false);
    expect(data.cards.checkins).toBe(false);
  });

  it("nobody signed in gets nothing", async () => {
    const { logout } = await import("./helpers");
    logout();
    expect((await call(todayGET, { url: "http://localhost/api/today" })).status).toBe(401);
    expect((await call(myWorkGET, { url: "http://localhost/api/my-work" })).status).toBe(401);
  });
});
