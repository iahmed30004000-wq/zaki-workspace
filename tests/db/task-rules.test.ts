import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as rulesRoute from "@/app/api/projects/[id]/rules/route";
import * as ruleRoute from "@/app/api/projects/[id]/rules/[ruleId]/route";
import * as logRoute from "@/app/api/projects/[id]/rules/log/route";
import * as moveRoute from "@/app/api/tasks/[id]/move/route";
import * as completeRoute from "@/app/api/tasks/[id]/complete/route";
import { createTask } from "@/server/services/tasks";
import { fireOverdueRules, fireTaskRules } from "@/server/services/task-rules-run";
import { runDueJobs } from "@/server/jobs/run";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «القواعد التلقائية» — if-then rules per project, against a real database.
 *
 * What this pins:
 *  - WHO defines: the space's ADMIN and the owner (who is in no row of the space), nobody else, and nobody reads the rules or the log either;
 *  - WHAT a rule may name, when it is saved: the project's own board and columns, an ACTIVE person of the space who is not a guest and not
 *    of a higher rank, an open and unrestricted topic of the same space; at most ten rules a project;
 *  - THE FOUR TRIGGERS (created, moved to a column, completed, overdue) and the six actions, each recorded in the log;
 *  - NO LOOPS: a rule's own move never starts a rule (depth one), a rule acts once on a task even for two events at once, and a second visit
 *    to the same column does nothing;
 *  - THE RUN-TIME RE-CHECK: an admin who stopped managing the space, a person who left, turned guest or was suspended, a closed topic, a column
 *    that is gone: that action is skipped with a reason, the person's own action still stands, nothing is widened;
 *  - NO MONEY: a task that carries a reward is left alone entirely;
 *  - PAUSE, the log (append-only, kept when a rule is deleted), the owner's silent read, and the company's switch.
 */

async function world() {
  const team = await makeTeam();
  const colleague = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Colleague" });
  const ws = await makeWorkspace(
    team.org.id,
    [{ userId: team.member.id }, { userId: colleague.id }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.guest.id, role: "GUEST" }],
    "مساحة",
  );
  const made = await makeProject(ws.id, "مشروع");
  const review = await db.boardColumn.create({ data: { boardId: made.board.id, name: "review", position: 2 } });
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", title: "عام", spaceId: ws.id } });
  return { ...team, colleague, ws, made, review, topic };
}
type World = Awaited<ReturnType<typeof world>>;

const PID = (w: World) => ({ id: w.made.project.id });
const RID = (w: World, ruleId: string) => ({ id: w.made.project.id, ruleId });
const rule = (over: Record<string, unknown> = {}) => ({ name: "قاعدة", trigger: "CREATED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }], ...over });

async function addRule(w: World, body: Record<string, unknown>, as = w.admin.id) {
  await loginAs(as);
  const res = await call(rulesRoute.POST, { params: PID(w), body });
  return { res, id: (res.json as { rule?: { id: string } } | null)?.rule?.id as string };
}
/** A rule that must be accepted. */
async function mustAdd(w: World, body: Record<string, unknown>, as = w.admin.id): Promise<string> {
  const made = await addRule(w, body, as);
  expect(made.res.status, made.res.text).toBe(201);
  return made.id;
}
const newTask = (w: World, over: Record<string, unknown> = {}) =>
  createTask({ userId: w.member.id, orgId: w.org.id }, { workspaceId: w.ws.id, projectId: w.made.project.id, boardId: w.made.board.id, title: "مهمة", ...over });
const plainTask = (w: World, over: { columnId?: string; dueDate?: Date | null; completedAt?: Date | null; projectId?: string; boardId?: string } = {}) =>
  makeTask({
    orgId: w.org.id,
    workspaceId: w.ws.id,
    projectId: over.projectId ?? w.made.project.id,
    boardId: over.boardId ?? w.made.board.id,
    columnId: over.columnId ?? w.made.todo.id,
    creatorId: w.owner.id,
    assigneeId: null,
    title: "مهمة عادية",
    ...(over.dueDate !== undefined ? { dueDate: over.dueDate } : {}),
    ...(over.completedAt !== undefined ? { completedAt: over.completedAt } : {}),
  });
const move = async (w: World, taskId: string, columnId: string, as = w.member.id) => {
  await loginAs(as);
  return call(moveRoute.POST, { params: { id: taskId }, body: { columnId } });
};
const complete = async (w: World, taskId: string, as = w.member.id) => {
  await loginAs(as);
  return call(completeRoute.POST, { params: { id: taskId }, body: { complete: true } });
};
const runsOf = (ruleId: string) => db.taskRuleRun.findMany({ where: { ruleId }, orderBy: { createdAt: "asc" } });
const results = (run: { results: Prisma.JsonValue }) => run.results as { type: string; status: string; reason?: string }[];
const task = (id: string) => db.task.findUniqueOrThrow({ where: { id } });
async function setSwitch(w: World, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
  await db.organization.update({ where: { id: w.org.id }, data: { settings: withFeature(org.settings, "taskRules", on) as Prisma.InputJsonValue } });
}

describe("«القواعد التلقائية»: who defines and who reads", () => {
  it("the space's ADMIN and the owner (in no row of the space) define; a member, a colleague and a guest are refused", async () => {
    const w = await world();
    expect((await addRule(w, rule(), w.admin.id)).res.status).toBe(201);
    expect((await addRule(w, rule({ name: "من المالك" }), w.owner.id)).res.status).toBe(201);
    for (const person of [w.member, w.colleague, w.guest]) {
      expect((await addRule(w, rule(), person.id)).res.status, person.name).toBe(403);
    }
    expect(await db.taskRule.count({ where: { projectId: w.made.project.id } })).toBe(2);
  });

  it("an org ADMIN with no row in the space, and people of another company, get nothing", async () => {
    const w = await world();
    const stranger = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "Stranger" });
    const other = await makeTeam();
    for (const person of [stranger, other.owner, other.admin]) {
      expect([403, 404], person.name).toContain((await addRule(w, rule(), person.id)).res.status);
    }
    expect(await db.taskRule.count({ where: { projectId: w.made.project.id } })).toBe(0);
  });

  it("the rules and the log are read by the same people only; a member, a colleague and a guest read none of it", async () => {
    const w = await world();
    const id = await mustAdd(w, rule());
    await plainTask(w).then((t) => fireTaskRules({ trigger: "CREATED", taskId: t.id }));
    for (const person of [w.member, w.colleague, w.guest]) {
      await loginAs(person.id);
      expect((await call(rulesRoute.GET, { params: PID(w) })).status, person.name).toBe(403);
      expect((await call(logRoute.GET, { params: PID(w) })).status, person.name).toBe(403);
      expect((await call(ruleRoute.PATCH, { method: "PATCH", params: RID(w, id), body: { active: false } })).status, person.name).toBe(403);
      expect((await call(ruleRoute.DELETE, { method: "DELETE", params: RID(w, id) })).status, person.name).toBe(403);
    }
    expect((await db.taskRule.findUniqueOrThrow({ where: { id } })).active).toBe(true);
    expect((await db.taskRule.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    await loginAs(w.admin.id);
    const read = await call(rulesRoute.GET, { params: PID(w), url: "http://localhost/api/test?options=1" });
    expect(read.status).toBe(200);
    expect((read.json as { rules: unknown[]; options: { people: { id: string }[] } }).rules).toHaveLength(1);
    // the people offered never include the guest
    expect((read.json as { options: { people: { id: string }[] } }).options.people.map((p) => p.id)).not.toContain(w.guest.id);
    expect(((await call(logRoute.GET, { params: PID(w) })).json as { runs: unknown[] }).runs).toHaveLength(1);
  });

  it("the owner reads the rules and the log of a space he is not in, and the read leaves no trace", async () => {
    const w = await world();
    await mustAdd(w, rule());
    await plainTask(w).then((t) => fireTaskRules({ trigger: "CREATED", taskId: t.id }));
    const count = async () => ({
      members: await db.workspaceMember.count({ where: { workspaceId: w.ws.id } }),
      conv: await db.conversationMember.count(),
      notes: await db.notification.count({ where: { userId: { in: [w.owner.id, w.admin.id] } } }),
      audit: await db.auditLog.count({ where: { orgId: w.org.id } }),
      runs: await db.taskRuleRun.count({ where: { orgId: w.org.id } }),
      rules: await db.taskRule.count({ where: { orgId: w.org.id } }),
    });
    const before = await count();
    await loginAs(w.owner.id);
    expect((await call(rulesRoute.GET, { params: PID(w), url: "http://localhost/api/test?options=1" })).status).toBe(200);
    expect((await call(logRoute.GET, { params: PID(w) })).status).toBe(200);
    expect(await count()).toEqual(before);
  });
});

describe("«القواعد التلقائية»: what a rule may name", () => {
  it("a rule is checked when it is saved: name, trigger, one or two actions of different kinds, a column with its board", async () => {
    const w = await world();
    const col = w.made.todo.id;
    const board = w.made.board.id;
    const cases: [string, Record<string, unknown>][] = [
      ["taskrules.name_empty", rule({ name: "  " })],
      ["taskrules.name_long", rule({ name: "ا".repeat(81) })],
      ["taskrules.trigger_invalid", rule({ trigger: "WHENEVER" })],
      ["taskrules.actions_count", rule({ actions: [] })],
      ["taskrules.actions_count", rule({ actions: [{ type: "ADD_STEP", title: "أ" }, { type: "SET_PRIORITY", priority: "LOW" }, { type: "NOTIFY", userId: w.member.id }] })],
      ["taskrules.action_duplicate", rule({ actions: [{ type: "ADD_STEP", title: "أ" }, { type: "ADD_STEP", title: "ب" }] })],
      ["taskrules.action_invalid", rule({ actions: [{ type: "PAY_REWARD", amount: 5 }] })],
      ["taskrules.column_required", rule({ trigger: "MOVED_TO_COLUMN", boardId: board })],
      ["taskrules.board_required", rule({ trigger: "MOVED_TO_COLUMN", triggerColumnId: col })],
      ["taskrules.board_required", rule({ actions: [{ type: "MOVE_TO_COLUMN", columnId: col }] })],
      ["taskrules.priority_invalid", rule({ actions: [{ type: "SET_PRIORITY", priority: "NONE" }] })],
      ["taskrules.step_empty", rule({ actions: [{ type: "ADD_STEP", title: " " }] })],
      ["taskrules.text_long", rule({ actions: [{ type: "POST_MESSAGE", topicId: w.topic.id, text: "ا".repeat(301) }] })],
    ];
    for (const [key, body] of cases) {
      const res = (await addRule(w, body)).res;
      expect(res.status, key).toBe(422);
      expect(res.text, key).toContain(key);
    }
    expect(await db.taskRule.count({ where: { projectId: w.made.project.id } })).toBe(0);
  });

  it("the board and the columns are the project's own: a column of another board or project, or a board of another project, is refused", async () => {
    const w = await world();
    const other = await makeProject(w.ws.id, "مشروع ثاني");
    const sideBoard = await db.board.create({ data: { projectId: w.made.project.id, name: "لوحة ثانية" } });
    const sideCol = await db.boardColumn.create({ data: { boardId: sideBoard.id, name: "جانبي", position: 0 } });
    const bad: [string, Record<string, unknown>][] = [
      ["taskrules.board_not_found", rule({ boardId: other.board.id })],
      ["taskrules.column_not_found", rule({ trigger: "MOVED_TO_COLUMN", boardId: w.made.board.id, triggerColumnId: other.todo.id })],
      ["taskrules.column_not_found", rule({ trigger: "MOVED_TO_COLUMN", boardId: w.made.board.id, triggerColumnId: sideCol.id })],
      ["taskrules.column_not_found", rule({ boardId: w.made.board.id, actions: [{ type: "MOVE_TO_COLUMN", columnId: sideCol.id }] })],
    ];
    for (const [key, body] of bad) expect((await addRule(w, body)).res.text, key).toContain(key);
    expect(await db.taskRule.count({ where: { projectId: w.made.project.id } })).toBe(0);
    await mustAdd(w, rule({ trigger: "MOVED_TO_COLUMN", boardId: sideBoard.id, triggerColumnId: sideCol.id }));
  });

  it("a person is ACTIVE, in the space, never a guest and never of a higher rank; the owner (above the admin) is refused, the admin is fine for the owner", async () => {
    const w = await world();
    const outsider = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Outsider" });
    const suspended = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Suspended" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: suspended.id } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: suspended.id } }, data: { status: "SUSPENDED" } });
    const named = (userId: string, type = "ASSIGN") => rule({ actions: [{ type, userId }] });
    for (const [person, type] of [[w.guest, "ASSIGN"], [w.guest, "NOTIFY"], [outsider, "ASSIGN"], [suspended, "NOTIFY"], [{ id: "ghost" }, "ASSIGN"]] as const) {
      const res = (await addRule(w, named(person.id, type))).res;
      expect(res.status, `${person.id} ${type}`).toBe(422);
      expect(res.text).toContain("taskrules.person_not_allowed");
    }
    // the owner is above the admin: handing him a task is a request, never a rule
    expect((await addRule(w, named(w.owner.id), w.admin.id)).res.text).toContain("taskrules.person_higher");
    // ... but to be NOTIFIED is fine for anybody eligible
    expect((await addRule(w, named(w.owner.id, "NOTIFY"), w.admin.id)).res.status).toBe(201);
    // the owner may hand work to the admin directly
    expect((await addRule(w, named(w.admin.id), w.owner.id)).res.status).toBe(201);
    expect((await addRule(w, named(w.colleague.id, "ASSIGN"), w.admin.id)).res.status).toBe(201);
  });

  it("a topic is an open, unrestricted topic of the project's own space", async () => {
    const w = await world();
    const elsewhere = await makeWorkspace(w.org.id, [{ userId: w.admin.id, role: "ADMIN" }], "مساحة ثانية");
    const foreign = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "غريب", spaceId: elsewhere.id } });
    const restricted = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "مقيّد", spaceId: w.ws.id, restricted: true } });
    const closed = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", title: "مسكّر", spaceId: w.ws.id, closedAt: new Date() } });
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM", dmKey: "a|b" } });
    for (const t of [foreign, restricted, closed, dm, { id: "nope" }]) {
      const res = (await addRule(w, rule({ actions: [{ type: "POST_MESSAGE", topicId: t.id, text: "سلام" }] }))).res;
      expect(res.text, t.id).toContain("taskrules.topic_not_allowed");
    }
    expect((await addRule(w, rule({ actions: [{ type: "POST_MESSAGE", topicId: w.topic.id, text: "سلام" }] }))).res.status).toBe(201);
  });

  it("at most ten rules a project: the eleventh is refused, deleting one frees a slot, and another project is counted on its own", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await mustAdd(w, rule({ name: `قاعدة ${i}` })));
    const eleventh = (await addRule(w, rule())).res;
    expect(eleventh.status).toBe(403);
    expect(eleventh.text).toContain("taskrules.too_many");
    await loginAs(w.admin.id);
    expect((await call(ruleRoute.DELETE, { method: "DELETE", params: RID(w, ids[0]!) })).status).toBe(200);
    expect((await addRule(w, rule())).res.status).toBe(201);
    const second = await makeProject(w.ws.id, "مشروع ثاني");
    await loginAs(w.admin.id);
    expect((await call(rulesRoute.POST, { params: { id: second.project.id }, body: rule() })).status).toBe(201);
  });

  it("editing a rule saves the same checks again, and a rule id of another project is «not found»", async () => {
    const w = await world();
    const id = await mustAdd(w, rule());
    await loginAs(w.admin.id);
    const bad = await call(ruleRoute.PATCH, { method: "PATCH", params: RID(w, id), body: rule({ actions: [{ type: "ASSIGN", userId: w.guest.id }] }) });
    expect(bad.text).toContain("taskrules.person_not_allowed");
    const ok = await call(ruleRoute.PATCH, { method: "PATCH", params: RID(w, id), body: rule({ name: "اسم جديد", trigger: "COMPLETED" }) });
    expect(ok.status).toBe(200);
    expect(await db.taskRule.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "اسم جديد", trigger: "COMPLETED", runAsId: w.admin.id });
    const other = await makeProject(w.ws.id, "ثاني");
    expect((await call(ruleRoute.PATCH, { method: "PATCH", params: { id: other.project.id, ruleId: id }, body: { active: false } })).status).toBe(404);
    expect((await call(ruleRoute.DELETE, { method: "DELETE", params: { id: other.project.id, ruleId: id } })).status).toBe(404);
  });
});

describe("«القواعد التلقائية»: the triggers and the actions", () => {
  it("«لما تنعمل مهمة»: assign, set the priority and notify; recorded in the log; the task shows it and the person is told", async () => {
    const w = await world();
    const id = await mustAdd(w, rule({ actions: [{ type: "ASSIGN", userId: w.colleague.id }, { type: "SET_PRIORITY", priority: "URGENT" }] }));
    const created = await newTask(w);
    const t = await task(created.id);
    expect(t.assigneeId).toBe(w.colleague.id);
    expect(t.priority).toBe("URGENT");
    const [run] = await runsOf(id);
    expect(run).toMatchObject({ status: "APPLIED", trigger: "CREATED", taskId: created.id, runAsId: w.admin.id, ruleName: "قاعدة" });
    expect(results(run!).map((r) => `${r.type}:${r.status}`)).toEqual(["ASSIGN:APPLIED", "SET_PRIORITY:APPLIED"]);
    expect(run!.taskKey).toMatch(/-\d+$/);
    // the rule acted as the admin who saved it, and the assignee heard about the task like any other assignment
    const activity = await db.taskActivity.findFirst({ where: { taskId: created.id, event: "task.updated" } });
    expect(activity?.actorId).toBe(w.admin.id);
    expect(await db.notification.count({ where: { userId: w.colleague.id, type: "task_assigned", taskId: created.id } })).toBe(1);
  });

  it("«لما تنتقل مهمة لعمود»: add a step, notify a person and post a system line into the topic; leaving and re-entering the column does nothing more", async () => {
    const w = await world();
    const id = await mustAdd(
      w,
      rule({
        name: "للمراجعة",
        trigger: "MOVED_TO_COLUMN",
        boardId: w.made.board.id,
        triggerColumnId: w.review.id,
        actions: [{ type: "ADD_STEP", title: "راجع الشغل" }, { type: "NOTIFY", userId: w.colleague.id, note: "بدها مراجعة" }],
      }),
    );
    const created = await newTask(w);
    expect(await runsOf(id)).toHaveLength(0);
    expect((await move(w, created.id, w.review.id)).status).toBe(200);
    expect(await db.taskStep.findMany({ where: { taskId: created.id } })).toHaveLength(1);
    const note = await db.notification.findFirstOrThrow({ where: { userId: w.colleague.id, type: "task_rule" } });
    expect(note.body).toContain("بدها مراجعة");
    expect(note.linkUrl).toBe(`/tasks/${created.id}`);
    expect((await move(w, created.id, w.made.todo.id)).status).toBe(200);
    expect((await move(w, created.id, w.review.id)).status).toBe(200);
    expect(await runsOf(id)).toHaveLength(1);
    expect(await db.taskStep.count({ where: { taskId: created.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.colleague.id, type: "task_rule" } })).toBe(1);
  });

  it("«اكتب سطر بموضوع»: a SYSTEM line of the topic carries the rule's name and text, authored by nobody's words", async () => {
    const w = await world();
    const id = await mustAdd(w, rule({ name: "إعلان", actions: [{ type: "POST_MESSAGE", topicId: w.topic.id, text: "في مهمة جديدة" }] }));
    const created = await newTask(w);
    const lines = await db.chatMessage.findMany({ where: { conversationId: w.topic.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe("SYSTEM");
    const body = JSON.parse(lines[0]!.body) as { k: string; p: Record<string, string> };
    expect(body.k).toBe("task_rule");
    expect(body.p).toMatchObject({ rule: "إعلان", text: "في مهمة جديدة" });
    expect(body.p["task"]).toContain(created.title);
    expect((await runsOf(id))[0]!.status).toBe("APPLIED");
  });

  it("«لما تنتهي مهمة»: the tick box and the drag into the done column both fire it, once", async () => {
    const w = await world();
    const id = await mustAdd(w, rule({ trigger: "COMPLETED", actions: [{ type: "SET_PRIORITY", priority: "LOW" }, { type: "NOTIFY", userId: w.colleague.id }] }));
    const a = await plainTask(w);
    const b = await plainTask(w);
    expect((await complete(w, a.id)).status).toBe(200);
    expect((await move(w, b.id, w.made.done.id)).status).toBe(200);
    expect((await task(a.id)).priority).toBe("LOW");
    expect((await task(b.id)).priority).toBe("LOW");
    expect(await runsOf(id)).toHaveLength(2);
    // reopening and finishing again is the same task: the rule has acted on it
    await loginAs(w.member.id);
    await call(completeRoute.POST, { params: { id: a.id }, body: { complete: false } });
    await complete(w, a.id);
    expect(await runsOf(id)).toHaveLength(2);
    expect(await db.notification.count({ where: { userId: w.colleague.id, type: "task_rule" } })).toBe(2);
  });

  it("«انقلها لعمود»: a rule moves the task as the admin and the task's own move is recorded", async () => {
    const w = await world();
    await mustAdd(w, rule({ boardId: w.made.board.id, actions: [{ type: "MOVE_TO_COLUMN", columnId: w.review.id }] }));
    const created = await newTask(w);
    expect((await task(created.id)).columnId).toBe(w.review.id);
    const moved = await db.taskActivity.findFirstOrThrow({ where: { taskId: created.id, event: "task.moved" } });
    expect(moved.actorId).toBe(w.admin.id);
  });

  it("«لما تتأخر»: the job acts on the open tasks that fell due AFTER the rule was armed, once; old overdue, done and paused ones are left", async () => {
    const w = await world();
    const id = await mustAdd(w, rule({ name: "تأخر", trigger: "OVERDUE", actions: [{ type: "SET_PRIORITY", priority: "URGENT" }, { type: "NOTIFY", userId: w.colleague.id }] }));
    // armed three hours ago, so that a task due within the test's own minutes is «after the rule was armed»
    await db.taskRule.update({ where: { id }, data: { armedAt: new Date(Date.now() - 3 * 3_600_000) } });
    const soon = new Date(Date.now() + 3_600_000);
    const fresh = await plainTask(w, { dueDate: soon });
    const old = await plainTask(w, { dueDate: new Date(Date.now() - 86_400_000) });
    const finished = await plainTask(w, { dueDate: soon, completedAt: new Date() });
    const later = new Date(Date.now() + 2 * 3_600_000);

    expect(await fireOverdueRules(new Date())).toEqual({ fired: 0 });
    const viaJobs = await runDueJobs(later);
    expect(viaJobs.failed).toEqual([]);
    expect(viaJobs.taskRules).toEqual({ fired: 1 });
    expect((await task(fresh.id)).priority).toBe("URGENT");
    expect((await task(old.id)).priority).toBe("NORMAL");
    expect((await task(finished.id)).priority).toBe("NORMAL");
    expect(await fireOverdueRules(later)).toEqual({ fired: 0 });
    expect(await runsOf(id)).toHaveLength(1);

    // paused: nothing. Resumed: the rule looks forward from the resume, so a task that fell due while it slept is not woken up
    const slept = await plainTask(w, { dueDate: new Date(Date.now() - 3_600_000) });
    await loginAs(w.admin.id);
    expect((await call(ruleRoute.PATCH, { method: "PATCH", params: RID(w, id), body: { active: false } })).status).toBe(200);
    expect(await fireOverdueRules(later)).toEqual({ fired: 0 });
    expect((await call(ruleRoute.PATCH, { method: "PATCH", params: RID(w, id), body: { active: true } })).status).toBe(200);
    expect(await fireOverdueRules(later)).toEqual({ fired: 0 });
    expect((await task(slept.id)).priority).toBe("NORMAL");
  });

  it("a rule belongs to its project and its board: other projects and other boards are not touched", async () => {
    const w = await world();
    const otherProject = await makeProject(w.ws.id, "ثاني");
    const sideBoard = await db.board.create({ data: { projectId: w.made.project.id, name: "جانبية" } });
    await db.boardColumn.create({ data: { boardId: sideBoard.id, name: "جديد", position: 0 } });
    const id = await mustAdd(w, rule({ boardId: w.made.board.id }));
    await newTask(w);
    await createTask({ userId: w.member.id, orgId: w.org.id }, { workspaceId: w.ws.id, projectId: otherProject.project.id, boardId: otherProject.board.id, title: "ثاني" });
    await createTask({ userId: w.member.id, orgId: w.org.id }, { workspaceId: w.ws.id, projectId: w.made.project.id, boardId: sideBoard.id, title: "جانبية" });
    expect(await runsOf(id)).toHaveLength(1);
  });
});

describe("«القواعد التلقائية»: no loops", () => {
  it("a rule's own move never starts another rule (depth one), and a second visit to the column does nothing", async () => {
    const w = await world();
    const toReview = await mustAdd(w, rule({ name: "إلى المراجعة", trigger: "MOVED_TO_COLUMN", boardId: w.made.board.id, triggerColumnId: w.made.todo.id, actions: [{ type: "MOVE_TO_COLUMN", columnId: w.review.id }] }));
    const backToTodo = await mustAdd(w, rule({ name: "رجوع", trigger: "MOVED_TO_COLUMN", boardId: w.made.board.id, triggerColumnId: w.review.id, actions: [{ type: "MOVE_TO_COLUMN", columnId: w.made.todo.id }] }));
    const done = await plainTask(w, { columnId: w.made.done.id });
    // the person drags it into «todo»: the first rule moves it to «review» and the second must NOT answer that move
    expect((await move(w, done.id, w.made.todo.id)).status).toBe(200);
    expect((await task(done.id)).columnId).toBe(w.review.id);
    expect(await runsOf(toReview)).toHaveLength(1);
    expect(await runsOf(backToTodo)).toHaveLength(0);
    // the person drags it to «review» themselves: the second rule answers a PERSON's move, once
    expect((await move(w, done.id, w.made.done.id)).status).toBe(200);
    expect((await move(w, done.id, w.review.id)).status).toBe(200);
    expect((await task(done.id)).columnId).toBe(w.made.todo.id);
    expect(await runsOf(backToTodo)).toHaveLength(1);
    // and it never answers the same task twice, however often the person comes back
    expect((await move(w, done.id, w.review.id)).status).toBe(200);
    expect((await task(done.id)).columnId).toBe(w.review.id);
    expect(await runsOf(backToTodo)).toHaveLength(1);
  });

  it("two events at once, or a retry, are one run: one step, one log row", async () => {
    const w = await world();
    const id = await mustAdd(w, rule({ actions: [{ type: "ADD_STEP", title: "مرة وحدة" }] }));
    const t = await plainTask(w);
    await Promise.all([fireTaskRules({ trigger: "CREATED", taskId: t.id }), fireTaskRules({ trigger: "CREATED", taskId: t.id }), fireTaskRules({ trigger: "CREATED", taskId: t.id })]);
    await fireTaskRules({ trigger: "CREATED", taskId: t.id });
    expect(await db.taskStep.count({ where: { taskId: t.id } })).toBe(1);
    expect(await runsOf(id)).toHaveLength(1);
  });
});

describe("«القواعد التلقائية»: the run-time re-check, and what a rule never does", () => {
  it("a person who left the space, turned guest or was suspended is skipped for that action only; the rest of the rule and the person's own action stand", async () => {
    const w = await world();
    const gone = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Gone" });
    const turnedGuest = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "TurnedGuest" });
    const suspended = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Suspended" });
    for (const u of [gone, turnedGuest, suspended]) await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: u.id } });
    const ids: Record<string, string> = {};
    for (const [key, u] of [["gone", gone], ["guest", turnedGuest], ["suspended", suspended]] as const) {
      ids[key] = await mustAdd(w, rule({ name: key, actions: [{ type: "ASSIGN", userId: u.id }, { type: "SET_PRIORITY", priority: "HIGH" }] }));
    }
    // after saving: the first left the space, the second became an external partner, the third was suspended
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: gone.id } } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: turnedGuest.id } }, data: { role: "GUEST" } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: suspended.id } }, data: { status: "SUSPENDED" } });

    const created = await newTask(w);
    expect(created.id).toBeTruthy();
    const t = await task(created.id);
    expect(t.assigneeId).toBeNull();
    expect(t.priority).toBe("HIGH");
    for (const key of ["gone", "guest", "suspended"]) {
      const [run] = await runsOf(ids[key]!);
      expect(run!.status, key).toBe("PARTIAL");
      expect(results(run!)[0], key).toMatchObject({ type: "ASSIGN", status: "SKIPPED", reason: "person_not_allowed" });
      expect(results(run!)[1], key).toMatchObject({ type: "SET_PRIORITY", status: "APPLIED" });
    }
    expect(await db.notification.count({ where: { userId: { in: [gone.id, turnedGuest.id, suspended.id] } } })).toBe(0);
  });

  it("an admin who no longer manages the space, or was suspended, leaves the rule asleep: every action skipped, logged, nothing widened", async () => {
    const w = await world();
    const demoted = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Demoted" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: demoted.id, role: "ADMIN" } });
    const a = await mustAdd(w, rule({ name: "أ" }), demoted.id);
    const b = await mustAdd(w, rule({ name: "ب", actions: [{ type: "NOTIFY", userId: w.colleague.id }] }), w.admin.id);
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: demoted.id } }, data: { role: "MEMBER" } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { status: "SUSPENDED" } });

    const created = await newTask(w);
    expect((await task(created.id)).priority).toBe("NORMAL");
    for (const id of [a, b]) {
      const [run] = await runsOf(id);
      expect(run!.status).toBe("SKIPPED");
      expect(results(run!).every((r) => r.status === "SKIPPED" && r.reason === "runas_not_allowed")).toBe(true);
    }
    expect(await db.notification.count({ where: { userId: w.colleague.id, type: "task_rule" } })).toBe(0);
    // the person who made the task is not told off: the task exists
    expect(await db.task.count({ where: { id: created.id } })).toBe(1);
  });

  it("a closed topic and a deleted column skip that action with a reason", async () => {
    const w = await world();
    const sideCol = await db.boardColumn.create({ data: { boardId: w.made.board.id, name: "مؤقت", position: 5 } });
    const id = await mustAdd(
      w,
      rule({ boardId: w.made.board.id, actions: [{ type: "POST_MESSAGE", topicId: w.topic.id, text: "أهلًا" }, { type: "MOVE_TO_COLUMN", columnId: sideCol.id }] }),
    );
    await db.conversation.update({ where: { id: w.topic.id }, data: { closedAt: new Date() } });
    await db.boardColumn.delete({ where: { id: sideCol.id } });
    const created = await newTask(w);
    const [run] = await runsOf(id);
    expect(run!.status).toBe("SKIPPED");
    expect(results(run!).map((r) => r.reason)).toEqual(["topic_unavailable", "column_gone"]);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(0);
    expect((await task(created.id)).columnId).toBe(w.made.todo.id);
  });

  it("a rule touches no reward: a task that carries one is left alone entirely, and the log says why", async () => {
    const w = await world();
    const id = await mustAdd(w, rule({ actions: [{ type: "SET_PRIORITY", priority: "LOW" }, { type: "ADD_STEP", title: "x" }] }));
    const t = await plainTask(w);
    await db.task.update({ where: { id: t.id }, data: { rewardStatus: "OPEN", rewardAmountMinor: 5000, rewardCurrency: "JOD" } });
    await fireTaskRules({ trigger: "CREATED", taskId: t.id });
    const after = await task(t.id);
    expect(after).toMatchObject({ priority: "NORMAL", rewardStatus: "OPEN", rewardAmountMinor: 5000, rewardCurrency: "JOD" });
    expect(await db.taskStep.count({ where: { taskId: t.id } })).toBe(0);
    const [run] = await runsOf(id);
    expect(run!.status).toBe("SKIPPED");
    expect(results(run!).every((r) => r.reason === "reward_task")).toBe(true);
  });

  it("a rule's failure never fails the person's own action, and a rule on a task that was deleted leaves no half row", async () => {
    const w = await world();
    await mustAdd(w, rule({ actions: [{ type: "ASSIGN", userId: w.colleague.id }] }));
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId: w.colleague.id } } });
    const created = await newTask(w, { assigneeId: w.member.id });
    expect((await task(created.id)).assigneeId).toBe(w.member.id);
    await db.task.delete({ where: { id: created.id } });
    await fireTaskRules({ trigger: "CREATED", taskId: created.id });
    expect(await db.taskRuleRun.count({ where: { taskId: created.id } })).toBe(1);
  });
});

describe("«القواعد التلقائية»: pause, the log, and the company's switch", () => {
  it("a paused rule does nothing and logs nothing; resumed, it acts on the next event; the person who resumes is who it runs as", async () => {
    const w = await world();
    const id = await mustAdd(w, rule());
    await loginAs(w.admin.id);
    expect((await call(ruleRoute.PATCH, { method: "PATCH", params: RID(w, id), body: { active: false } })).status).toBe(200);
    await newTask(w);
    expect(await runsOf(id)).toHaveLength(0);
    await loginAs(w.owner.id);
    expect((await call(ruleRoute.PATCH, { method: "PATCH", params: RID(w, id), body: { active: true } })).status).toBe(200);
    expect((await db.taskRule.findUniqueOrThrow({ where: { id } })).runAsId).toBe(w.owner.id);
    await newTask(w);
    const [run] = await runsOf(id);
    expect(run).toMatchObject({ status: "APPLIED", runAsId: w.owner.id });
  });

  it("the log is append-only: deleting or editing a rule keeps what it did, and the log lists newest first with who, which rule and which task", async () => {
    const w = await world();
    const id = await mustAdd(w, rule({ name: "الأولى" }));
    const t1 = await newTask(w, { title: "الأولى" });
    const t2 = await newTask(w, { title: "الثانية" });
    await loginAs(w.admin.id);
    await call(ruleRoute.PATCH, { method: "PATCH", params: RID(w, id), body: rule({ name: "اسم مختلف" }) });
    expect((await call(ruleRoute.DELETE, { method: "DELETE", params: RID(w, id) })).status).toBe(200);
    const listed = (await call(rulesRoute.GET, { params: PID(w) })).json as { rules: unknown[] };
    expect(listed.rules).toHaveLength(0);
    const log = ((await call(logRoute.GET, { params: PID(w) })).json as { runs: { taskId: string; ruleName: string; runAsName: string; status: string; taskTitle: string; createdAt: string }[] }).runs;
    expect(log.map((r) => r.taskId)).toEqual([t2.id, t1.id]);
    // a snapshot: the rule was renamed and deleted afterwards, the history still says what it was
    expect(log.every((r) => r.ruleName === "الأولى" && r.runAsName === "Admin" && r.status === "APPLIED")).toBe(true);
    expect(log.map((r) => r.taskTitle)).toEqual(["الثانية", "الأولى"]);
    // a deleted rule does not run any more
    await newTask(w);
    expect(await db.taskRuleRun.count({ where: { ruleId: id } })).toBe(2);
    // the page of the log: `before` walks back
    const newest = ((await call(logRoute.GET, { params: PID(w), url: "http://localhost/api/test?limit=1" })).json as { runs: { taskId: string }[] }).runs;
    expect(newest.map((r) => r.taskId)).toEqual([t2.id]);
    const older = ((await call(logRoute.GET, { params: PID(w), url: `http://localhost/api/test?limit=5&before=${encodeURIComponent(log[0]!.createdAt)}` })).json as { runs: { taskId: string }[] }).runs;
    expect(older.map((r) => r.taskId)).toEqual([t1.id]);
  });

  it("the switch off: every door answers «not found», no rule runs, nothing is lost; on again, it all comes back", async () => {
    const w = await world();
    const id = await mustAdd(w, rule());
    await setSwitch(w, false);
    await loginAs(w.admin.id);
    expect((await call(rulesRoute.GET, { params: PID(w) })).status).toBe(404);
    expect((await call(rulesRoute.POST, { params: PID(w), body: rule() })).status).toBe(404);
    expect((await call(logRoute.GET, { params: PID(w) })).status).toBe(404);
    expect((await call(ruleRoute.PATCH, { method: "PATCH", params: RID(w, id), body: { active: false } })).status).toBe(404);
    await newTask(w);
    expect(await runsOf(id)).toHaveLength(0);
    expect(await fireOverdueRules(new Date(Date.now() + 86_400_000))).toEqual({ fired: 0 });
    expect(await db.taskRule.count({ where: { id, deletedAt: null, active: true } })).toBe(1);
    await setSwitch(w, true);
    expect((await call(rulesRoute.GET, { params: PID(w) })).status).toBe(200);
    await newTask(w);
    expect(await runsOf(id)).toHaveLength(1);
  });

  it("deleting the project deletes its rules and their log with it", async () => {
    const w = await world();
    const id = await mustAdd(w, rule());
    await newTask(w);
    expect(await runsOf(id)).toHaveLength(1);
    await db.project.delete({ where: { id: w.made.project.id } });
    expect(await db.taskRule.count({ where: { id } })).toBe(0);
    expect(await db.taskRuleRun.count({ where: { ruleId: id } })).toBe(0);
  });
});
