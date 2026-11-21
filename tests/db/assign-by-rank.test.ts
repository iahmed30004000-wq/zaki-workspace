import { afterEach, describe, expect, it } from "vitest";
import * as taskRoute from "@/app/api/tasks/route";
import * as taskIdRoute from "@/app/api/tasks/[id]/route";
import * as acceptRoute from "@/app/api/tasks/[id]/request/accept/route";
import * as returnRoute from "@/app/api/tasks/[id]/request/return/route";
import * as instantRoute from "@/app/api/instant/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { createTask, updateTask } from "@/server/services/tasks";
import { createInstantTask } from "@/server/services/instant-work";
import { answerAssignRequest } from "@/server/services/task-assign";
import { AR } from "@/lib/i18n/dict";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { ctxOf, suspend } from "./active-helpers";

/**
 * Who may give a task to whom, by RANK (the owner's decision, 2026-10-30): OWNER > ADMIN > LEAD > MEMBER > GUEST.
 *   - yourself, somebody below you, somebody of your own rank: direct;
 *   - somebody above you: a REQUEST (no assignee, a row, a bell) that the higher person accepts or returns with a reason;
 *   - an external partner (GUEST) gives to nobody and receives from nobody, except inside a space both are members of,
 *     and never asks upward;
 *   - the OWNER gives to anybody directly; everybody else giving to him asks.
 */
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
afterEach(() => jar().delete(SPACE_COOKIE));

async function world() {
  const t = await makeTeam();
  const org = t.org.id;
  const admin2 = await makeUser({ orgId: org, role: "ADMIN", name: "Admin Two" });
  const lead = await makeUser({ orgId: org, role: "LEAD", name: "Lead" });
  const member2 = await makeUser({ orgId: org, role: "MEMBER", name: "Member Two" });
  const guest2 = await makeUser({ orgId: org, role: "GUEST", name: "Guest Two" });
  const outsiderGuest = await makeUser({ orgId: org, role: "GUEST", name: "Guest Outside" });
  const ws = await makeWorkspace(org, [
    { userId: t.admin.id, role: "ADMIN" },
    { userId: admin2.id, role: "ADMIN" },
    { userId: lead.id },
    { userId: t.member.id },
    { userId: member2.id },
    { userId: t.guest.id, role: "GUEST" },
    { userId: guest2.id, role: "GUEST" },
  ]);
  const made = await makeProject(ws.id);
  const input = (assigneeId: string | null, title = "Work") => ({ workspaceId: ws.id, projectId: made.project.id, boardId: made.board.id, title, assigneeId });
  const as = (u: { id: string }) => ({ userId: u.id, orgId: org });
  const existing = (assigneeId: string | null = null) =>
    makeTask({ orgId: org, workspaceId: ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId: t.owner.id, assigneeId });
  return { ...t, admin2, lead, member2, guest2, outsiderGuest, ws, ...made, input, as, existing };
}

const bells = (userId: string, type: string) => db.notification.findMany({ where: { userId, type } });
const requests = (taskId: string) => db.taskAssignRequest.findMany({ where: { taskId } });

describe("giving a task directly: yourself, somebody below, somebody of the same rank", () => {
  it("below: an admin gives to a lead and a member, a lead to a member, a member to a guest of the space", async () => {
    const w = await world();
    expect((await createTask(w.as(w.admin), w.input(w.lead.id))).assigneeId).toBe(w.lead.id);
    expect((await createTask(w.as(w.admin), w.input(w.member.id))).assigneeId).toBe(w.member.id);
    expect((await createTask(w.as(w.lead), w.input(w.member.id))).assigneeId).toBe(w.member.id);
    expect((await createTask(w.as(w.member), w.input(w.guest.id))).assigneeId).toBe(w.guest.id);
    expect(await db.taskAssignRequest.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("the same rank is direct too (the owner's decision), and so is oneself", async () => {
    const w = await world();
    expect((await createTask(w.as(w.member), w.input(w.member2.id))).assigneeId).toBe(w.member2.id);
    expect((await createTask(w.as(w.admin), w.input(w.admin2.id))).assigneeId).toBe(w.admin2.id);
    expect((await createTask(w.as(w.lead), w.input(w.lead.id))).assigneeId).toBe(w.lead.id);
    expect(await db.taskAssignRequest.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("an update hands the task straight to the same rank or below, and the person is told by the route", async () => {
    const w = await world();
    const task = await w.existing();
    const done = await updateTask(w.as(w.member), task.id, { assigneeId: w.member2.id });
    expect(done.assigneeId).toBe(w.member2.id);
    expect(done.assignRequest).toBeNull();
    expect(await requests(task.id)).toEqual([]);
  });

  it("the OWNER gives to anybody directly: nobody is above him", async () => {
    const w = await world();
    for (const person of [w.admin, w.lead, w.member, w.guest]) {
      expect((await createTask(w.as(w.owner), w.input(person.id))).assigneeId).toBe(person.id);
    }
    expect(await db.taskAssignRequest.count({ where: { orgId: w.org.id } })).toBe(0);
  });
});

describe("B4 — each space is its own account: a task is given only to a person of the task's space", () => {
  it("a person of ANOTHER space cannot be given the task, whatever the rank (create, update, and beside the first); nothing is written", async () => {
    const w = await world();
    const memberOut = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Member Elsewhere" });
    const leadOut = await makeUser({ orgId: w.org.id, role: "LEAD", name: "Lead Elsewhere" });
    await makeWorkspace(w.org.id, [{ userId: memberOut.id }, { userId: leadOut.id }], "Elsewhere");
    for (const target of [memberOut, leadOut]) {
      await expect(createTask(w.as(w.admin), w.input(target.id)), target.name).rejects.toMatchObject({ message: "assign.target_not_in_space" });
    }
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
    const task = await w.existing(w.member.id);
    await expect(updateTask(w.as(w.admin), task.id, { assigneeId: memberOut.id })).rejects.toMatchObject({ message: "assign.target_not_in_space" });
    await expect(updateTask(w.as(w.admin), task.id, { coAssigneeIds: [w.member2.id, memberOut.id] })).rejects.toMatchObject({ message: "assign.target_not_in_space" });
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { coAssignees: true } });
    expect(after.assigneeId).toBe(w.member.id);
    expect(after.coAssignees).toEqual([]);
    // the door says it in Arabic (a key the dictionary knows)
    expect(AR["assign.target_not_in_space"]).toBeTruthy();
  });

  it("the owner rank is the exception as a TARGET (he needs no row in any space); as a giver he is held to the same rule", async () => {
    const w = await world();
    expect((await createTask(w.as(w.admin), w.input(w.owner.id))).assignRequest?.toUserId).toBe(w.owner.id);
    expect((await createTask(w.as(w.owner), w.input(w.member.id))).assigneeId).toBe(w.member.id);
    const outside = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Outside" });
    await expect(createTask(w.as(w.owner), w.input(outside.id))).rejects.toMatchObject({ message: "assign.target_not_in_space" });
  });

  it("existing rows are not rewritten: a task already held by somebody outside the space keeps its holder when something else changes", async () => {
    const w = await world();
    const outside = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Old holder" });
    const task = await w.existing(outside.id);
    const saved = await updateTask(w.as(w.admin), task.id, { title: "renamed" });
    expect(saved.assigneeId).toBe(outside.id);
    expect(saved.title).toBe("renamed");
  });
});

describe("giving a task upward is a request", () => {
  it("create: the task is born without the higher person, a request waits, and only they are told", async () => {
    const w = await world();
    const made = await createTask(w.as(w.member), w.input(w.admin.id, "Please take this"));
    expect(made.assigneeId).toBeNull();
    expect(made.assignRequest).toMatchObject({ toUserId: w.admin.id });
    const rows = await requests(made.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: w.org.id, fromUserId: w.member.id, toUserId: w.admin.id, status: "PENDING", reason: null, answeredAt: null });

    const bell = await bells(w.admin.id, "task_assign_request");
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({ title: AR["notif.type.task_assign_request"], linkUrl: `/tasks/${made.id}`, taskId: made.id, workspaceId: w.ws.id });
    expect(bell[0]!.body).toContain("Please take this");
    // it is not an assignment: nobody got «أُسندت إليك مهمة»
    expect(await bells(w.admin.id, "task_assigned")).toEqual([]);
    expect(await bells(w.member.id, "task_assign_request")).toEqual([]);
  });

  it("the ladder: a member asks a lead, an admin and the owner; a lead asks an admin; an admin asks the owner", async () => {
    const w = await world();
    for (const [from, to] of [[w.member, w.lead], [w.member, w.admin], [w.member, w.owner], [w.lead, w.admin], [w.admin, w.owner]] as const) {
      const task = await createTask(w.as(from), w.input(to.id));
      expect(task.assigneeId, `${from.name} -> ${to.name}`).toBeNull();
      expect(task.assignRequest?.toUserId, `${from.name} -> ${to.name}`).toBe(to.id);
    }
  });

  it("update: the task keeps the assignee it had, the request is stored, the change is not logged as an assignment", async () => {
    const w = await world();
    const task = await w.existing(w.member2.id);
    const saved = await updateTask(w.as(w.member), task.id, { title: "Renamed", assigneeId: w.admin.id });
    expect(saved.title).toBe("Renamed");
    expect(saved.assigneeId).toBe(w.member2.id);
    expect(saved.assignRequest).toMatchObject({ toUserId: w.admin.id });
    expect(await requests(task.id)).toHaveLength(1);
    expect(await bells(w.admin.id, "task_assign_request")).toHaveLength(1);
    const logs = await db.taskActivity.findMany({ where: { taskId: task.id } });
    expect(logs.map((l) => l.event).sort()).toEqual(["task.assign_requested", "task.updated"]);
    expect(logs.find((l) => l.event === "task.updated")?.meta).toEqual({ fields: ["title"] });
  });

  it("one request at a time per task", async () => {
    const w = await world();
    const task = await w.existing();
    await updateTask(w.as(w.member), task.id, { assigneeId: w.admin.id });
    await expect(updateTask(w.as(w.member), task.id, { assigneeId: w.owner.id })).rejects.toMatchObject({ message: "taskreq.already_pending" });
    expect(await requests(task.id)).toHaveLength(1);
  });

  it("the HTTP doors: POST /api/tasks and PATCH /api/tasks/[id] ask instead of assigning, and send no «أُسندت إليك»", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const posted = await call(taskRoute.POST, { body: { ...w.input(w.admin.id, "via post") } });
    expect(posted.status).toBe(201);
    const postedTask = posted.json?.["task"] as { id: string; assigneeId: string | null };
    expect(postedTask.assigneeId).toBeNull();
    expect(await requests(postedTask.id)).toHaveLength(1);

    const other = await w.existing();
    const patched = await call(taskIdRoute.PATCH, { method: "PATCH", params: { id: other.id }, body: { assigneeId: w.admin.id } });
    expect(patched.status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: other.id } })).assigneeId).toBeNull();
    expect(await requests(other.id)).toHaveLength(1);
    expect(await bells(w.admin.id, "task_assigned")).toEqual([]);
    expect(await bells(w.admin.id, "task_assign_request")).toHaveLength(2);

    // and to somebody of the same rank, the old way: assigned and told
    const direct = await call(taskIdRoute.PATCH, { method: "PATCH", params: { id: other.id }, body: { assigneeId: w.member2.id } });
    expect(direct.status).toBe(200);
  });

  it("a person who is not in the task's space cannot be asked (they could not open the task to answer)", async () => {
    const w = await world();
    const stranger = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "Admin Outside" });
    await expect(createTask(w.as(w.member), w.input(stranger.id))).rejects.toMatchObject({ message: "assign.request_not_in_space" });
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
    // the owner needs no row in any space
    expect((await createTask(w.as(w.member), w.input(w.owner.id))).assignRequest?.toUserId).toBe(w.owner.id);
  });
});

describe("answering a request", () => {
  async function asked() {
    const w = await world();
    const task = await createTask(w.as(w.member), w.input(w.admin.id, "Take it"));
    return { ...w, task };
  }

  it("ACCEPT: the task becomes theirs, the request is closed, the requester is told", async () => {
    const w = await asked();
    expect(await answerAssignRequest(w.as(w.admin), w.task.id, { accept: true })).toEqual({ status: "ACCEPTED" });
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).assigneeId).toBe(w.admin.id);
    expect((await requests(w.task.id))[0]).toMatchObject({ status: "ACCEPTED", reason: null });
    expect((await requests(w.task.id))[0]!.answeredAt).toBeInstanceOf(Date);
    const bell = await bells(w.member.id, "task_assign_accepted");
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({ title: AR["notif.type.task_assign_accepted"], linkUrl: `/tasks/${w.task.id}` });
  });

  it("RETURN with a written reason: the task stays unassigned, the reason goes back to the requester", async () => {
    const w = await asked();
    expect(await answerAssignRequest(w.as(w.admin), w.task.id, { accept: false, reason: "  Not mine, ask the lead  " })).toEqual({ status: "RETURNED" });
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).assigneeId).toBeNull();
    expect((await requests(w.task.id))[0]).toMatchObject({ status: "RETURNED", reason: "Not mine, ask the lead" });
    const bell = await bells(w.member.id, "task_assign_returned");
    expect(bell).toHaveLength(1);
    expect(bell[0]!.title).toBe(AR["notif.type.task_assign_returned"]);
    expect(bell[0]!.body).toContain("Not mine, ask the lead");
  });

  it("a return without a reason is refused and the request stays open", async () => {
    const w = await asked();
    await expect(answerAssignRequest(w.as(w.admin), w.task.id, { accept: false, reason: "   " })).rejects.toMatchObject({ message: "taskreq.reason_required" });
    expect((await requests(w.task.id))[0]!.status).toBe("PENDING");
  });

  it("answered twice is an error, whichever way the first answer went", async () => {
    const w = await asked();
    await answerAssignRequest(w.as(w.admin), w.task.id, { accept: true });
    await expect(answerAssignRequest(w.as(w.admin), w.task.id, { accept: true })).rejects.toMatchObject({ message: "taskreq.already_answered" });
    await expect(answerAssignRequest(w.as(w.admin), w.task.id, { accept: false, reason: "changed my mind" })).rejects.toMatchObject({ message: "taskreq.already_answered" });
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).assigneeId).toBe(w.admin.id);
    expect(await bells(w.member.id, "task_assign_returned")).toEqual([]);
    expect(await bells(w.member.id, "task_assign_accepted")).toHaveLength(1);
  });

  it("two answers at the same moment: exactly one wins", async () => {
    const w = await asked();
    const settled = await Promise.allSettled([
      answerAssignRequest(w.as(w.admin), w.task.id, { accept: true }),
      answerAssignRequest(w.as(w.admin), w.task.id, { accept: false, reason: "no" }),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((s) => s.status === "rejected")).toHaveLength(1);
  });

  it("only the addressed person or the OWNER may answer: another admin, the lead, the requester and a guest may not", async () => {
    const w = await asked();
    for (const person of [w.admin2, w.lead, w.member, w.guest]) {
      await expect(answerAssignRequest(w.as(person), w.task.id, { accept: true }), person.name).rejects.toMatchObject({ message: "taskreq.not_addressee" });
    }
    expect((await requests(w.task.id))[0]!.status).toBe("PENDING");
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).assigneeId).toBeNull();
    // the owner answers, and the task goes to the person it was asked of
    expect(await answerAssignRequest(w.as(w.owner), w.task.id, { accept: true })).toEqual({ status: "ACCEPTED" });
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).assigneeId).toBe(w.admin.id);
  });

  it("a task with no request says so", async () => {
    const w = await world();
    const task = await w.existing();
    await expect(answerAssignRequest(w.as(w.admin), task.id, { accept: true })).rejects.toMatchObject({ message: "taskreq.not_found" });
  });

  it("a person who is no longer ACTIVE cannot be handed the task by the owner's answer", async () => {
    const w = await asked();
    await suspend(w.org.id, w.admin.id);
    await expect(answerAssignRequest(w.as(w.owner), w.task.id, { accept: true })).rejects.toMatchObject({ message: "assignee.not_active" });
    expect((await requests(w.task.id))[0]!.status).toBe("PENDING");
    expect((await db.task.findUniqueOrThrow({ where: { id: w.task.id } })).assigneeId).toBeNull();
  });

  it("the HTTP doors: accept, return with a reason, the wrong person, no reason", async () => {
    const w = await world();
    const task = await createTask(w.as(w.member), w.input(w.admin.id));
    const other = await createTask(w.as(w.member), w.input(w.admin.id, "second"));

    await loginAs(w.lead.id);
    expect((await call(acceptRoute.POST, { params: { id: task.id } })).status).toBe(403);

    await loginAs(w.admin.id);
    const noReason = await call(returnRoute.POST, { params: { id: other.id }, body: { reason: "  " } });
    expect(noReason.status).toBe(422);
    expect((await requests(other.id))[0]!.status).toBe("PENDING");

    const returned = await call(returnRoute.POST, { params: { id: other.id }, body: { reason: "Busy this week" } });
    expect(returned.status).toBe(200);
    expect(returned.json).toEqual({ status: "RETURNED" });

    const accepted = await call(acceptRoute.POST, { params: { id: task.id } });
    expect(accepted.status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(w.admin.id);
    const again = await call(acceptRoute.POST, { params: { id: task.id } });
    expect(again.status).toBe(403);
    expect(again.json?.["message"]).toBe("taskreq.already_answered");
  });
});

describe("the external partner (GUEST)", () => {
  it("gives to nobody above: never a request, never an assignment", async () => {
    const w = await world();
    for (const person of [w.member, w.lead, w.admin, w.owner]) {
      await expect(createTask(w.as(w.guest), w.input(person.id)), person.name).rejects.toMatchObject({ name: "ForbiddenError" });
    }
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.taskAssignRequest.count({ where: { orgId: w.org.id } })).toBe(0);
    // upward inside the shared space is refused outright (not asked)
    await expect(createTask(w.as(w.guest), w.input(w.member.id))).rejects.toMatchObject({ message: "assign.guest_no_request" });
  });

  it("gives only inside a space both are in: to a partner of the same space (same rank), not to one outside it", async () => {
    const w = await world();
    expect((await createTask(w.as(w.guest), w.input(w.guest2.id))).assigneeId).toBe(w.guest2.id);
    expect((await createTask(w.as(w.guest), w.input(w.guest.id))).assigneeId).toBe(w.guest.id);
    await expect(createTask(w.as(w.guest), w.input(w.outsiderGuest.id))).rejects.toMatchObject({ message: "assign.guest_cannot_give" });
    // an update obeys it too
    const task = await w.existing();
    await expect(updateTask(w.as(w.guest), task.id, { assigneeId: w.admin.id })).rejects.toMatchObject({ message: "assign.guest_no_request" });
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBeNull();
  });

  it("is given tasks only inside a space both are members of, by anybody above", async () => {
    const w = await world();
    // a member and the owner give to the partner of their space: direct (the partner is the lowest rank)
    expect((await createTask(w.as(w.member), w.input(w.guest.id))).assigneeId).toBe(w.guest.id);
    expect((await createTask(w.as(w.owner), w.input(w.guest.id))).assigneeId).toBe(w.guest.id);
    // a partner who is not in that space cannot receive its tasks, whoever gives
    for (const giver of [w.member, w.admin, w.owner]) {
      await expect(createTask(w.as(giver), w.input(w.outsiderGuest.id)), giver.name).rejects.toMatchObject({ message: "assign.guest_outside_space" });
    }
    // a giver who is not in the space either (an admin has no inherited row)
    const outsideAdmin = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "Admin Not In Space" });
    await expect(createTask(w.as(outsideAdmin), w.input(w.guest.id))).rejects.toMatchObject({ message: "assign.guest_outside_space" });
    expect(await db.task.count({ where: { orgId: w.org.id, assigneeId: w.outsiderGuest.id } })).toBe(0);
  });
});

describe("a person who is not active, and the instant task", () => {
  it("a suspended person can be neither given a task nor asked, even by the owner", async () => {
    const w = await world();
    await suspend(w.org.id, w.admin.id);
    await suspend(w.org.id, w.member2.id);
    for (const [giver, person] of [[w.member, w.admin], [w.owner, w.admin], [w.member, w.member2]] as const) {
      await expect(createTask(w.as(giver), w.input(person.id))).rejects.toMatchObject({ message: "assignee.not_active" });
    }
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.taskAssignRequest.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("the instant task obeys the same: below and same rank are direct and told; above is a request", async () => {
    const w = await world();
    const ctx = (u: { id: string }, role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER") => ctxOf(w.org.id, u.id, role);
    const input = (assigneeId: string) => ({ title: "Quick one", assigneeId, priority: "NORMAL" as const, dueDate: null });

    const direct = await createInstantTask(ctx(w.admin, "ADMIN"), w.ws.id, input(w.member.id));
    expect(direct.requested).toBe(false);
    expect((await db.task.findUniqueOrThrow({ where: { id: direct.id } })).assigneeId).toBe(w.member.id);
    expect(await bells(w.member.id, "task_assigned")).toHaveLength(1);

    const same = await createInstantTask(ctx(w.member, "MEMBER"), w.ws.id, input(w.member2.id));
    expect(same.requested).toBe(false);
    expect((await db.task.findUniqueOrThrow({ where: { id: same.id } })).assigneeId).toBe(w.member2.id);

    const up = await createInstantTask(ctx(w.member, "MEMBER"), w.ws.id, input(w.admin.id));
    expect(up.requested).toBe(true);
    expect((await db.task.findUniqueOrThrow({ where: { id: up.id } })).assigneeId).toBeNull();
    expect(await requests(up.id)).toEqual([expect.objectContaining({ fromUserId: w.member.id, toUserId: w.admin.id, status: "PENDING" })]);
    expect(await bells(w.admin.id, "task_assign_request")).toHaveLength(1);
    expect(await bells(w.admin.id, "task_assigned")).toEqual([]);

    // the owner needs no row in the space, and is asked like any higher person
    const toOwner = await createInstantTask(ctx(w.lead, "LEAD"), w.ws.id, input(w.owner.id));
    expect(toOwner.requested).toBe(true);
  });

  it("GET /api/instant marks the people a pick would only ask", async () => {
    const w = await world();
    jar().set(SPACE_COOKIE, w.ws.id);
    await loginAs(w.member.id);
    const people = (await call(instantRoute.GET)).json?.["people"] as { id: string; request?: boolean }[];
    const flag = (id: string) => people.find((p) => p.id === id)?.request;
    expect(flag(w.admin.id)).toBe(true);
    expect(flag(w.lead.id)).toBe(true);
    expect(flag(w.member2.id)).toBe(false);
    expect(flag(w.member.id)).toBe(false);
    expect(flag(w.guest.id)).toBe(false);
    await loginAs(w.owner.id);
    const asOwner = (await call(instantRoute.GET)).json?.["people"] as { id: string; request?: boolean }[];
    expect(asOwner.every((p) => p.request === false)).toBe(true);
  });
});
