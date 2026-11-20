import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// The page calls notFound() and its rows call useRouter(); no running Next app is needed here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/my-work/stale",
}));

(globalThis as { React?: typeof React }).React = React;

import StalePage from "@/app/(app)/my-work/stale/page";
import * as staleRoute from "@/app/api/work/stale/route";
import { TaskRow, type RowTask } from "@/components/task-row";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { requireActor } from "@/server/policy/actor";
import { openTasksPerPerson, staleListFor } from "@/server/services/stale-tasks";
import { DEFAULT_STALE_PARAMS, type StaleView, type SweepResult } from "@/lib/work/stale";
import { withFeature } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { approvalsWorld, jar } from "./approvals-helpers";
import { html } from "./pages-access-helpers";
import { call, db, loginAs, makeProject, makeTask, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * W1.9 «مهام قديمة»: the review list of open tasks nobody touched for N days, for the owner and the people who run a space, with four bulk actions
 * (سكّريها · عيّني مسؤول · أجّليها لتاريخ · أرشفيها) that go through `moveTask` / `updateTask`. Judged per task, nothing deleted, a log line per change,
 * hidden tasks neither listed nor counted, «آلي» (Task.apiTokenId) marked and counted apart.
 */

afterEach(() => jar().delete(SPACE_COOKIE));

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function setFeatures(orgId: string, features: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let settings: Record<string, unknown> = { ...((org.settings as Record<string, unknown> | null) ?? {}) };
  for (const [key, on] of Object.entries(features)) settings = withFeature(settings, key as never, on);
  await db.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
}

/** The approvals company (owner, admin = ADMIN of `ws`, lead, member, member2, guest; `other` has neither admin nor lead) with «مهام قديمة» on. */
async function world(opts: { on?: boolean } = {}) {
  const w = await approvalsWorld();
  await setFeatures(w.orgId, { workStaleSweep: opts.on !== false });
  const made = await makeProject(w.ws.id, "مشروع أ");
  const second = await makeProject(w.ws.id, "مشروع ب");
  /** An open task of `ws`, last touched `idle` days ago (a comment or log line can still make it younger). */
  const task = async (over: { creatorId?: string; assigneeId?: string | null; title?: string; idle?: number; project?: typeof made } = {}) => {
    const p = over.project ?? made;
    const row = await makeTask({
      orgId: w.orgId,
      workspaceId: w.ws.id,
      projectId: p.project.id,
      boardId: p.board.id,
      columnId: p.todo.id,
      creatorId: over.creatorId ?? w.member.id,
      assigneeId: over.assigneeId === undefined ? w.member.id : over.assigneeId,
      title: over.title ?? `T ${uid()}`,
    });
    return age(row.id, over.idle ?? 20);
  };
  const age = async (id: string, idle: number) => db.task.update({ where: { id }, data: { updatedAt: ago(idle) } });
  return { ...w, ...made, second, task, age };
}
type World = Awaited<ReturnType<typeof world>>;

async function list(person: { id: string }, query = "") {
  await loginAs(person.id);
  const res = await call(staleRoute.GET, { url: `http://localhost/api/work/stale${query ? `?${query}` : ""}` });
  return { status: res.status, view: res.json as unknown as StaleView, message: res.json?.["message"] as string | undefined };
}
async function sweep(person: { id: string }, body: Record<string, unknown>) {
  await loginAs(person.id);
  const res = await call(staleRoute.POST, { body });
  return { status: res.status, result: res.json as unknown as SweepResult, message: res.json?.["message"] as string | undefined, details: res.json?.["details"] as { message: string }[] | undefined };
}
const ids = (view: StaleView) => view.people.flatMap((p) => p.projects.flatMap((g) => g.tasks.map((t) => t.id)));
const row = (result: SweepResult, id: string) => result.results.find((r) => r.taskId === id);

describe("the switch and the door", () => {
  it("OFF (the default): the route answers 404 for everybody, the owner included, and the page is not found; ON: the owner and a space manager get the list", async () => {
    const w = await world({ on: false });
    for (const person of [w.owner, w.admin, w.member]) expect((await list(person)).status, person.id).toBe(404);
    expect((await sweep(w.owner, { action: "archive", taskIds: ["x"] })).status).toBe(404);
    await loginAs(w.owner.id);
    await expect(StalePage({ searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    await setFeatures(w.orgId, { workStaleSweep: true });
    for (const person of [w.owner, w.admin]) expect((await list(person)).status, person.id).toBe(200);
  });

  it("a guest gets guest.no_access, and a person who manages no space gets stale.managers_only: on the list AND on every action", async () => {
    const w = await world();
    const mine = await w.task();
    const guest = await list(w.guest);
    expect(guest.status).toBe(403);
    expect(guest.message).toBe("guest.no_access");
    for (const person of [w.member, w.lead, w.member2, w.outsider]) {
      const res = await list(person);
      expect(res.status, person.id).toBe(403);
      expect(res.message).toBe("stale.managers_only");
      const acted = await sweep(person, { action: "archive", taskIds: [mine.id] });
      expect(acted.status, person.id).toBe(403);
      expect(acted.message).toBe("stale.managers_only");
    }
    expect((await sweep(w.guest, { action: "archive", taskIds: [mine.id] })).message).toBe("guest.no_access");
    expect((await db.task.findUniqueOrThrow({ where: { id: mine.id } })).archived).toBe(false);
  });

  it("the page: a guest gets the notice, a plain member the managers-only line, a manager the list with its title", async () => {
    const w = await world();
    const t = await w.task({ title: "مهمة منسية" });
    await loginAs(w.guest.id);
    expect(await html(StalePage({ searchParams: {} }))).toContain(AR["guest.no_access"]!);
    await loginAs(w.member.id);
    expect(await html(StalePage({ searchParams: {} }))).toContain(AR["stale.managers_only"]!);
    await loginAs(w.admin.id);
    const page = await html(StalePage({ searchParams: {} }));
    expect(page).toContain(AR["stale.title"]!);
    expect(page).toContain("مهمة منسية");
    expect(page).toContain(t.id);
  });
});

describe("what is «قديمة»", () => {
  it("open and untouched for 14 days by default: younger, finished and archived tasks are not on the list; N is the person's choice", async () => {
    const w = await world();
    const old20 = await w.task({ idle: 20 });
    const old40 = await w.task({ idle: 40 });
    const young = await w.task({ idle: 5 });
    const done = await w.task({ idle: 30 });
    await db.task.update({ where: { id: done.id }, data: { completedAt: ago(25), columnId: w.done.id, updatedAt: ago(30) } });
    const archived = await w.task({ idle: 30 });
    await db.task.update({ where: { id: archived.id }, data: { archived: true, updatedAt: ago(30) } });
    const view = (await list(w.admin)).view;
    expect(view.days).toBe(14);
    expect(ids(view).sort()).toEqual([old20.id, old40.id].sort());
    expect(view.total).toBe(2);
    expect(ids((await list(w.admin, "days=30")).view)).toEqual([old40.id]);
    expect(ids((await list(w.admin, "days=3")).view).sort()).toEqual([old20.id, old40.id, young.id].sort());
    // a nonsense value is the default, never an error
    expect((await list(w.admin, "days=zzz")).view.days).toBe(14);
    expect((await list(w.admin, "days=0")).view.days).toBe(1);
    expect((await list(w.admin, "days=99999")).view.days).toBe(365);
  });

  it("a recent comment or log line is a touch: the task is not old even when its row was last edited long ago", async () => {
    const w = await world();
    const commented = await w.task({ idle: 30 });
    const logged = await w.task({ idle: 30 });
    const quiet = await w.task({ idle: 30 });
    await db.taskComment.create({ data: { taskId: commented.id, authorId: w.member.id, body: "أي جديد؟" } });
    await db.taskActivity.create({ data: { taskId: logged.id, actorId: w.member.id, event: "task.updated", meta: { fields: ["title"] } } });
    expect(ids((await list(w.admin)).view)).toEqual([quiet.id]);
    // and a comment from a month ago does not hide it
    const stale = await w.task({ idle: 30 });
    await db.taskComment.create({ data: { taskId: stale.id, authorId: w.member.id, body: "قديم", createdAt: ago(30) } });
    expect(ids((await list(w.admin)).view)).toContain(stale.id);
  });

  it("grouped by PERSON and then by PROJECT: the busiest person first, the tasks nobody holds under their own heading, the oldest task first", async () => {
    const w = await world();
    const a1 = await w.task({ assigneeId: w.member.id, project: w, idle: 20 });
    const a2 = await w.task({ assigneeId: w.member.id, project: w, idle: 40 });
    const a3 = await w.task({ assigneeId: w.member.id, project: w.second, idle: 25 });
    const b1 = await w.task({ assigneeId: w.member2.id, project: w, idle: 21 });
    const n1 = await w.task({ assigneeId: null, project: w, idle: 22 });
    const view = (await list(w.admin)).view;
    expect(view.people.map((p) => p.key)).toEqual([w.member.id, "none", w.member2.id]);
    const member = view.people.find((p) => p.userId === w.member.id)!;
    expect(member.stale).toBe(3);
    expect(member.projects.map((g) => g.name)).toEqual(["مشروع أ", "مشروع ب"]);
    expect(member.projects[0]!.tasks.map((t) => t.id)).toEqual([a2.id, a1.id]);
    expect(member.projects[1]!.tasks.map((t) => t.id)).toEqual([a3.id]);
    expect(view.people.find((p) => p.key === "none")).toMatchObject({ userId: null, stale: 1 });
    expect(view.people.find((p) => p.userId === w.member2.id)!.projects[0]!.tasks[0]!.id).toBe(b1.id);
    expect(view.people.find((p) => p.key === "none")!.projects[0]!.tasks[0]!.id).toBe(n1.id);
    expect(view.total).toBe(5);
    expect(view.shown).toBe(5);
    expect(view.truncated).toBe(false);
    // the choices of the bulk bar are the people of the space (never a guest, never a suspended person)
    const names = view.assignable.map((p) => p.id);
    expect(names).toContain(w.member.id);
    expect(names).not.toContain(w.guest.id);
  });

  it("only the spaces the person MANAGES, and only their own company: the owner sees all spaces, a space admin only theirs, another company never", async () => {
    const w = await world();
    const inWs = await w.task();
    const elsewhere = await makeProject(w.other.id);
    const inOther = await makeTask({ orgId: w.orgId, workspaceId: w.other.id, projectId: elsewhere.project.id, boardId: elsewhere.board.id, columnId: elsewhere.todo.id, creatorId: w.outsider.id, assigneeId: w.outsider.id });
    await w.age(inOther.id, 30);
    const foreign = await makeProject(w.foreignWs.id);
    const foreignTask = await makeTask({ orgId: w.foreign.org.id, workspaceId: w.foreignWs.id, projectId: foreign.project.id, boardId: foreign.board.id, columnId: foreign.todo.id, creatorId: w.foreign.member.id });
    await w.age(foreignTask.id, 30);
    const owner = (await list(w.owner)).view;
    expect(ids(owner).sort()).toEqual([inWs.id, inOther.id].sort());
    expect(owner.spaces.map((s) => s.id).sort()).toEqual([w.ws.id, w.other.id].sort());
    const admin = (await list(w.admin)).view;
    expect(ids(admin)).toEqual([inWs.id]);
    expect(admin.spaces.map((s) => s.id)).toEqual([w.ws.id]);
    // the owner may narrow to one space; a space that is not his to manage is ignored
    expect(ids((await list(w.owner, `space=${w.other.id}`)).view)).toEqual([inOther.id]);
    expect(ids((await list(w.admin, `space=${w.other.id}`)).view)).toEqual([inWs.id]);
  });
});

describe("P0.2: a hidden task is neither listed nor counted", () => {
  it("a private task is listed to its space's manager and to the owner who holds silent oversight, and not to a partner without it (not even in the numbers)", async () => {
    const w = await world();
    const open = await w.task({ title: "عامة" });
    const secret = await w.task({ title: "سرّية", assigneeId: w.member2.id });
    await db.task.update({ where: { id: secret.id }, data: { visibility: "PARTICIPANTS", updatedAt: ago(20) } });
    // a partner (OWNER rank) whose silent oversight was taken away
    const partner = await makeUser({ orgId: w.orgId, role: "ADMIN", name: "Partner" });
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: partner.id }, data: { role: "OWNER", primaryOwner: false, revokedCapabilities: ["archive.view"] } });

    for (const reader of [w.admin, w.owner]) {
      const view = (await list(reader)).view;
      expect(ids(view).sort(), reader.id).toEqual([open.id, secret.id].sort());
      expect(view.total).toBe(2);
    }
    const hidden = (await list(partner)).view;
    expect(ids(hidden)).toEqual([open.id]);
    expect(hidden.total).toBe(1);
    expect(hidden.people.reduce((n, p) => n + p.open, 0)).toBe(1);
    expect(JSON.stringify(hidden)).not.toContain("سرّية");
    expect(JSON.stringify(hidden)).not.toContain(secret.id);
    // the same through the service, as the person
    await loginAs(partner.id);
    expect(Object.values(await openTasksPerPerson(await requireActor())).reduce((n, c) => n + c.people, 0)).toBe(1);
    // the partner cannot sweep it either: it answers «not found», like the task's own door
    const acted = await sweep(partner, { action: "archive", taskIds: [secret.id, open.id] });
    expect(row(acted.result, secret.id)).toEqual({ taskId: secret.id, outcome: "refused", error: "task.not_found" });
    expect(row(acted.result, open.id)?.outcome).toBe("done");
    expect((await db.task.findUniqueOrThrow({ where: { id: secret.id } })).archived).toBe(false);
  });
});

describe("«آلي»: a task that came through the door (Task.apiTokenId)", () => {
  async function withAuto(w: World) {
    const token = await db.apiToken.create({
      data: { organizationId: w.orgId, name: "n8n", prefix: `zk_${uid()}`, tokenHash: "x", permissions: ["tasks.write"], workspaceId: w.ws.id, createdById: w.owner.id },
    });
    const human = await w.task({ title: "بشرية", assigneeId: w.member.id });
    const auto = await w.task({ title: "آلية", assigneeId: w.member.id });
    await db.task.update({ where: { id: auto.id }, data: { apiTokenId: token.id, updatedAt: ago(20) } });
    return { human, auto, token };
  }

  it("is marked and counted APART from people's own work by default; can be hidden, or shown alone", async () => {
    const w = await world();
    const { human, auto } = await withAuto(w);
    const all = (await list(w.admin)).view;
    expect(all.auto).toBe("all");
    expect(ids(all).sort()).toEqual([human.id, auto.id].sort());
    const tasks = all.people.flatMap((p) => p.projects.flatMap((g) => g.tasks));
    expect(tasks.find((t) => t.id === auto.id)?.automated).toBe(true);
    expect(tasks.find((t) => t.id === human.id)?.automated).toBe(false);
    const person = all.people.find((p) => p.userId === w.member.id)!;
    // the person's open number is THEIR OWN work; the machine-made task is counted beside it
    expect(person).toMatchObject({ stale: 2, staleAuto: 1, open: 1, openAuto: 1 });
    expect(all.autoTotal).toBe(1);

    const hidden = (await list(w.admin, "auto=hide")).view;
    expect(ids(hidden)).toEqual([human.id]);
    expect(hidden.total).toBe(1);
    expect(hidden.autoTotal).toBe(1);
    // the «open tasks per person» number does not include the machine-made one either way
    expect(hidden.people[0]).toMatchObject({ stale: 1, open: 1, openAuto: 1 });
    const only = (await list(w.admin, "auto=only")).view;
    expect(ids(only)).toEqual([auto.id]);
    expect(only.total).toBe(1);
    expect(JSON.stringify(only)).not.toContain(human.id);
  });

  it("a bad filter value is «all»; the open numbers per person agree with the service", async () => {
    const w = await world();
    await withAuto(w);
    expect((await list(w.admin, "auto=nonsense")).view.auto).toBe("all");
    await loginAs(w.admin.id);
    const counts = await openTasksPerPerson(await requireActor());
    expect(counts[w.member.id]).toEqual({ people: 1, auto: 1 });
  });
});

describe("the four bulk actions go through the existing services, one task at a time", () => {
  it("سكّريها: the task moves to its board's done column and finishes; it writes the move AND the sweep's own line; it leaves the list", async () => {
    const w = await world();
    const a = await w.task();
    const b = await w.task();
    const res = await sweep(w.admin, { action: "close", taskIds: [a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.result).toMatchObject({ action: "close", done: 2, refused: 0, requested: 0 });
    for (const t of [a, b]) {
      const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.columnId).toBe(w.done.id);
      expect(after.completedAt).not.toBeNull();
      const events = (await db.taskActivity.findMany({ where: { taskId: t.id }, orderBy: { createdAt: "asc" } })).map((x) => x.event);
      expect(events).toEqual(expect.arrayContaining(["task.moved", "task.stale_swept"]));
    }
    expect(ids((await list(w.admin)).view)).toEqual([]);
  });

  it("سكّريها: a board with no done column refuses THAT task only (board.no_done_column); the others are closed", async () => {
    const w = await world();
    const bare = await db.project.create({ data: { workspaceId: w.ws.id, name: "بدون إنجاز" } });
    const board = await db.board.create({ data: { projectId: bare.id, name: "B" } });
    const col = await db.boardColumn.create({ data: { boardId: board.id, name: "todo", position: 0 } });
    const stuck = await makeTask({ orgId: w.orgId, workspaceId: w.ws.id, projectId: bare.id, boardId: board.id, columnId: col.id, creatorId: w.member.id });
    await w.age(stuck.id, 30);
    const fine = await w.task();
    const res = await sweep(w.admin, { action: "close", taskIds: [stuck.id, fine.id] });
    expect(row(res.result, stuck.id)).toEqual({ taskId: stuck.id, outcome: "refused", error: "board.no_done_column" });
    expect(row(res.result, fine.id)?.outcome).toBe("done");
    expect(res.result).toMatchObject({ done: 1, refused: 1 });
  });

  it("عيّني مسؤول: a person of the same or a lower rank gets it; a person of a HIGHER rank is ASKED (a request, the task keeps its holder): never a rank bypass", async () => {
    const w = await world();
    const direct = await w.task({ assigneeId: null });
    const upward = await w.task({ assigneeId: w.member.id });
    const res = await sweep(w.admin, { action: "assign", taskIds: [direct.id], assigneeId: w.member2.id });
    expect(row(res.result, direct.id)?.outcome).toBe("done");
    expect((await db.task.findUniqueOrThrow({ where: { id: direct.id } })).assigneeId).toBe(w.member2.id);
    expect(await db.notification.count({ where: { userId: w.member2.id, taskId: direct.id } })).toBe(1);
    // the owner is above the admin: asking, not giving
    const asked = await sweep(w.admin, { action: "assign", taskIds: [upward.id], assigneeId: w.owner.id });
    expect(row(asked.result, upward.id)?.outcome).toBe("requested");
    expect(asked.result).toMatchObject({ done: 0, requested: 1, refused: 0 });
    expect((await db.task.findUniqueOrThrow({ where: { id: upward.id } })).assigneeId).toBe(w.member.id);
    expect(await db.taskAssignRequest.count({ where: { taskId: upward.id, toUserId: w.owner.id, status: "PENDING" } })).toBe(1);
    // asking twice does not stack requests: the second is refused by the service's own rule, with its own sentence
    const again = await sweep(w.admin, { action: "assign", taskIds: [upward.id], assigneeId: w.owner.id });
    expect(row(again.result, upward.id)).toEqual({ taskId: upward.id, outcome: "refused", error: "taskreq.already_pending" });
    expect(await db.taskAssignRequest.count({ where: { taskId: upward.id, status: "PENDING" } })).toBe(1);
    // and the sweep's line says so
    const line = await db.taskActivity.findFirstOrThrow({ where: { taskId: upward.id, event: "task.stale_swept" } });
    expect(line.meta).toMatchObject({ action: "assign", outcome: "requested", to: w.owner.id });
  });

  it("عيّني مسؤول: somebody who is not an active member of the company is refused per task (assignee.not_member / assignee.not_active); without a person the whole call is refused", async () => {
    const w = await world();
    const t = await w.task();
    const foreignPerson = w.foreign.member;
    const res = await sweep(w.admin, { action: "assign", taskIds: [t.id], assigneeId: foreignPerson.id });
    expect(row(res.result, t.id)).toEqual({ taskId: t.id, outcome: "refused", error: "assignee.not_member" });
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.member2.id }, data: { status: "SUSPENDED" } });
    const suspended = await sweep(w.admin, { action: "assign", taskIds: [t.id], assigneeId: w.member2.id });
    expect(row(suspended.result, t.id)?.error).toBe("assignee.not_active");
    const bare = await sweep(w.admin, { action: "assign", taskIds: [t.id] });
    expect(bare.status).toBe(422);
    expect(bare.details?.[0]?.message).toBe("stale.pick_person");
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBe(w.member.id);
  });

  it("أجّليها لتاريخ: the due day is noon in the company's zone, the task is touched (leaves the list); a day in the past is refused as a whole before anything happens", async () => {
    const w = await world();
    const a = await w.task();
    const b = await w.task();
    const future = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
    const res = await sweep(w.admin, { action: "postpone", taskIds: [a.id, b.id], day: future });
    expect(res.result).toMatchObject({ done: 2, refused: 0 });
    for (const t of [a, b]) {
      const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.dueDate).not.toBeNull();
      expect(Math.abs(after.dueDate!.getTime() - Date.parse(`${future}T12:00:00Z`))).toBeLessThan(DAY);
      const line = await db.taskActivity.findFirstOrThrow({ where: { taskId: t.id, event: "task.stale_swept" } });
      expect(line.meta).toMatchObject({ action: "postpone", day: future });
      expect(await db.taskActivity.count({ where: { taskId: t.id, event: "task.updated" } })).toBe(1);
    }
    expect(ids((await list(w.admin)).view)).toEqual([]);

    const c = await w.task();
    const past = new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10);
    const refused = await sweep(w.admin, { action: "postpone", taskIds: [c.id], day: past });
    expect(refused.status).toBe(422);
    expect(refused.details?.[0]?.message).toBe("stale.day_past");
    expect((await sweep(w.admin, { action: "postpone", taskIds: [c.id] })).details?.[0]?.message).toBe("stale.day_required");
    expect((await sweep(w.admin, { action: "postpone", taskIds: [c.id], day: "not-a-day" })).details?.[0]?.message).toBe("stale.day_required");
    expect((await db.task.findUniqueOrThrow({ where: { id: c.id } })).dueDate).toBeNull();
  });

  it("أرشفيها: the Task.archived flag and nothing else: no row is deleted, the task keeps its column and its history, and the sweep writes the line the service does not", async () => {
    const w = await world();
    const a = await w.task();
    const b = await w.task();
    const before = await db.task.count({ where: { orgId: w.orgId } });
    const res = await sweep(w.admin, { action: "archive", taskIds: [a.id, b.id] });
    expect(res.result).toMatchObject({ done: 2, refused: 0 });
    expect(await db.task.count({ where: { orgId: w.orgId } })).toBe(before);
    for (const t of [a, b]) {
      const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(after).toMatchObject({ archived: true, columnId: w.todo.id, completedAt: null });
      expect(await db.taskActivity.count({ where: { taskId: t.id, event: "task.stale_swept" } })).toBe(1);
    }
    expect(ids((await list(w.admin)).view)).toEqual([]);
    // the audit trail has one row for the call
    const audits = await db.auditLog.findMany({ where: { orgId: w.orgId, action: "task.stale_sweep" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ action: "archive", asked: 2, done: 2, refused: 0 });
  });
});

describe("refused PER TASK, never all or nothing, never a rank bypass", () => {
  it("a mixed call: the tasks the person may change happen, each of the others comes back with its own reason", async () => {
    const w = await world();
    const ok1 = await w.task();
    const ok2 = await w.task();
    // a plain member of the company who is ADMIN of `ws` and only a member of a third space: that space is visible to him, not his to manage
    const mgr = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Mgr" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: mgr.id, role: "ADMIN" } });
    const third = await makeWorkspace(w.orgId, [{ userId: mgr.id }, { userId: w.member.id }], "مساحة ثالثة");
    const p3 = await makeProject(third.id);
    const notMine = await makeTask({ orgId: w.orgId, workspaceId: third.id, projectId: p3.project.id, boardId: p3.board.id, columnId: p3.todo.id, creatorId: w.member.id, assigneeId: w.member.id });
    // a space the admin is not in at all
    const elsewhere = await makeProject(w.other.id);
    const invisible = await makeTask({ orgId: w.orgId, workspaceId: w.other.id, projectId: elsewhere.project.id, boardId: elsewhere.board.id, columnId: elsewhere.todo.id, creatorId: w.outsider.id });
    // a task somebody finished while the list was open
    const finished = await w.task();
    await db.task.update({ where: { id: finished.id }, data: { completedAt: new Date(), columnId: w.done.id } });
    // a task of another company
    const foreign = await makeProject(w.foreignWs.id);
    const strange = await makeTask({ orgId: w.foreign.org.id, workspaceId: w.foreignWs.id, projectId: foreign.project.id, boardId: foreign.board.id, columnId: foreign.todo.id, creatorId: w.foreign.member.id });

    const res = await sweep(mgr, { action: "archive", taskIds: [ok1.id, notMine.id, invisible.id, finished.id, strange.id, ok2.id, "no-such-task"] });
    expect(res.status).toBe(200);
    expect(res.result.done).toBe(2);
    expect(res.result.refused).toBe(5);
    expect(row(res.result, ok1.id)?.outcome).toBe("done");
    expect(row(res.result, ok2.id)?.outcome).toBe("done");
    expect(row(res.result, notMine.id)).toEqual({ taskId: notMine.id, outcome: "refused", error: "stale.not_manager" });
    expect(row(res.result, invisible.id)).toEqual({ taskId: invisible.id, outcome: "refused", error: "task.not_found" });
    expect(row(res.result, strange.id)).toEqual({ taskId: strange.id, outcome: "refused", error: "task.not_found" });
    expect(row(res.result, "no-such-task")).toEqual({ taskId: "no-such-task", outcome: "refused", error: "task.not_found" });
    expect(row(res.result, finished.id)).toEqual({ taskId: finished.id, outcome: "refused", error: "stale.not_open" });
    // the refused ones were not touched, and every refusal has a sentence
    for (const t of [notMine, invisible, strange]) expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).archived, t.id).toBe(false);
    expect(await db.taskActivity.count({ where: { taskId: { in: [notMine.id, invisible.id, strange.id, finished.id] }, event: "task.stale_swept" } })).toBe(0);
    for (const r of res.result.results) if (r.error) expect(AR[r.error], r.error).toBeTruthy();
  });

  it("a reward task is the owner's: the admin's sweep is refused for it (reward.owner_only) while the owner's goes through", async () => {
    const w = await world();
    await setFeatures(w.orgId, { taskRewards: true });
    const reward = await w.task();
    await db.task.update({ where: { id: reward.id }, data: { rewardStatus: "OPEN", rewardAmountMinor: 500, rewardCurrency: "JOD", dueDate: ago(-5) } });
    const plain = await w.task();
    for (const action of ["close", "archive"] as const) {
      const res = await sweep(w.admin, { action, taskIds: [reward.id, plain.id] });
      expect(row(res.result, reward.id), action).toEqual({ taskId: reward.id, outcome: "refused", error: "reward.owner_only" });
      if (action === "close") await db.task.update({ where: { id: plain.id }, data: { columnId: w.todo.id, completedAt: null, updatedAt: ago(20) } });
      if (action === "archive") await db.task.update({ where: { id: plain.id }, data: { archived: false, updatedAt: ago(20) } });
    }
    const owner = await sweep(w.owner, { action: "close", taskIds: [reward.id] });
    expect(row(owner.result, reward.id)?.outcome).toBe("done");
  });

  it("a person who lost the «المهام» box is refused per task by the service itself (section.edit_denied), not by a rule of the sweep", async () => {
    const w = await world();
    const t = await w.task();
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.admin.id }, data: { revokedCapabilities: ["tasks.edit"] } });
    const res = await sweep(w.admin, { action: "archive", taskIds: [t.id] });
    expect(res.status).toBe(200);
    expect(row(res.result, t.id)).toEqual({ taskId: t.id, outcome: "refused", error: "section.edit_denied" });
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).archived).toBe(false);
  });

  it("the input's own mistakes are refused as a whole: no tasks, too many, an unknown action", async () => {
    const w = await world();
    const none = await sweep(w.admin, { action: "archive", taskIds: [] });
    expect(none.status).toBe(422);
    const many = await sweep(w.admin, { action: "archive", taskIds: Array.from({ length: 201 }, (_, i) => `t${i}`) });
    expect(many.status).toBe(422);
    expect((await sweep(w.admin, { action: "delete", taskIds: ["x"] })).status).toBe(422);
    expect((await sweep(w.admin, { taskIds: ["x"] })).status).toBe(422);
  });

  it("the same task twice in one call is changed once", async () => {
    const w = await world();
    const t = await w.task();
    const res = await sweep(w.admin, { action: "archive", taskIds: [t.id, t.id] });
    expect(res.result).toMatchObject({ done: 1, refused: 0 });
    expect(await db.taskActivity.count({ where: { taskId: t.id, event: "task.stale_swept" } })).toBe(1);
  });
});

describe("the service reads the same list as the route", () => {
  it("staleListFor for the admin, as the person, equals what the route sends", async () => {
    const w = await world();
    await w.task();
    await loginAs(w.admin.id);
    const view = await staleListFor(await requireActor(), DEFAULT_STALE_PARAMS);
    const route = (await list(w.admin)).view;
    expect(ids(view).sort()).toEqual(ids(route).sort());
    expect(view.total).toBe(route.total);
  });
});

describe("«آلي» on a task row", () => {
  const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
  const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
  const base: RowTask = { id: "t1", key: "ZW-1", title: "مهمة", priority: "NORMAL", dueDate: null, completedAt: null, assigneeId: null, assigneeName: null };
  const draw = (task: RowTask) =>
    renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Toasts, null, createElement("ul", null, createElement(TaskRow, { task, editable: false, timeZone: "Asia/Amman" })))));

  it("a task that came through the door wears the small mark; an ordinary row is byte for byte what it was", () => {
    const plain = draw(base);
    expect(plain).not.toContain(AR["stale.auto.mark"]!);
    const marked = draw({ ...base, automated: true });
    expect(marked).toContain(AR["stale.auto.mark"]!);
    expect(marked).toContain(AR["stale.auto.mark_hint"]!);
    expect(draw({ ...base, automated: false })).toBe(plain);
  });
});
