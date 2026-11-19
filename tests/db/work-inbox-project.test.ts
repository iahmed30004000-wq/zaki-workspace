/**
 * W1.2 — «صندوق المهام» (docs/restructure/W1-work.md §W1.2, D-N3): the per-space hidden «مهام فورية» project becomes a
 * visible, named, pinned inbox (same `systemKey`, same service). A quick task from anywhere lands in it, in «للتنفيذ».
 * «الشركة» holds none: a quick task made there lands in the inbox of the person's first STANDARD space; with none the
 * quick add says why. A quick task with an assignee is «المعنيين بس». Behind the switch `workInbox` (off by default).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { createElement } from "react";
import ProjectsPage from "@/app/(app)/projects/page";
import * as instantRoute from "@/app/api/instant/route";
import * as instantTaskRoute from "@/app/api/instant/task/route";
import * as inboxRoute from "@/app/api/instant/inbox/route";
import * as chatTaskRoute from "@/app/api/chat/messages/[id]/task/route";
import * as taskGet from "@/app/api/tasks/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import { QuickAddForm, QuickAddSheet, TodayQuickAdd } from "@/components/today/quick-add";
import { getServerT } from "@/lib/i18n/server";
import { AR } from "@/lib/i18n/dict";
import { quickInboxBody, WORK_INBOX_REF, type TodayQuickAddData } from "@/lib/today";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { INSTANT_PROJECT_KEY } from "@/server/services/instant-work";
import { messageToTask } from "@/server/chat/make-work";
import { requireWorkspace } from "@/server/auth";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { html } from "./pages-access-helpers";

const { t } = getServerT();
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
afterEach(() => jar().delete(SPACE_COOKIE));

const OLD_NAME = "مهام فورية";
const INBOX_NAME = "صندوق المهام";

async function world(opts: { on?: boolean } = {}) {
  const t0 = await makeTeam();
  const ws = await makeWorkspace(t0.org.id, [{ userId: t0.admin.id, role: "ADMIN" }, { userId: t0.member.id }], "Alpha");
  jar().set(SPACE_COOKIE, ws.id);
  if (opts.on !== false) await db.organization.update({ where: { id: t0.org.id }, data: { settings: { features: { workInbox: true } } } });
  return { ...t0, ws };
}
type World = Awaited<ReturnType<typeof world>>;

/** «الشركة»: the person is in it (and in whatever else they were put in). */
async function hq(w: World, userIds: string[]) {
  return db.workspace.create({
    data: { organizationId: w.org.id, name: "الشركة", slug: `hq-${w.org.id}`, systemKey: "hq", kind: "HQ", members: { create: userIds.map((userId) => ({ userId })) } },
  });
}

const quick = (body: unknown) => call(inboxRoute.POST, { body });
const inboxOf = (spaceId: string) => db.project.findUnique({ where: { workspaceId_systemKey: { workspaceId: spaceId, systemKey: INSTANT_PROJECT_KEY } }, include: { boards: { include: { columns: { orderBy: { position: "asc" } } } } } });

describe("the switch workInbox", () => {
  it("is off by default: the quick door answers «not found» and nothing is made", async () => {
    const w = await world({ on: false });
    await loginAs(w.member.id);
    const res = await quick({ title: "x" });
    expect(res.status).toBe(404);
    expect(await inboxOf(w.ws.id)).toBeNull();
    // and the info says there is no inbox
    expect((await call(instantRoute.GET)).json?.["inbox"]).toBeNull();
  });
});

describe("a quick task lands in «صندوق المهام» of the space, in «للتنفيذ»", () => {
  it("makes the project once, named «صندوق المهام», assigned to the person, due as asked, in the second column", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await quick({ title: "اتصل بالمورّد", dueDate: "2026-11-20" });
    expect(res.status).toBe(201);
    const id = (res.json?.["task"] as { id: string }).id;
    const task = await db.task.findUniqueOrThrow({ where: { id }, include: { project: true, column: true } });
    expect(task).toMatchObject({ assigneeId: w.member.id, creatorId: w.member.id, workspaceId: w.ws.id });
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
    expect(task.project.name).toBe(INBOX_NAME);
    expect(task.column.position).toBe(1);
    expect(task.column.done).toBe(false);
    expect(task.dueDate).not.toBeNull();

    await quick({ title: "تانية" });
    expect(await db.project.count({ where: { workspaceId: w.ws.id, systemKey: INSTANT_PROJECT_KEY } })).toBe(1);
    expect(await db.task.count({ where: { projectId: task.projectId } })).toBe(2);
  });

  it("an existing hidden «مهام فورية» keeps its id and its tasks and takes the new name; a name the owner chose is kept", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const first = await call(instantTaskRoute.POST, { body: { title: "قبل", assigneeId: w.member.id } });
    const old = await inboxOf(w.ws.id);
    expect(old).not.toBeNull();
    await db.project.update({ where: { id: old!.id }, data: { name: OLD_NAME } });
    await loginAs(w.member.id);
    await quick({ title: "بعد" });
    const now = await inboxOf(w.ws.id);
    expect(now?.id).toBe(old!.id);
    expect(now?.name).toBe(INBOX_NAME);
    expect(await db.task.count({ where: { projectId: old!.id } })).toBe(2);
    expect(await db.task.findUnique({ where: { id: (first.json?.["task"] as { id: string }).id } })).not.toBeNull();

    await db.project.update({ where: { id: old!.id }, data: { name: "مشاريعي الصغيرة" } });
    await quick({ title: "ثالثة" });
    expect((await inboxOf(w.ws.id))?.name).toBe("مشاريعي الصغيرة");
  });

  it("a quick task with an assignee is «المعنيين بس»: another member of the space does not open it", async () => {
    const w = await world();
    const other = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Other" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: other.id } });
    await loginAs(w.member.id);
    const id = ((await quick({ title: "سرّي شوي" })).json?.["task"] as { id: string }).id;
    expect((await db.task.findUniqueOrThrow({ where: { id } })).visibility).toBe("PARTICIPANTS");
    // the «مهمة فورية» form to a person is the same
    const viaForm = ((await call(instantTaskRoute.POST, { body: { title: "لزميلي", assigneeId: w.admin.id } })).json?.["task"] as { id: string }).id;
    expect((await db.task.findUniqueOrThrow({ where: { id: viaForm } })).visibility).toBe("PARTICIPANTS");
    await loginAs(other.id);
    expect((await call(taskGet.GET, { params: { id } })).status).toBe(404);
    await loginAs(w.member.id);
    expect((await call(taskGet.GET, { params: { id } })).status).toBe(200);
  });

  it("with the switch off «مهمة فورية» is as it was: the old name and the space's own default visibility", async () => {
    const w = await world({ on: false });
    await loginAs(w.admin.id);
    const id = ((await call(instantTaskRoute.POST, { body: { title: "قديمة", assigneeId: w.member.id } })).json?.["task"] as { id: string }).id;
    const task = await db.task.findUniqueOrThrow({ where: { id }, include: { project: true } });
    expect(task.project.name).toBe(OLD_NAME);
    expect(task.visibility).toBe("SPACE");
  });
});

describe("«الشركة» holds none (D-N3)", () => {
  it("a quick task made while in «الشركة» lands in the inbox of the person's FIRST standard space; nothing is made in «الشركة»", async () => {
    const w = await world();
    const beta = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "Beta");
    const company = await hq(w, [w.member.id]);
    jar().set(SPACE_COOKIE, company.id);
    await loginAs(w.member.id);

    const info = await call(instantRoute.GET);
    expect(info.json?.["inbox"]).toMatchObject({ space: { id: w.ws.id } });
    const res = await quick({ title: "من الشركة" });
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: (res.json?.["task"] as { id: string }).id }, include: { project: true } });
    expect(task.workspaceId).toBe(w.ws.id); // «Alpha» comes before «Beta» by name
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
    expect(await db.project.count({ where: { workspaceId: company.id } })).toBe(0);
    expect(await db.project.count({ where: { workspaceId: beta.id } })).toBe(0);
  });

  it("the «مهمة فورية» form in «الشركة» goes there too, and offers the people of that space", async () => {
    const w = await world();
    const company = await hq(w, [w.member.id, w.admin.id]);
    jar().set(SPACE_COOKIE, company.id);
    await loginAs(w.member.id);
    const info = await call(instantRoute.GET);
    expect(info.json).toMatchObject({ task: true, space: { id: w.ws.id } });
    expect((info.json?.["people"] as { id: string }[]).map((p) => p.id).sort()).toEqual([w.admin.id, w.member.id].sort());
    const res = await call(instantTaskRoute.POST, { body: { title: "للمدير", assigneeId: w.admin.id } });
    expect(res.status).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: (res.json?.["task"] as { id: string }).id } })).workspaceId).toBe(w.ws.id);
    expect(await db.project.count({ where: { workspaceId: company.id } })).toBe(0);
  });

  it("with no standard space the quick add says why («instant.no_space») and nothing is made", async () => {
    const t0 = await makeTeam();
    await db.organization.update({ where: { id: t0.org.id }, data: { settings: { features: { workInbox: true } } } });
    const company = await db.workspace.create({ data: { organizationId: t0.org.id, name: "الشركة", slug: `hq-${t0.org.id}`, systemKey: "hq", kind: "HQ", members: { create: [{ userId: t0.member.id }] } } });
    jar().set(SPACE_COOKIE, company.id);
    await loginAs(t0.member.id);
    expect((await call(instantRoute.GET)).json?.["inbox"]).toEqual({ space: null, projectId: null });
    const res = await quick({ title: "ما في مكان" });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("instant.no_space");
    expect(await db.project.count({ where: { workspaceId: company.id } })).toBe(0);
    expect(AR["instant.no_space"]).toBe("لسا ما إلك مساحة شغل");
  });

  it("a person with no space at all gets the same answer", async () => {
    const t0 = await makeTeam();
    await db.organization.update({ where: { id: t0.org.id }, data: { settings: { features: { workInbox: true } } } });
    await loginAs(t0.member.id);
    expect((await quick({ title: "x" })).status).toBe(403);
  });
});

describe("where a quick task goes, read first", () => {
  it("GET /api/instant/inbox?workspaceId= tells the inbox project's id (null before the first task), reads only, and is a 404 with the switch off", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const ask = () => call(inboxRoute.GET, { url: `http://localhost/api/instant/inbox?workspaceId=${w.ws.id}` });
    expect((await ask()).json).toEqual({ projectId: null });
    expect(await inboxOf(w.ws.id)).toBeNull(); // asking made nothing
    await quick({ title: "أول" });
    expect((await ask()).json).toEqual({ projectId: (await inboxOf(w.ws.id))!.id });
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { features: { workInbox: false } } } });
    expect((await ask()).status).toBe(404);
  });

  it("a space where the person is only a guest is not where their quick task goes: the first space they may work in is", async () => {
    const w = await world();
    const gamma = await makeWorkspace(w.org.id, [{ userId: w.guest.id }, { userId: w.member.id, role: "GUEST" }], "Aaa guest-only");
    const beta = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "Zzz mine");
    jar().set(SPACE_COOKIE, gamma.id);
    await loginAs(w.member.id);
    const res = await quick({ title: "من مساحة ضيف" });
    expect(res.status).toBe(201);
    const workspaceId = (await db.task.findUniqueOrThrow({ where: { id: (res.json?.["task"] as { id: string }).id } })).workspaceId;
    expect([w.ws.id, beta.id]).toContain(workspaceId);
    expect(workspaceId).not.toBe(gamma.id);
    expect(await db.project.count({ where: { workspaceId: gamma.id } })).toBe(0);
  });
});

describe("«المشاريع» pins the inbox on top and never lists it twice", () => {
  it("the inbox card is drawn once, before the ordinary cards, with its own marker; with the switch off it is an ordinary card as before", async () => {
    const w = await world();
    const { project } = await makeProject(w.ws.id, "مشروع عادي");
    await loginAs(w.member.id);
    await quick({ title: "أول مهمة" });
    const inbox = (await inboxOf(w.ws.id))!;
    await db.project.update({ where: { id: project.id }, data: { updatedAt: new Date(Date.now() + 60_000) } }); // the ordinary one is the newest

    const page = await html(ProjectsPage({ searchParams: {} }));
    expect([...page.matchAll(new RegExp(`href="/projects/${inbox.id}"`, "g"))]).toHaveLength(1);
    expect(page).toContain('data-work-inbox="pinned"');
    expect(page.indexOf(inbox.id)).toBeLessThan(page.indexOf(project.id));
    expect(page).toContain(INBOX_NAME);

    await db.organization.update({ where: { id: w.org.id }, data: { settings: { features: { workInbox: false } } } });
    const off = await html(ProjectsPage({ searchParams: {} }));
    expect([...off.matchAll(new RegExp(`href="/projects/${inbox.id}"`, "g"))]).toHaveLength(1);
    expect(off).not.toContain('data-work-inbox="pinned"');
  });

  it("an old hidden project still named «مهام فورية» is shown with the new name, and the empty state still shows when it is the only one", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    await call(instantTaskRoute.POST, { body: { title: "قديمة", assigneeId: w.member.id } });
    const inbox = (await inboxOf(w.ws.id))!;
    await db.project.update({ where: { id: inbox.id }, data: { name: OLD_NAME } });
    const page = await html(ProjectsPage({ searchParams: {} }));
    expect(page).toContain(INBOX_NAME);
    expect(page).not.toContain(OLD_NAME);
    expect(page).toContain(t("proj.emptyTitle"));
  });
});

describe("«اعمل منها مهمة» without a chosen project lands in the inbox (P0.3 stays)", () => {
  async function chatWorld() {
    const w = await world();
    const orgId = w.org.id;
    const [a, b] = await Promise.all([makeUser({ orgId, role: "MEMBER", name: "A" }), makeUser({ orgId, role: "MEMBER", name: "B" })]);
    await db.workspaceMember.createMany({ data: [{ workspaceId: w.ws.id, userId: a.id }, { workspaceId: w.ws.id, userId: b.id }] });
    const open = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: w.ws.id, title: "Open" } });
    const say = async (userId: string, conversationId: string, body: string) => {
      await loginAs(userId);
      return (await call(messagesRoute.POST, { method: "POST", params: { id: conversationId }, body: { body } })).json?.["id"] as string;
    };
    return { ...w, a, b, open, say };
  }

  it("the service: no project given → the space's inbox, in «للتنفيذ», from an open topic the task stays as the space says", async () => {
    const w = await chatWorld();
    const msg = await w.say(w.a.id, w.open.id, "اطلب العروض");
    await loginAs(w.a.id);
    const ctx = await requireWorkspace(w.ws.id, ["ADMIN", "MEMBER"]);
    const made = await messageToTask(ctx, ctx, msg, { workspaceId: w.ws.id });
    const task = await db.task.findUniqueOrThrow({ where: { id: made.taskId }, include: { project: true, column: true } });
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
    expect(task.column.position).toBe(1);
    expect(task.sourceMessageId).toBe(msg);
  });

  it("a task from an open topic that is given to somebody is «المعنيين بس» in the inbox; with nobody it follows the space's rule", async () => {
    const w = await chatWorld();
    const msg = await w.say(w.a.id, w.open.id, "وزّعها");
    await loginAs(w.a.id);
    const ctx = await requireWorkspace(w.ws.id, ["ADMIN", "MEMBER"]);
    const held = await messageToTask(ctx, ctx, msg, { workspaceId: w.ws.id, assigneeId: w.b.id });
    expect((await db.task.findUniqueOrThrow({ where: { id: held.taskId } })).visibility).toBe("PARTICIPANTS");
    const open = await messageToTask(ctx, ctx, msg, { workspaceId: w.ws.id });
    expect((await db.task.findUniqueOrThrow({ where: { id: open.taskId } })).visibility).toBe("SPACE");
  });

  it("the route with the inbox reference: a DM stays «المعنيين بس» and «المساحة كلها» still needs confirmPublic", async () => {
    const w = await chatWorld();
    await loginAs(w.a.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.b.id } })).json?.["id"] as string;
    const msg = await w.say(w.a.id, dm, "بيني وبينك");
    await loginAs(w.a.id);
    const target = { workspaceId: w.ws.id, projectId: WORK_INBOX_REF, boardId: WORK_INBOX_REF };
    const refused = await call(chatTaskRoute.POST, { method: "POST", params: { id: msg }, body: { ...target, visibility: "SPACE" } });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain("work.confirm_public_required");
    expect(await db.task.count({ where: { sourceMessageId: msg } })).toBe(0);
    const res = await call(chatTaskRoute.POST, { method: "POST", params: { id: msg }, body: target });
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: res.json?.["taskId"] as string }, include: { project: true } });
    expect(task.visibility).toBe("PARTICIPANTS");
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
  });

  it("from a message read in «الشركة» the task lands in the first standard space's inbox, and the person is checked THERE", async () => {
    const w = await chatWorld();
    const company = await hq(w, [w.a.id]);
    const conv = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: company.id, title: "عام" } });
    const msg = await w.say(w.a.id, conv.id, "من الشركة");
    await loginAs(w.a.id);
    const res = await call(chatTaskRoute.POST, { method: "POST", params: { id: msg }, body: { workspaceId: company.id, projectId: WORK_INBOX_REF, boardId: WORK_INBOX_REF } });
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: res.json?.["taskId"] as string }, include: { project: true } });
    expect(task.workspaceId).toBe(w.ws.id);
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
    expect(await db.project.count({ where: { workspaceId: company.id } })).toBe(0);
  });

  it("the inbox reference with the switch off is refused (the dialog never sends it then)", async () => {
    const w = await chatWorld();
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { features: { workInbox: false } } } });
    const msg = await w.say(w.a.id, w.open.id, "x");
    await loginAs(w.a.id);
    const res = await call(chatTaskRoute.POST, { method: "POST", params: { id: msg }, body: { workspaceId: w.ws.id, projectId: WORK_INBOX_REF, boardId: WORK_INBOX_REF } });
    expect(res.status).toBe(404);
    expect(await db.task.count({ where: { sourceMessageId: msg } })).toBe(0);
  });

  it("a real project still works exactly as before", async () => {
    const w = await chatWorld();
    const { project, board } = await makeProject(w.ws.id);
    const msg = await w.say(w.a.id, w.open.id, "عادية");
    await loginAs(w.a.id);
    const res = await call(chatTaskRoute.POST, { method: "POST", params: { id: msg }, body: { workspaceId: w.ws.id, projectId: project.id, boardId: board.id } });
    expect(res.status).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: res.json?.["taskId"] as string } })).projectId).toBe(project.id);
  });
});

// ───────────────────────────────────────── Today's quick add ─────────────────────────────────────────

const DATA: TodayQuickAddData = {
  assigneeId: "u1",
  targets: [{ projectId: "p1", projectName: "مشروع التصميم", workspaceId: "w1", workspaceName: "التصميم", boardId: "b1" }],
  dueToday: "2026-10-22T09:00:00.000Z",
  dueTomorrow: "2026-10-23T09:00:00.000Z",
};

describe("Today's quick add uses the inbox instead of «the first project with a board»", () => {
  it("quickInboxBody: the person's own task, due today by default, no project in it; a blank title sends nothing", () => {
    const now = new Date("2026-10-22T09:00:00.000Z");
    const body = quickInboxBody(DATA, { title: "  اتصل  ", due: "today", timeZone: "Asia/Damascus", now });
    expect(body).toMatchObject({ title: "اتصل", assigneeId: "u1" });
    expect(body).not.toHaveProperty("projectId");
    expect(body).not.toHaveProperty("boardId");
    expect(body?.dueDate).toBeTruthy();
    expect(quickInboxBody(DATA, { title: "x", due: "none", timeZone: "Asia/Damascus" })).not.toHaveProperty("dueDate");
    expect(quickInboxBody(DATA, { title: "   ", due: "today", timeZone: "Asia/Damascus" })).toBeNull();
  });

  it("with the inbox on the typing field is there even with no project at all; the old behaviour stays while it is off", async () => {
    const space = { id: "w1", name: "التصميم" };
    const off = await html(createElement(TodayQuickAdd, { quickAdd: { ...DATA, targets: [] }, timeZone: "UTC", inbox: null }));
    const on = await html(createElement(TodayQuickAdd, { quickAdd: { ...DATA, targets: [] }, timeZone: "UTC", inbox: { space, projectId: null } }));
    expect(off).not.toMatch(/<input\b[^>]*data-tour="quick-add"/);
    expect(on).toMatch(/<input\b[^>]*data-tour="quick-add"/);
  });

  it("with the inbox on but no space the field is replaced by the reason", async () => {
    const markup = await html(createElement(TodayQuickAdd, { quickAdd: { ...DATA, targets: [] }, timeZone: "UTC", inbox: { space: null, projectId: null } }));
    expect(markup).not.toMatch(/<input\b[^>]*data-tour="quick-add"/);
    expect(markup).toContain(AR["instant.no_space"]);
  });

  it("the sheet offers the inbox first and selected, once, then the other projects", async () => {
    const space = { id: "w1", name: "التصميم" };
    const targets = [...DATA.targets, { projectId: "inb", projectName: OLD_NAME, workspaceId: "w1", workspaceName: "التصميم", boardId: "b9" }];
    const form = await html(createElement(QuickAddForm, { quickAdd: { ...DATA, targets }, timeZone: "UTC", onDone: () => {}, inbox: { space, projectId: "inb" } }));
    const options = [...form.matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);
    expect(options).toEqual([
      [WORK_INBOX_REF, INBOX_NAME],
      ["p1", "مشروع التصميم"],
    ]);
    expect(form).toMatch(new RegExp(`<option[^>]*value="${WORK_INBOX_REF}"[^>]*selected`));
    const sheet = await html(createElement(QuickAddSheet, { open: true, onOpenChange: () => {}, quickAdd: { ...DATA, targets: [] }, timeZone: "UTC", portal: false, inbox: { space, projectId: null } }));
    expect(sheet).toContain(INBOX_NAME);
    expect(sheet).not.toContain(t("today.quick.no_target_title"));
  });
});
