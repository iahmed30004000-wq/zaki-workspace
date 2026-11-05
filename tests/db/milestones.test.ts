import { describe, expect, it } from "vitest";
import * as listRoute from "@/app/api/projects/[id]/milestones/route";
import * as oneRoute from "@/app/api/milestones/[id]/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import { withFeature } from "@/lib/features";
import type { Prisma } from "@prisma/client";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";

/**
 * «المعالم» — the milestones of a project (the owner, 2026-10-30: the table, the project page's list and
 * the timeline's diamonds all existed, and nothing in the repository ever created a row).
 *
 * What this pins:
 *  - a milestone is created, read back and edited through the API, with its day read in the COMPANY's
 *    zone (the day the person picked, never the browser's);
 *  - «متأخر» is not stored: it is «still open, and its day has passed», so moving the day clears it;
 *  - the door is the project's space AND its team, then the «projects.edit» box: a guest, a member of
 *    another team and a stranger all get nothing, and no row is written;
 *  - deleting a milestone never deletes a task: the tasks attached keep their place;
 *  - the task's own route attaches and detaches a milestone, and refuses one of another project;
 *  - the company's switch closes both routes and the picker while keeping every stored row.
 */

async function world() {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], "مساحة");
  const made = await makeProject(ws.id, "مشروع");
  return { ...team, ws, made };
}

describe("«المعالم»: creating one", () => {
  it("is stored with the day the person picked, read in the company's zone", async () => {
    const w = await world();
    await loginAs(w.member.id);
    // Keep this fixture in the future: the API derives OVERDUE from the current company day.
    const targetDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const created = await call(listRoute.POST, {
      params: { id: w.made.project.id },
      body: { name: "تسليم النسخة الأولى", targetDate },
    });
    expect(created.status).toBe(201);
    const m = (created.json as { milestone: { id: string; name: string; status: string; targetDate: string } }).milestone;
    expect(m.name).toBe("تسليم النسخة الأولى");
    expect(m.status).toBe("OPEN");
    // stored as noon of that day; the DAY is what matters and it must not shift
    const row = await db.milestone.findUniqueOrThrow({ where: { id: m.id }, select: { targetDate: true } });
    expect(row.targetDate?.toISOString().slice(0, 10)).toBe(targetDate);

    const list = await call(listRoute.GET, { params: { id: w.made.project.id } });
    expect(list.status).toBe(200);
    expect((list.json as { milestones: { id: string }[] }).milestones.map((x) => x.id)).toEqual([m.id]);
  });

  it("needs a name: an empty one is refused and nothing is written", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await call(listRoute.POST, { params: { id: w.made.project.id }, body: { name: "   " } });
    expect(res.status).toBe(422);
    expect(await db.milestone.count({ where: { projectId: w.made.project.id } })).toBe(0);
  });
});

describe("«المعالم»: who may write", () => {
  it("a guest of the space creates nothing", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.guest.id } });
    await loginAs(w.guest.id);
    const res = await call(listRoute.POST, {
      params: { id: w.made.project.id },
      body: { name: "معلم الضيف" },
    });
    expect(res.status).toBe(403);
    expect(await db.milestone.count({ where: { projectId: w.made.project.id } })).toBe(0);
  });

  it("somebody who is not in the space is refused, and reads none of its milestones", async () => {
    const other = await makeTeam();
    const w = await world();
    await db.milestone.create({ data: { projectId: w.made.project.id, name: "معلم داخلي" } });
    await loginAs(other.member.id);
    const res = await call(listRoute.GET, { params: { id: w.made.project.id } });
    // the space guard answers 403 (`not_workspace_member`), the same door every project route has
    expect(res.status).toBe(403);
    expect(res.json?.["milestones"]).toBeUndefined();
  });
});

describe("«المعالم»: late is a reading, not a stored status", () => {
  it("an open milestone whose day has passed reads «متأخر», and moving the day clears it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    // a day in the past, stored directly: the API would accept it too (a plan can be written after the fact)
    const row = await db.milestone.create({
      data: { projectId: w.made.project.id, name: "فات تاريخه", targetDate: new Date("2020-01-01T10:00:00.000Z") },
    });
    const list = await call(listRoute.GET, { params: { id: w.made.project.id } });
    const mine = (list.json as { milestones: { id: string; status: string; overdue: boolean }[] }).milestones.find(
      (m) => m.id === row.id,
    );
    expect(mine?.status).toBe("OVERDUE");
    expect(mine?.overdue).toBe(true);
    // nothing was written to say so
    const stored = await db.milestone.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } });
    expect(stored.status).toBe("OPEN");

    const far = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const patched = await call(oneRoute.PATCH, { params: { id: row.id }, body: { targetDate: far } });
    expect(patched.status).toBe(200);
    expect((patched.json as { milestone: { status: string } }).milestone.status).toBe("OPEN");
  });

  it("a completed milestone is never late, whatever its day says", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const row = await db.milestone.create({
      data: { projectId: w.made.project.id, name: "خلص", targetDate: new Date("2020-01-01T10:00:00.000Z") },
    });
    const patched = await call(oneRoute.PATCH, { params: { id: row.id }, body: { status: "COMPLETED" } });
    expect(patched.status).toBe(200);
    expect((patched.json as { milestone: { status: string; overdue: boolean } }).milestone.status).toBe("COMPLETED");
    expect((patched.json as { milestone: { overdue: boolean } }).milestone.overdue).toBe(false);
  });
});

describe("«المعالم»: deleting", () => {
  it("a milestone with open tasks attached is not deleted; detaching them allows it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const created = await call(listRoute.POST, {
      params: { id: w.made.project.id },
      body: { name: "معلم فيه شغل" },
    });
    const milestoneId = (created.json as { milestone: { id: string } }).milestone.id;
    const task = await makeTask({
      orgId: w.org.id,
      workspaceId: w.ws.id,
      projectId: w.made.project.id,
      boardId: w.made.board.id,
      columnId: w.made.todo.id,
      creatorId: w.owner.id,
      title: "مهمة على المعلم",
    });
    const attached = await call(taskRoute.PATCH, { params: { id: task.id }, body: { milestoneId } });
    expect(attached.status).toBe(200);

    const refused = await call(oneRoute.DELETE, { params: { id: milestoneId } });
    expect(refused.status).toBe(403);
    expect(await db.milestone.count({ where: { id: milestoneId } })).toBe(1);

    const detached = await call(taskRoute.PATCH, { params: { id: task.id }, body: { milestoneId: null } });
    expect(detached.status).toBe(200);
    const removed = await call(oneRoute.DELETE, { params: { id: milestoneId } });
    expect(removed.status).toBe(200);
    // the task is still there: a milestone is a date, not the work
    expect(await db.task.count({ where: { id: task.id } })).toBe(1);
  });
});

describe("«المعالم»: the task's side", () => {
  it("a task may point at a milestone of its own project, never at another project's", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const mine = await db.milestone.create({ data: { projectId: w.made.project.id, name: "معلمي" } });
    const otherProject = await makeProject(w.ws.id, "مشروع تاني");
    const theirs = await db.milestone.create({ data: { projectId: otherProject.project.id, name: "معلم غيري" } });
    const task = await makeTask({
      orgId: w.org.id,
      workspaceId: w.ws.id,
      projectId: w.made.project.id,
      boardId: w.made.board.id,
      columnId: w.made.todo.id,
      creatorId: w.owner.id,
      title: "مهمة",
    });

    const ok = await call(taskRoute.PATCH, { params: { id: task.id }, body: { milestoneId: mine.id } });
    expect(ok.status).toBe(200);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { milestoneId: true } })).toEqual({
      milestoneId: mine.id,
    });

    const wrong = await call(taskRoute.PATCH, { params: { id: task.id }, body: { milestoneId: theirs.id } });
    expect(wrong.status).toBe(403);
    expect(wrong.json?.["message"]).toBe("milestone.invalid");
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { milestoneId: true } })).toEqual({
      milestoneId: mine.id,
    });
  });
});

describe("«المعالم»: the switch", () => {
  it("off: both routes answer 404 and the stored milestones survive", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const created = await call(listRoute.POST, {
      params: { id: w.made.project.id },
      body: { name: "معلم محفوظ" },
    });
    const milestoneId = (created.json as { milestone: { id: string } }).milestone.id;

    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await db.organization.update({
      where: { id: w.org.id },
      data: { settings: withFeature(org.settings, "milestones", false) as Prisma.InputJsonValue },
    });

    const read = await call(listRoute.GET, { params: { id: w.made.project.id } });
    expect(read.status).toBe(404);
    expect(read.json?.["message"]).toBe("features.off");
    const write = await call(listRoute.POST, { params: { id: w.made.project.id }, body: { name: "جديد" } });
    expect(write.status).toBe(404);
    expect(await db.milestone.count({ where: { projectId: w.made.project.id } })).toBe(1);

    const back = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await db.organization.update({
      where: { id: w.org.id },
      data: { settings: withFeature(back.settings, "milestones", true) as Prisma.InputJsonValue },
    });
    const again = await call(listRoute.GET, { params: { id: w.made.project.id } });
    expect(again.status).toBe(200);
    expect((again.json as { milestones: { id: string }[] }).milestones.map((m) => m.id)).toEqual([milestoneId]);
  });
});
