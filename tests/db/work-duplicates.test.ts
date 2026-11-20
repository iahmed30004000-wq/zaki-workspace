/**
 * W1.6 — duplicates marked, with a way out (docs/restructure/W1-work.md §W1.6, D-W2): a routine, a campaign item, a ticket and a card each
 * have a conversion to a task, the link is stored (never only in a log), and nothing is deleted. Proven against a real database:
 *   A. «الروتين اليومي»: ONE routine becomes ONE recurring task (a template in the space's inbox, on the routine's weekdays, through the
 *      recurrence service); the routine is ARCHIVED, never deleted, its logs stay readable; a second click makes no second task.
 *   B. a campaign item → «اعمل منه مهمة» (linked both ways);  C. a ticket → «حوّل لمهمة» (a ticket from a private chat is «المعنيين بس»,
 *      and making it public needs confirmPublic on the server);  D. a card → the link is stored on the task.
 *   E. who sees the link: a reader who may not open the task learns only that a link exists, never its title.
 *   F. the banners on the screens.
 */
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

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

import ProductionPage from "@/app/(app)/production/page";
import * as convertRoutine from "@/app/api/production/routines/[id]/convert/route";
import * as routinesRoute from "@/app/api/production/routines/route";
import * as routineRoute from "@/app/api/production/routines/[id]/route";
import * as checklistRoute from "@/app/api/production/route";
import * as campaignItemTask from "@/app/api/production/campaign-items/[id]/task/route";
import * as ticketTask from "@/app/api/tickets/[id]/task/route";
import * as ticketDetail from "@/app/api/tickets/[id]/detail/route";
import * as campaignRoute from "@/app/api/campaigns/[id]/route";
import * as taskSource from "@/app/api/production/task-source/[taskId]/route";
import * as cardTask from "@/app/api/cards/[id]/task/route";
import * as cardLinks from "@/app/api/cards/[id]/links/route";
import * as taskDoor from "@/app/api/tasks/[id]/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { TaskSourcesView } from "@/components/task-detail";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { INSTANT_PROJECT_KEY } from "@/server/services/instant-work";
import { AR } from "@/lib/i18n/dict";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { makeCampaign, makeCampaignItem, makeDepartment, makeTicket } from "./guest-helpers";
import { html } from "./pages-access-helpers";

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

async function features(orgId: string, on: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  const settings = (org.settings ?? {}) as { features?: Record<string, boolean> };
  await db.organization.update({ where: { id: orgId }, data: { settings: { ...settings, features: { ...(settings.features ?? {}), ...on } } } });
}

/** One company: «Alpha» holds the admin, the member and a peer; the department holds `deptMember` and `peer`. */
async function world(opts: { inbox?: boolean } = {}) {
  const t0 = await makeTeam();
  const orgId = t0.org.id;
  const peer = await makeUser({ orgId, role: "MEMBER", name: "Peer" });
  const bystander = await makeUser({ orgId, role: "MEMBER", name: "Bystander" });
  const deptMember = await makeUser({ orgId, role: "MEMBER", name: "DeptMember" });
  const ws = await makeWorkspace(
    orgId,
    [{ userId: t0.admin.id, role: "ADMIN" }, { userId: t0.member.id }, { userId: peer.id }, { userId: bystander.id }, { userId: deptMember.id }],
    "Alpha",
  );
  jar().set(SPACE_COOKIE, ws.id);
  if (opts.inbox) await features(orgId, { workInbox: true });
  const dept = await makeDepartment(orgId, { memberIds: [deptMember.id, peer.id] });
  return { ...t0, ws, peer, bystander, deptMember, dept };
}
type World = Awaited<ReturnType<typeof world>>;

const routineIn = (w: World, over: Record<string, unknown> = {}) =>
  db.routine.create({
    data: { orgId: w.org.id, title: "فحص المعدات", description: "كل صباح", assigneeId: w.member.id, weekdays: "1,3", workspaceId: w.ws.id, ...over },
  });
const convert = (id: string) => call(convertRoutine.POST, { method: "POST", params: { id } });
const tasksOf = (orgId: string) => db.task.count({ where: { orgId } });
type Linked = { state: "visible" | "hidden"; id?: string; key?: string; title?: string };
const taskOf = (res: { json: Record<string, unknown> | null }) => res.json?.["task"] as Linked;

// ───────────────────────────── A. the routine ─────────────────────────────
describe("A. «الروتين اليومي» → one recurring task", () => {
  it("ONE routine becomes ONE template task in the space's inbox, on its weekdays, assigned to its assignee; the routine is archived with its logs", async () => {
    const w = await world();
    const routine = await routineIn(w);
    await db.routineLog.create({ data: { routineId: routine.id, day: "2026-11-02", completedById: w.member.id } });
    await loginAs(w.admin.id);

    const res = await convert(routine.id);
    expect(res.status).toBe(201);
    expect(res.json?.["created"]).toBe(true);
    const link = taskOf(res);
    expect(link.state).toBe("visible");
    expect(link.title).toBe("فحص المعدات");

    const task = await db.task.findUniqueOrThrow({ where: { id: link.id! }, include: { project: true, recurrence: true } });
    expect(task).toMatchObject({ title: "فحص المعدات", description: "كل صباح", assigneeId: w.member.id, workspaceId: w.ws.id, creatorId: w.admin.id });
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
    expect(task.recurrence).toMatchObject({ active: true, mode: "SCHEDULE", templateTaskId: task.id });
    expect(task.recurrence!.rule).toMatchObject({ kind: "WEEKLY", days: [1, 3] });
    expect(task.recurrenceId).toBe(task.recurrence!.id);

    // archived, never deleted: the row is there, switched off, and so are its logs
    const after = await db.routine.findUniqueOrThrow({ where: { id: routine.id } });
    expect(after.active).toBe(false);
    expect(after.title).toBe("فحص المعدات");
    expect(await db.routineLog.count({ where: { routineId: routine.id } })).toBe(1);
  });

  it("a routine on every day is a DAILY series", async () => {
    const w = await world();
    const routine = await routineIn(w, { weekdays: "", title: "إغلاق الصندوق" });
    await loginAs(w.admin.id);
    const id = taskOf(await convert(routine.id)).id!;
    const rec = await db.taskRecurrence.findFirstOrThrow({ where: { templateTaskId: id } });
    expect(rec.rule).toMatchObject({ kind: "DAILY" });
  });

  it("is idempotent: a second click makes no second task, no second series, and says so", async () => {
    const w = await world();
    const routine = await routineIn(w);
    await loginAs(w.admin.id);
    const first = await convert(routine.id);
    const before = await tasksOf(w.org.id);
    const [second, third] = await Promise.all([convert(routine.id), convert(routine.id)]);
    for (const res of [second, third]) {
      expect(res.status).toBe(200);
      expect(res.json?.["created"]).toBe(false);
      expect(taskOf(res).id).toBe(taskOf(first).id);
    }
    expect(await tasksOf(w.org.id)).toBe(before);
    expect(await db.taskRecurrence.count({ where: { orgId: w.org.id } })).toBe(1);
  });

  it("a conversion that stopped half way (no series yet) is finished by the next click, on the same task", async () => {
    const w = await world();
    const routine = await routineIn(w);
    await loginAs(w.admin.id);
    const id = taskOf(await convert(routine.id)).id!;
    await db.task.update({ where: { id }, data: { recurrenceId: null } });
    await db.taskRecurrence.deleteMany({ where: { templateTaskId: id } });
    await db.routine.update({ where: { id: routine.id }, data: { active: true } });

    const again = await convert(routine.id);
    expect(again.status).toBe(200);
    expect(taskOf(again).id).toBe(id);
    expect(await db.taskRecurrence.count({ where: { templateTaskId: id } })).toBe(1);
    expect((await db.routine.findUniqueOrThrow({ where: { id: routine.id } })).active).toBe(false);
    expect(await tasksOf(w.org.id)).toBe(1);
  });

  it("a routine with no space goes to the assignee's first STANDARD space; the inbox switch on or off gives the same inbox project", async () => {
    const w = await world({ inbox: true });
    const routine = await routineIn(w, { workspaceId: null });
    await loginAs(w.admin.id);
    const res = await convert(routine.id);
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: taskOf(res).id! }, include: { project: true } });
    expect(task.workspaceId).toBe(w.ws.id);
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
    expect(task.project.name).toBe("صندوق المهام");
  });

  it("nothing is made when the person cannot also set the series in that space (no half result): the routine stays as it was", async () => {
    const w = await world();
    const other = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "Aaa other");
    void other;
    const routine = await routineIn(w, { workspaceId: null });
    // the admin is not in «Aaa other», which is the assignee's first space by name: the series could not be set there
    await loginAs(w.admin.id);
    const res = await convert(routine.id);
    expect([403, 404]).toContain(res.status);
    expect(await tasksOf(w.org.id)).toBe(0);
    expect((await db.routine.findUniqueOrThrow({ where: { id: routine.id } })).active).toBe(true);
  });

  it("an assignee who is not in the space stops it before anything is made", async () => {
    const w = await world();
    const routine = await routineIn(w, { assigneeId: w.guest.id });
    await loginAs(w.admin.id);
    const res = await convert(routine.id);
    expect(res.status).toBe(403);
    expect(await tasksOf(w.org.id)).toBe(0);
    expect((await db.routine.findUniqueOrThrow({ where: { id: routine.id } })).active).toBe(true);
  });

  it("only who manages routines may convert one (a member and a guest get 403); the switch «مهمة متكررة» off closes it too; nothing is made", async () => {
    const w = await world();
    const routine = await routineIn(w);
    for (const who of [w.member, w.guest]) {
      await loginAs(who.id);
      expect((await convert(routine.id)).status).toBe(403);
    }
    await features(w.org.id, { recurringTasks: false });
    await loginAs(w.admin.id);
    expect([403, 404]).toContain((await convert(routine.id)).status);
    expect(await tasksOf(w.org.id)).toBe(0);
    expect((await db.routine.findUniqueOrThrow({ where: { id: routine.id } })).active).toBe(true);
  });

  it("a routine of another company is «not found»", async () => {
    const w = await world();
    const other = await makeTeam();
    const routine = await db.routine.create({ data: { orgId: other.org.id, title: "غريب", weekdays: "" } });
    await loginAs(w.admin.id);
    expect((await convert(routine.id)).status).toBe(404);
  });

  it("with the taskPrivacy default on, the template (it has an assignee) is «المعنيين بس»", async () => {
    const w = await world();
    await features(w.org.id, { taskPrivacy: true });
    const routine = await routineIn(w);
    await loginAs(w.admin.id);
    const id = taskOf(await convert(routine.id)).id!;
    expect((await db.task.findUniqueOrThrow({ where: { id } })).visibility).toBe("PARTICIPANTS");
  });

  it("the archived routine's logs stay readable: the checklist of a day it was ticked shows it as archived; a day with no log does not", async () => {
    const w = await world();
    const routine = await routineIn(w);
    await db.routineLog.create({ data: { routineId: routine.id, day: "2026-11-02", completedById: w.member.id } });
    await loginAs(w.admin.id);
    await convert(routine.id);
    const day = (d: string) => call(checklistRoute.GET, { url: `http://localhost/api/production?day=${d}` });
    const ticked = (await day("2026-11-02")).json?.["items"] as { id: string; archived?: boolean; doneAt: string | null }[];
    expect(ticked.find((i) => i.id === routine.id)).toMatchObject({ archived: true });
    expect(ticked.find((i) => i.id === routine.id)?.doneAt).not.toBeNull();
    const quiet = (await day("2026-11-04")).json?.["items"] as { id: string }[];
    expect(quiet.map((i) => i.id)).not.toContain(routine.id);
    // and the manager's list says it became a task (its link), still listing the routine
    const list = (await call(routinesRoute.GET)).json?.["routines"] as { id: string; active: boolean; convertedTask: Linked | null }[];
    const row = list.find((r) => r.id === routine.id)!;
    expect(row.active).toBe(false);
    expect(row.convertedTask?.state).toBe("visible");
  });

  it("deleting stays what it was (the manager's own button); the conversion never calls it", async () => {
    const w = await world();
    const routine = await routineIn(w);
    await loginAs(w.admin.id);
    await convert(routine.id);
    expect(await db.routine.count({ where: { id: routine.id } })).toBe(1);
    expect(routineRoute.DELETE).toBeTypeOf("function");
  });
});

// ───────────────────────────── B. the campaign item ─────────────────────────────
describe("B. a campaign item → «اعمل منه مهمة»", () => {
  async function campaignWorld(inbox = false) {
    const w = await world({ inbox });
    const campaign = await makeCampaign({ orgId: w.org.id, departmentId: w.dept.id, ownerId: w.deptMember.id, title: "حملة رمضان" });
    const item = await makeCampaignItem(campaign.id, "صوّر المنتج");
    return { ...w, campaign, item };
  }
  const make = (id: string, body: Record<string, unknown> = {}) => call(campaignItemTask.POST, { method: "POST", params: { id }, body });

  it("makes a task through createTask and links both ways (the item holds taskId; the campaign's detail shows it)", async () => {
    const w = await campaignWorld();
    await loginAs(w.deptMember.id);
    const res = await make(w.item.id);
    expect(res.status).toBe(201);
    expect(res.json?.["created"]).toBe(true);
    const link = taskOf(res);
    const task = await db.task.findUniqueOrThrow({ where: { id: link.id! }, include: { project: true } });
    expect(task).toMatchObject({ title: "صوّر المنتج", creatorId: w.deptMember.id, workspaceId: w.ws.id });
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect((await db.campaignItem.findUniqueOrThrow({ where: { id: w.item.id } })).taskId).toBe(task.id);

    const detail = (await call(campaignRoute.GET, { params: { id: w.campaign.id } })).json?.["campaign"] as { items: { id: string; taskId?: unknown; task: Linked | null }[] };
    const row = detail.items.find((i) => i.id === w.item.id)!;
    expect(row.task).toMatchObject({ state: "visible", id: task.id, title: "صوّر المنتج" });
    expect("taskId" in row).toBe(false);
  });

  it("is idempotent: a second click returns the same task and makes none", async () => {
    const w = await campaignWorld();
    await loginAs(w.deptMember.id);
    const first = await make(w.item.id);
    const again = await make(w.item.id);
    expect(again.status).toBe(200);
    expect(again.json?.["created"]).toBe(false);
    expect(taskOf(again).id).toBe(taskOf(first).id);
    expect(await tasksOf(w.org.id)).toBe(1);
  });

  it("the task is the item's: deleting the task clears the link, deleting nothing else; the item can be converted again", async () => {
    const w = await campaignWorld();
    await loginAs(w.deptMember.id);
    const id = taskOf(await make(w.item.id)).id!;
    await db.task.delete({ where: { id } });
    const item = await db.campaignItem.findUniqueOrThrow({ where: { id: w.item.id } });
    expect(item.taskId).toBeNull();
    expect((await make(w.item.id)).status).toBe(201);
  });

  it("a visibility asked for is kept; a person outside the department and not its manager gets 403, a guest 403; nothing is made", async () => {
    const w = await campaignWorld();
    await loginAs(w.bystander.id);
    expect((await make(w.item.id)).status).toBe(403);
    await loginAs(w.guest.id);
    expect((await make(w.item.id)).status).toBe(403);
    expect(await tasksOf(w.org.id)).toBe(0);
    await loginAs(w.deptMember.id);
    const id = taskOf(await make(w.item.id, { visibility: "PARTICIPANTS" })).id!;
    expect((await db.task.findUniqueOrThrow({ where: { id } })).visibility).toBe("PARTICIPANTS");
  });

  it("a campaign owner who may not open the task sees only that a link exists, never its title or id", async () => {
    const w = await campaignWorld();
    // the owner of the campaign is a space member outside the department; the department's member makes a private task
    await db.campaign.update({ where: { id: w.campaign.id }, data: { ownerId: w.bystander.id } });
    await loginAs(w.deptMember.id);
    const link = taskOf(await make(w.item.id, { visibility: "PARTICIPANTS" }));
    await loginAs(w.bystander.id);
    const res = await call(campaignRoute.GET, { params: { id: w.campaign.id } });
    expect(res.status).toBe(200);
    const row = (res.json?.["campaign"] as { items: { id: string; task: Linked | null }[] }).items.find((i) => i.id === w.item.id)!;
    expect(row.task).toEqual({ state: "hidden" });
    expect(res.text).not.toContain(link.id!);
  });

  it("an item of another company is «not found»", async () => {
    const w = await campaignWorld();
    const other = await makeTeam();
    await loginAs(other.admin.id);
    expect((await make(w.item.id)).status).toBe(404);
  });
});

// ───────────────────────────── C. the ticket ─────────────────────────────
describe("C. a ticket → «حوّل لمهمة»", () => {
  async function ticketWorld() {
    const w = await world();
    const ticket = await makeTicket({ orgId: w.org.id, departmentId: w.dept.id, creatorId: w.deptMember.id, title: "الطابعة معطلة" });
    return { ...w, ticket };
  }
  const make = (id: string, body: Record<string, unknown> = {}) => call(ticketTask.POST, { method: "POST", params: { id }, body });
  const detail = async (id: string) => (await call(ticketDetail.GET, { params: { id } })).json?.["ticket"] as { task: Linked | null };

  it("makes a task through createTask, links it (Task.sourceTicketId) and the ticket shows it", async () => {
    const w = await ticketWorld();
    await loginAs(w.deptMember.id);
    const res = await make(w.ticket.id);
    expect(res.status).toBe(201);
    const link = taskOf(res);
    const task = await db.task.findUniqueOrThrow({ where: { id: link.id! }, include: { project: true } });
    expect(task).toMatchObject({ title: "الطابعة معطلة", sourceTicketId: w.ticket.id, creatorId: w.deptMember.id, workspaceId: w.ws.id });
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
    // a ticket is read by its department only: its task starts «المعنيين بس» whatever the company's default is
    expect(task.visibility).toBe("PARTICIPANTS");
    expect((await detail(w.ticket.id)).task).toMatchObject({ state: "visible", id: task.id, title: "الطابعة معطلة" });
  });

  it("a department-only ticket's task is NOT readable by a space member who is no part of it (no leak of the ticket's title or words)", async () => {
    const w = await ticketWorld();
    await db.ticket.update({ where: { id: w.ticket.id }, data: { description: "وصف خاص بالقسم" } });
    await loginAs(w.deptMember.id);
    const id = taskOf(await make(w.ticket.id)).id!;
    expect((await db.task.findUniqueOrThrow({ where: { id } })).visibility).toBe("PARTICIPANTS");
    // `bystander` is in the space, not in the department, no part of the task: «not found», and the task is in no list of theirs
    await loginAs(w.bystander.id);
    expect((await call(taskDoor.GET, { params: { id } })).status).toBe(404);
    const list = await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.ws.id}` });
    expect(list.text).not.toContain(id);
    expect(list.text).not.toContain("الطابعة معطلة");
    expect(list.text).not.toContain("وصف خاص بالقسم");
    // the one who converted it still reads it
    await loginAs(w.deptMember.id);
    expect((await call(taskDoor.GET, { params: { id } })).status).toBe(200);
  });

  it("naming «المساحة كلها» for a ticket that is no private talk is the person's own choice and needs no confirmation", async () => {
    const w = await ticketWorld();
    await loginAs(w.deptMember.id);
    const res = await make(w.ticket.id, { visibility: "SPACE" });
    expect(res.status).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskOf(res).id! } })).visibility).toBe("SPACE");
  });

  it("is idempotent: a second click (or two at once) returns the same task", async () => {
    const w = await ticketWorld();
    await loginAs(w.deptMember.id);
    const [a, b] = await Promise.all([make(w.ticket.id), make(w.ticket.id)]);
    const c = await make(w.ticket.id);
    expect(new Set([taskOf(a).id, taskOf(b).id, taskOf(c).id]).size).toBe(1);
    expect(await tasksOf(w.org.id)).toBe(1);
    expect(c.json?.["created"]).toBe(false);
    expect([a.json?.["created"], b.json?.["created"]].filter(Boolean)).toHaveLength(1);
  });

  it("from a private chat the task is «المعنيين بس»; making it public needs confirmPublic on the server", async () => {
    const w = await ticketWorld();
    await loginAs(w.deptMember.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.peer.id } })).json?.["id"] as string;
    const msg = (await call(messagesRoute.POST, { method: "POST", params: { id: dm }, body: { body: "الطابعة خربانة" } })).json?.["id"] as string;
    await db.ticket.update({ where: { id: w.ticket.id }, data: { sourceMessageId: msg } });

    const refused = await make(w.ticket.id, { visibility: "SPACE" });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain("work.confirm_public_required");
    expect(await tasksOf(w.org.id)).toBe(0);

    const quiet = await make(w.ticket.id);
    expect(quiet.status).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskOf(quiet).id! } })).visibility).toBe("PARTICIPANTS");
  });

  it("publishing such a task later needs confirmPublic too (the task remembers its ticket)", async () => {
    const w = await ticketWorld();
    await loginAs(w.deptMember.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.peer.id } })).json?.["id"] as string;
    const msg = (await call(messagesRoute.POST, { method: "POST", params: { id: dm }, body: { body: "سرّي" } })).json?.["id"] as string;
    await db.ticket.update({ where: { id: w.ticket.id }, data: { sourceMessageId: msg } });
    const id = taskOf(await make(w.ticket.id)).id!;
    const refused = await call(taskDoor.PATCH, { method: "PATCH", params: { id }, body: { visibility: "SPACE" } });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain("work.confirm_public_required");
    expect((await db.task.findUniqueOrThrow({ where: { id } })).visibility).toBe("PARTICIPANTS");
    const ok = await call(taskDoor.PATCH, { method: "PATCH", params: { id }, body: { visibility: "SPACE", confirmPublic: true } });
    expect(ok.status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id } })).visibility).toBe("SPACE");
  });

  it("a confirmed «المساحة كلها» from a private chat is allowed", async () => {
    const w = await ticketWorld();
    await loginAs(w.deptMember.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.peer.id } })).json?.["id"] as string;
    const msg = (await call(messagesRoute.POST, { method: "POST", params: { id: dm }, body: { body: "خاص" } })).json?.["id"] as string;
    await db.ticket.update({ where: { id: w.ticket.id }, data: { sourceMessageId: msg } });
    const res = await make(w.ticket.id, { visibility: "SPACE", confirmPublic: true });
    expect(res.status).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskOf(res).id! } })).visibility).toBe("SPACE");
  });

  it("a ticket reader who may not open the task sees only that a link exists", async () => {
    const w = await ticketWorld();
    await loginAs(w.deptMember.id);
    const link = taskOf(await make(w.ticket.id, { visibility: "PARTICIPANTS" }));
    // `peer` is in the department (reads the ticket) and in the space, but is no part of the private task
    await loginAs(w.peer.id);
    const res = await call(ticketDetail.GET, { params: { id: w.ticket.id } });
    expect(res.status).toBe(200);
    expect((res.json?.["ticket"] as { task: Linked }).task).toEqual({ state: "hidden" });
    expect(res.text).not.toContain(link.id!);
    expect(res.text).not.toContain("task\":{\"state\":\"visible");
  });

  it("who may not read the ticket gets «not found»; a guest gets 403; nothing is made", async () => {
    const w = await ticketWorld();
    await loginAs(w.bystander.id);
    expect((await make(w.ticket.id)).status).toBe(404);
    await loginAs(w.guest.id);
    expect((await make(w.ticket.id)).status).toBe(403);
    expect(await tasksOf(w.org.id)).toBe(0);
  });
});

// ───────────────────────────── D. the card ─────────────────────────────
describe("D. a card → the link is stored on the task", () => {
  it("«حوّلها لمهمة» keeps Task.sourceCardId (healed from the log for a task made before the column), and the card's links list it once", async () => {
    const w = await world();
    const { project, board, todo } = await makeProject(w.ws.id);
    const card = await db.card.create({ data: { orgId: w.org.id, workspaceId: w.ws.id, createdById: w.member.id, kind: "NOTE", title: "ورقة المنتج", position: 1000 } });
    await loginAs(w.member.id);
    const res = await call(cardTask.POST, { method: "POST", params: { id: card.id }, body: { projectId: project.id, boardId: board.id, columnId: todo.id } });
    expect(res.status).toBe(201);
    const taskId = res.json?.["taskId"] as string;

    const links = (await call(cardLinks.GET, { params: { id: card.id } })).json as { tasks: { id: string }[] };
    expect(links.tasks.map((t) => t.id)).toEqual([taskId]);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).sourceCardId).toBe(card.id);

    // a second card never takes the first one's task
    const other = await db.card.create({ data: { orgId: w.org.id, workspaceId: w.ws.id, createdById: w.member.id, kind: "NOTE", title: "ثانية", position: 2000 } });
    const none = (await call(cardLinks.GET, { params: { id: other.id } })).json as { tasks: unknown[] };
    expect(none.tasks).toEqual([]);

    // and the task says where it came from
    const src = await call(taskSource.GET, { params: { taskId } });
    expect(src.status).toBe(200);
    expect(src.json?.["sources"]).toEqual([{ kind: "card", state: "visible", id: card.id, title: "ورقة المنتج", href: `/cards/${card.id}` }]);
  });

  it("the card's links also read the stored column: a task that carries sourceCardId is listed even with no log line", async () => {
    const w = await world();
    const { project, board, todo } = await makeProject(w.ws.id);
    const card = await db.card.create({ data: { orgId: w.org.id, workspaceId: w.ws.id, createdById: w.member.id, kind: "NOTE", title: "بطاقة", position: 1000 } });
    await loginAs(w.member.id);
    const made = await call(cardTask.POST, { method: "POST", params: { id: card.id }, body: { projectId: project.id, boardId: board.id, columnId: todo.id } });
    const taskId = made.json?.["taskId"] as string;
    await db.auditLog.deleteMany({ where: { target: card.id, action: "card.task" } });
    await db.task.update({ where: { id: taskId }, data: { sourceCardId: card.id } });
    const links = (await call(cardLinks.GET, { params: { id: card.id } })).json as { tasks: { id: string }[] };
    expect(links.tasks.map((t) => t.id)).toEqual([taskId]);
  });
});

// ───────────────────────────── E. who sees the source ─────────────────────────────
describe("E. a task shows its source, to those who may read it", () => {
  it("a ticket's source is named to the ticket's readers and hidden (the fact only) from everybody else who may open the task", async () => {
    const w = await world();
    const ticket = await makeTicket({ orgId: w.org.id, departmentId: w.dept.id, creatorId: w.deptMember.id, title: "تذكرة سرّية الاسم" });
    await loginAs(w.deptMember.id);
    // the person opens the task to the whole space (their own choice): the space member outside the department may then open it, but not its ticket
    const id = taskOf(await call(ticketTask.POST, { method: "POST", params: { id: ticket.id }, body: { visibility: "SPACE" } })).id!;

    const read = await call(taskSource.GET, { params: { taskId: id } });
    expect(read.status).toBe(200);
    expect(read.json?.["sources"]).toMatchObject([{ kind: "ticket", state: "visible", title: "تذكرة سرّية الاسم" }]);

    await loginAs(w.bystander.id);
    const hidden = await call(taskSource.GET, { params: { taskId: id } });
    expect(hidden.status).toBe(200);
    expect(hidden.json?.["sources"]).toEqual([{ kind: "ticket", state: "hidden" }]);
    expect(hidden.text).not.toContain("تذكرة سرّية الاسم");
    expect(hidden.text).not.toContain(ticket.id);
  });

  it("a campaign item's source is named to the campaign's people and hidden from the others; a guest gets an empty list", async () => {
    const w = await world();
    const campaign = await makeCampaign({ orgId: w.org.id, departmentId: w.dept.id, ownerId: w.deptMember.id, title: "حملة خاصة" });
    const item = await makeCampaignItem(campaign.id, "بند");
    await loginAs(w.deptMember.id);
    const id = taskOf(await call(campaignItemTask.POST, { method: "POST", params: { id: item.id }, body: {} })).id!;
    expect((await call(taskSource.GET, { params: { taskId: id } })).json?.["sources"]).toMatchObject([{ kind: "campaignItem", state: "visible", title: "حملة خاصة" }]);
    await loginAs(w.bystander.id);
    const hidden = await call(taskSource.GET, { params: { taskId: id } });
    expect(hidden.json?.["sources"]).toEqual([{ kind: "campaignItem", state: "hidden" }]);
    expect(hidden.text).not.toContain("حملة خاصة");
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.guest.id, role: "GUEST" } });
    await loginAs(w.guest.id);
    const guest = await call(taskSource.GET, { params: { taskId: id } });
    expect(guest.status).toBe(200);
    expect(guest.json?.["sources"]).toEqual([]);
  });

  it("a task the person may not open is «not found» here too", async () => {
    const w = await world();
    const ticket = await makeTicket({ orgId: w.org.id, departmentId: w.dept.id, creatorId: w.deptMember.id });
    await loginAs(w.deptMember.id);
    const id = taskOf(await call(ticketTask.POST, { method: "POST", params: { id: ticket.id }, body: { visibility: "PARTICIPANTS" } })).id!;
    await loginAs(w.bystander.id);
    expect((await call(taskSource.GET, { params: { taskId: id } })).status).toBe(404);
  });
});

// ───────────────────────────── F. the banners ─────────────────────────────
describe("F. the marks on the screens", () => {
  it("«الروتين اليومي» shows ⚠️ «هاد مكرّر مع المهام المتكررة» and 🔧 «حوّل الروتين لمهام متكررة» to everybody who may open it", async () => {
    const w = await world();
    for (const who of [w.admin, w.member]) {
      await loginAs(who.id);
      const page = await html(ProductionPage());
      expect(page).toContain("⚠️");
      expect(page).toContain("هاد مكرّر مع المهام المتكررة");
      expect(page).toContain("🔧");
      expect(page).toContain("حوّل الروتين لمهام متكررة");
    }
  });

  it("the strings exist in the dictionary, in Arabic only", () => {
    for (const key of ["prod.dup.warn", "prod.dup.fix", "prod.dup.convert", "work.convert.task_item", "work.convert.task_ticket", "work.source.hidden"]) {
      expect(AR[key], key).toBeTruthy();
      expect(AR[key], key).not.toMatch(/[A-Za-z]/);
    }
  });

  it("the task's source line names a visible source with its link and says only «في مهمة مرتبطة» for a hidden one", () => {
    const view = (sources: Parameters<typeof TaskSourcesView>[0]["sources"]) => html(createElement(TaskSourcesView, { sources }));
    return Promise.all([
      view([{ kind: "ticket", state: "visible", id: "t1", key: "ZK-T1", title: "طابعة", href: "/tickets" }]),
      view([{ kind: "ticket", state: "hidden" }]),
    ]).then(([shown, hidden]) => {
      expect(shown).toContain("طابعة");
      expect(shown).toContain('href="/tickets"');
      expect(hidden).toContain(AR["work.source.hidden"]);
      expect(hidden).not.toContain("طابعة");
      expect(hidden).not.toContain("href=");
    });
  });
});
