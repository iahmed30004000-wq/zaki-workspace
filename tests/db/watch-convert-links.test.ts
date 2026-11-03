import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import React from "react";

// the page returns JSX and the test runner does not inject React by itself
(globalThis as { React?: unknown }).React = React;

// the page calls redirect()/notFound(); no running Next app is needed here
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

import * as watchRoute from "@/app/api/watch/route";
import * as conversionsRoute from "@/app/api/watch/[id]/conversions/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as taskRoute from "@/app/api/chat/messages/[id]/task/route";
import * as ideasRoute from "@/app/api/ideas/route";
import * as projectsRoute from "@/app/api/projects/route";
import WatchSessionPage from "@/app/(app)/watch/[id]/page";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { withFeature, type FeatureKey } from "@/lib/features";
import { setWatchFetchForTests } from "@/server/watch/title";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace } from "./helpers";

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
const LINK = "https://youtu.be/dQw4w9WgXcQ";

beforeAll(() => setWatchFetchForTests(async () => Response.json({ title: "A talk" })));
afterAll(() => setWatchFetchForTests(null));

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function as(userId: string, spaceId: string) {
  await loginAs(userId);
  jar().set(SPACE_COOKIE, spaceId);
}

/** A space with a member (starts the session), a colleague (in it), an outsider (in the space, not in the session) and a guest. */
async function world() {
  const t = await makeTeam();
  const colleague = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Colleague" });
  const outsider = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Outsider" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: colleague.id }, { userId: outsider.id }, { userId: t.admin.id, role: "ADMIN" }]);
  await as(t.member.id, ws.id);
  const id = (await call(watchRoute.POST, { body: { url: LINK, memberIds: [colleague.id] } })).json?.["id"] as string;
  const session = await db.watchSession.findUniqueOrThrow({ where: { id } });
  const comment = await call(messagesRoute.POST, { method: "POST", params: { id: session.conversationId }, body: { body: "📌 نعمل فيديو متله", videoAtSec: 120 } });
  return { ...t, colleague, outsider, ws, id, session, commentId: comment.json?.["id"] as string };
}

async function conversionsFor(userId: string, spaceId: string, sessionId: string) {
  await as(userId, spaceId);
  return call(conversionsRoute.GET, { params: { id: sessionId } });
}

describe("«حوّل»: the comment shows what it became", () => {
  it("an idea and a project keep their comment, a task already does; the session's people see all three, an outsider sees none", async () => {
    const w = await world();
    const { project, board } = await makeProject(w.ws.id);

    await as(w.member.id, w.ws.id);
    const idea = await call(ideasRoute.POST, { body: { title: "نعمل فيديو متله", description: "d", sourceMessageId: w.commentId } });
    expect(idea.status).toBe(201);
    const made = await call(projectsRoute.POST, { body: { workspaceId: w.ws.id, name: "مشروع الفيديو", sourceMessageId: w.commentId } });
    expect(made.status).toBe(201);
    const task = await call(taskRoute.POST, { params: { id: w.commentId }, body: { workspaceId: w.ws.id, projectId: project.id, boardId: board.id } });
    expect(task.status).toBe(201);

    expect(await db.idea.findFirstOrThrow({ where: { title: "نعمل فيديو متله" } })).toMatchObject({ sourceMessageId: w.commentId, workspaceId: w.ws.id });
    expect((await db.project.findFirstOrThrow({ where: { name: "مشروع الفيديو" } })).sourceMessageId).toBe(w.commentId);

    for (const who of [w.member, w.colleague]) {
      const list = await conversionsFor(who.id, w.ws.id, w.id);
      expect(list.status).toBe(200);
      const kinds = ((list.json?.["conversions"] as Record<string, { kind: string; id: string }[]>)[w.commentId] ?? []).map((c) => c.kind).sort();
      expect(kinds, who.name).toEqual(["idea", "project", "task"]);
    }
    // somebody the session was not started for: the session does not exist for them
    expect((await conversionsFor(w.outsider.id, w.ws.id, w.id)).status).toBe(404);
  });

  it("what is made in a space the colleague is not in is not shown to the colleague (only to its maker)", async () => {
    const w = await world();
    const other = await makeWorkspace(w.org.id, [{ userId: w.member.id }]);
    const { project, board } = await makeProject(other.id);
    await as(w.member.id, w.ws.id);
    const task = await call(taskRoute.POST, { params: { id: w.commentId }, body: { workspaceId: other.id, projectId: project.id, boardId: board.id } });
    expect(task.status).toBe(201);

    const mine = (await conversionsFor(w.member.id, w.ws.id, w.id)).json?.["conversions"] as Record<string, unknown[]>;
    expect(mine[w.commentId]).toHaveLength(1);
    const theirs = (await conversionsFor(w.colleague.id, w.ws.id, w.id)).json?.["conversions"] as Record<string, unknown[]>;
    expect(theirs[w.commentId] ?? []).toHaveLength(0);
  });

  it("a comment of a conversation the person cannot read, or of an ordinary topic, cannot be tied to a new idea or project", async () => {
    const w = await world();
    // 1. the session's talk, asked for by somebody who cannot read it
    await as(w.outsider.id, w.ws.id);
    const idea = await call(ideasRoute.POST, { body: { title: "فكرة من تعليق ما بشوفه", sourceMessageId: w.commentId } });
    expect(idea.status).toBe(404);
    const project = await call(projectsRoute.POST, { body: { workspaceId: w.ws.id, name: "مشروع من تعليق ما بشوفه", sourceMessageId: w.commentId } });
    expect(project.status).toBe(404);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.project.count({ where: { name: "مشروع من تعليق ما بشوفه" } })).toBe(0);

    // 2. a message of an ordinary topic is not a watch comment
    await as(w.member.id, w.ws.id);
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "General" } });
    const msg = await call(messagesRoute.POST, { method: "POST", params: { id: topic.id }, body: { body: "شغلة عادية" } });
    const refused = await call(ideasRoute.POST, { body: { title: "فكرة من رسالة عادية", sourceMessageId: msg.json?.["id"] as string } });
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("chat.work_not_from_this");
  });

  it("a guest converts nothing and reads no conversions", async () => {
    const w = await world();
    const guestSpace = await makeWorkspace(w.org.id, [{ userId: w.guest.id, role: "GUEST" }]);
    await as(w.guest.id, guestSpace.id);
    expect((await call(ideasRoute.POST, { body: { title: "فكرة من الشريك", sourceMessageId: w.commentId } })).status).toBe(403);
    expect((await call(projectsRoute.POST, { body: { workspaceId: guestSpace.id, name: "مشروع الشريك", sourceMessageId: w.commentId } })).status).toBe(403);
    expect((await call(conversionsRoute.GET, { params: { id: w.id } })).status).toBe(403);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("a project needs the «المشاريع» box and a place that holds projects; the room does not offer it otherwise", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const offered = async () => ((await WatchSessionPage({ params: { id: w.id } })) as unknown as { props: { convert: Record<string, boolean> } }).props.convert;
    expect(await offered()).toEqual({ idea: true, task: true, project: true });

    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } }, data: { revokedCapabilities: ["projects.edit"] } });
    expect(await offered()).toEqual({ idea: true, task: true, project: false });
    const refused = await call(projectsRoute.POST, { body: { workspaceId: w.ws.id, name: "مشروع ممنوع", sourceMessageId: w.commentId } });
    expect(refused.status).toBe(403);
    expect(await db.project.count({ where: { name: "مشروع ممنوع" } })).toBe(0);

    // the idea box off too: no idea offered, and the door refuses
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } }, data: { revokedCapabilities: ["projects.edit", "ideas.edit"] } });
    expect((await offered()).idea).toBe(false);
    expect((await call(ideasRoute.POST, { body: { title: "فكرة ممنوعة", sourceMessageId: w.commentId } })).status).toBe(403);
  });

  it("«الشركة» holds no projects: a session there offers no «مشروع»", async () => {
    const t = await makeTeam();
    const hq = await db.workspace.create({
      data: { organizationId: t.org.id, name: "HQ", slug: `hq-${t.org.id}`, kind: "HQ", members: { create: [{ userId: t.member.id }, { userId: t.admin.id }] } },
    });
    await as(t.member.id, hq.id);
    const id = (await call(watchRoute.POST, { body: { url: LINK, memberIds: [t.admin.id] } })).json?.["id"] as string;
    const page = (await WatchSessionPage({ params: { id } })) as unknown as { props: { convert: Record<string, boolean> } };
    expect(page.props.convert.project).toBe(false);
    expect(page.props.convert.idea).toBe(true);
  });

  it("switched off: no action offered, the doors refuse a link to a comment, nothing is listed; ordinary ideas and the room are untouched", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const idea = await call(ideasRoute.POST, { body: { title: "فكرة قبل الإطفاء", sourceMessageId: w.commentId } });
    expect(idea.status).toBe(201);

    await setFeature(w.org.id, "watchConvert", false);
    const page = (await WatchSessionPage({ params: { id: w.id } })) as unknown as { props: { convert: Record<string, boolean> } };
    expect(page.props.convert).toEqual({ idea: false, task: false, project: false });
    const after = await call(ideasRoute.POST, { body: { title: "فكرة بعد الإطفاء", sourceMessageId: w.commentId } });
    expect(after.status).toBe(404);
    expect((await call(projectsRoute.POST, { body: { workspaceId: w.ws.id, name: "مشروع بعد الإطفاء", sourceMessageId: w.commentId } })).status).toBe(404);
    const list = await call(conversionsRoute.GET, { params: { id: w.id } });
    expect(list.status).toBe(200);
    expect(list.json?.["conversions"]).toEqual({});
    // an idea with no comment behind it is not «حوّل»: it still works
    expect((await call(ideasRoute.POST, { body: { title: "فكرة عادية بعد الإطفاء" } })).status).toBe(201);

    await setFeature(w.org.id, "watchConvert", true);
    expect(Object.keys((await call(conversionsRoute.GET, { params: { id: w.id } })).json?.["conversions"] as object)).toEqual([w.commentId]);
  });
});
