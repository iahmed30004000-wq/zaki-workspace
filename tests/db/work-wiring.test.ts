import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// The pages call redirect()/notFound() and their rows call useRouter(); no running Next app is needed here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/my-work",
}));

(globalThis as { React?: typeof React }).React = React;

import MyWorkPage from "@/app/(app)/my-work/page";
import ListPage from "@/app/(app)/list/page";
import { automatedTaskIds } from "@/app/(app)/my-work/automated";
import * as projectsRoute from "@/app/api/projects/route";
import * as cardTask from "@/app/api/cards/[id]/task/route";
import { withFeature } from "@/lib/features";
import { requireActor } from "@/server/policy/actor";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { INSTANT_PROJECT_KEY, instantBoard } from "@/server/services/instant-work";
import { approvalsWorld, jar } from "./approvals-helpers";
import { html } from "./pages-access-helpers";
import { call, db, loginAs, makeProject, makeTask, uid } from "./helpers";

/**
 * W1w — the wiring W1.1 to W1.9 left outside their own paths, proven against a real database: «آلي» on the rows of «مهامي»'s old page and of the list (only for
 * what the person may open), the card's link written when the task is made, the inbox project left out of the project pickers, and the shared inbox seam.
 * The pure and rendering parts are in tests/work-wiring.test.ts.
 */

afterEach(() => jar().delete(SPACE_COOKIE));

async function setFeatures(orgId: string, features: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let settings: Record<string, unknown> = { ...((org.settings as Record<string, unknown> | null) ?? {}) };
  for (const [key, on] of Object.entries(features)) settings = withFeature(settings, key as never, on);
  await db.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
}

async function world() {
  const w = await approvalsWorld();
  const made = await makeProject(w.ws.id, "مشروع أ");
  const token = await db.apiToken.create({
    data: { organizationId: w.orgId, name: "n8n", prefix: `zk_${uid()}`, tokenHash: "x", permissions: ["tasks.write"], workspaceId: w.ws.id, createdById: w.owner.id },
  });
  const task = (over: Partial<Parameters<typeof makeTask>[0]> = {}) =>
    makeTask({ orgId: w.orgId, workspaceId: w.ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId: w.owner.id, ...over });
  return { ...w, ...made, token, task };
}
type World = Awaited<ReturnType<typeof world>>;

const DAY = 86_400_000;
const marks = (markup: string) => (markup.match(/data-auto-mark/g) ?? []).length;

async function withBoth(w: World) {
  const human = await w.task({ title: "مهمة بشرية", assigneeId: w.member.id, dueDate: new Date(Date.now() - 3 * DAY) });
  const auto = await w.task({ title: "مهمة آلية", assigneeId: w.member.id, dueDate: new Date(Date.now() - 3 * DAY) });
  await db.task.update({ where: { id: auto.id }, data: { apiTokenId: w.token.id } });
  return { human, auto };
}

describe("W1.9: «آلي» is drawn where the rows of the old screens are built", () => {
  it("the old «مهامي» page marks the task that came through the door, and only that one", async () => {
    const w = await world();
    await setFeatures(w.orgId, { workMyTasks: false });
    await withBoth(w);
    await loginAs(w.member.id);
    const markup = await html(MyWorkPage({ searchParams: { tab: "overdue" } }));
    expect(markup).toContain("مهمة آلية");
    expect(markup).toContain("مهمة بشرية");
    expect(marks(markup)).toBe(1);
  });

  it("the list page marks it too", async () => {
    const w = await world();
    await setFeatures(w.orgId, { workMyTasks: false });
    await withBoth(w);
    await loginAs(w.member.id);
    const markup = await html(ListPage({ searchParams: {} }));
    expect(markup).toContain("مهمة آلية");
    expect(markup).toContain("مهمة بشرية");
    expect(marks(markup)).toBe(1);
  });

  it("with no automated task a page is byte for byte without the mark", async () => {
    const w = await world();
    await setFeatures(w.orgId, { workMyTasks: false });
    await w.task({ title: "بشرية فقط", assigneeId: w.member.id, dueDate: new Date(Date.now() - 3 * DAY) });
    await loginAs(w.member.id);
    expect(marks(await html(MyWorkPage({ searchParams: { tab: "overdue" } })))).toBe(0);
    expect(marks(await html(ListPage({ searchParams: {} })))).toBe(0);
  });

  it("the helper answers only for tasks the person may open (P0.2): a private task of somebody else is not named", async () => {
    const w = await world();
    const { auto } = await withBoth(w);
    const secret = await w.task({ title: "سرية آلية", assigneeId: w.member2.id });
    await db.task.update({ where: { id: secret.id }, data: { apiTokenId: w.token.id, visibility: "PARTICIPANTS" } });

    await loginAs(w.member.id);
    let actor = await requireActor();
    expect([...(await automatedTaskIds(actor, [auto.id, secret.id]))]).toEqual([auto.id]);

    await loginAs(w.member2.id);
    actor = await requireActor();
    expect([...(await automatedTaskIds(actor, [auto.id, secret.id]))].sort()).toEqual([auto.id, secret.id].sort());
    // nothing asked, nothing read
    expect((await automatedTaskIds(actor, [])).size).toBe(0);
  });

  it("another company's task is never named, whatever id is asked", async () => {
    const w = await world();
    const foreignProject = await makeProject(w.foreignWs.id, "غريب");
    const foreign = await makeTask({
      orgId: w.foreign.org.id,
      workspaceId: w.foreignWs.id,
      projectId: foreignProject.project.id,
      boardId: foreignProject.board.id,
      columnId: foreignProject.todo.id,
      creatorId: w.foreign.owner.id,
    });
    const foreignToken = await db.apiToken.create({
      data: { organizationId: w.foreign.org.id, name: "x", prefix: `zk_${uid()}`, tokenHash: "x", permissions: ["tasks.write"], workspaceId: w.foreignWs.id, createdById: w.foreign.owner.id },
    });
    await db.task.update({ where: { id: foreign.id }, data: { apiTokenId: foreignToken.id } });
    await loginAs(w.member.id);
    expect((await automatedTaskIds(await requireActor(), [foreign.id])).size).toBe(0);
  });
});

describe("W1.6: a task made from a card carries its card from the first moment", () => {
  it("cardToTask writes Task.sourceCardId itself (it no longer waits for somebody to open the card's links)", async () => {
    const w = await world();
    const card = await db.card.create({ data: { orgId: w.orgId, workspaceId: w.ws.id, createdById: w.member.id, kind: "NOTE", title: "ورقة المنتج", position: 1000 } });
    await loginAs(w.member.id);
    const res = await call(cardTask.POST, { method: "POST", params: { id: card.id }, body: { projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id } });
    expect(res.status).toBe(201);
    const taskId = res.json?.["taskId"] as string;
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).sourceCardId).toBe(card.id);
    // nothing else about the task moved
    expect(await db.task.count({ where: { sourceCardId: card.id } })).toBe(1);
  });
});

describe("W1.2: the inbox project is not a project to pick", () => {
  const list = (workspaceId: string) => call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${workspaceId}` });
  const names = (res: { json: Record<string, unknown> | null }) => (res.json?.["projects"] as { name: string }[]).map((p) => p.name).sort();

  it("with `workInbox` ON, /api/projects lists the ordinary projects and not the inbox", async () => {
    const w = await world();
    await setFeatures(w.orgId, { workInbox: true });
    await instantBoard(w.ws.id, true);
    await loginAs(w.owner.id);
    expect(await db.project.count({ where: { workspaceId: w.ws.id, systemKey: INSTANT_PROJECT_KEY } })).toBe(1);
    expect(names(await list(w.ws.id))).toEqual(["مشروع أ"]);
  });

  it("a space whose ONLY project is the inbox still offers it (the cards' «حوّلها لمهمة» has no other target)", async () => {
    const w = await world();
    await setFeatures(w.orgId, { workInbox: true });
    await db.project.delete({ where: { id: w.project.id } });
    await instantBoard(w.ws.id, true);
    await loginAs(w.owner.id);
    expect(names(await list(w.ws.id))).toEqual(["صندوق المهام"]);
    // and the answer never carries the system key
    expect(JSON.stringify((await list(w.ws.id)).json)).not.toContain("systemKey");
  });

  it("with the switch OFF it is what it was: the hidden quick-task project stays an ordinary row of the answer", async () => {
    const w = await world();
    await setFeatures(w.orgId, { workInbox: false });
    await instantBoard(w.ws.id, false);
    await loginAs(w.owner.id);
    expect(names(await list(w.ws.id))).toHaveLength(2);
  });
});

describe("W1.6: the quick-task place is one function", () => {
  it("instantBoard finds or makes the space's project, board and «للتنفيذ» column, once", async () => {
    const w = await world();
    const first = await instantBoard(w.ws.id, false);
    const again = await instantBoard(w.ws.id, true);
    expect(again).toEqual(first);
    const project = await db.project.findUniqueOrThrow({ where: { id: first.projectId } });
    expect(project.systemKey).toBe(INSTANT_PROJECT_KEY);
    expect(await db.project.count({ where: { workspaceId: w.ws.id, systemKey: INSTANT_PROJECT_KEY } })).toBe(1);
    const column = await db.boardColumn.findUniqueOrThrow({ where: { id: first.columnId } });
    expect(column.boardId).toBe(first.boardId);
    expect(column.done).toBe(false);
  });
});
