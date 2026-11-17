/**
 * P0.3 — work made from a private conversation stays private (docs/restructure/P0-privacy.md).
 *
 * «اعمل منها مهمة» from a DM, a restricted topic or a team's topic: the task is «المعنيين بس» by default; making it «المساحة
 * كلها» is allowed only with `confirmPublic: true`, and the SERVER enforces it (422 `work.confirm_public_required`: the app's answer to a request that fails a rule) — the
 * dialog only explains. A ticket (read by its department) from a private source needs the same confirmation.
 */
import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as taskRoute from "@/app/api/chat/messages/[id]/task/route";
import * as ticketRoute from "@/app/api/chat/messages/[id]/ticket/route";
import * as taskGet from "@/app/api/tasks/[id]/route";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const [a, b, outsider] = await Promise.all([makeUser({ orgId, role: "MEMBER", name: "A" }), makeUser({ orgId, role: "MEMBER", name: "B" }), makeUser({ orgId, role: "MEMBER", name: "Outsider" })]);
  const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }, { userId: outsider.id }]);
  const { project, board } = await makeProject(space.id);
  const target = { workspaceId: space.id, projectId: project.id, boardId: board.id };
  const open = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  const secret = await db.conversation.create({
    data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Secret", restricted: true, members: { create: [{ userId: a.id }, { userId: b.id }] } },
  });
  const say = async (userId: string, conversationId: string, body: string) => {
    await loginAs(userId);
    return (await call(messagesRoute.POST, { method: "POST", params: { id: conversationId }, body: { body } })).json?.["id"] as string;
  };
  return { ...t, orgId, a, b, outsider, space, project, board, target, open, secret, say };
}
type World = Awaited<ReturnType<typeof world>>;
const visibilityOf = async (taskId: string) => (await db.task.findUniqueOrThrow({ where: { id: taskId } })).visibility;
const make = (w: World, messageId: string, extra: Record<string, unknown> = {}) => call(taskRoute.POST, { method: "POST", params: { id: messageId }, body: { ...w.target, ...extra } });

describe("a task made from a private conversation", () => {
  it("is «المعنيين بس» by default, so another member of the space does not see it", async () => {
    const w = await world();
    const msg = await w.say(w.a.id, w.secret.id, "خطة سرية");
    await loginAs(w.a.id);
    const res = await make(w, msg);
    expect(res.status).toBe(201);
    const taskId = res.json?.["taskId"] as string;
    expect(await visibilityOf(taskId)).toBe("PARTICIPANTS");
    await loginAs(w.outsider.id);
    expect((await call(taskGet.GET, { params: { id: taskId } })).status).toBe(404);
    await loginAs(w.a.id);
    expect((await call(taskGet.GET, { params: { id: taskId } })).status).toBe(200);
  });

  it("can be for the whole space only with an explicit choice AND confirmPublic — enforced by the server", async () => {
    const w = await world();
    const msg = await w.say(w.a.id, w.secret.id, "ممكن نعلنها");
    await loginAs(w.a.id);
    const refused = await make(w, msg, { visibility: "SPACE" });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain("work.confirm_public_required");
    expect(await db.task.count({ where: { sourceMessageId: msg } })).toBe(0);
    const allowed = await make(w, msg, { visibility: "SPACE", confirmPublic: true });
    expect(allowed.status).toBe(201);
    expect(await visibilityOf(allowed.json?.["taskId"] as string)).toBe("SPACE");
    // confirmPublic alone changes nothing: without the choice the task stays private
    const alone = await make(w, msg, { confirmPublic: true });
    expect(await visibilityOf(alone.json?.["taskId"] as string)).toBe("PARTICIPANTS");
  });

  it("from a DM follows the same rule", async () => {
    const w = await world();
    await loginAs(w.a.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.b.id } })).json?.["id"] as string;
    const msg = await w.say(w.a.id, dm, "بيني وبينك");
    await loginAs(w.a.id);
    expect((await make(w, msg, { visibility: "SPACE" })).status).toBe(422);
    const res = await make(w, msg);
    expect(res.status).toBe(201);
    expect(await visibilityOf(res.json?.["taskId"] as string)).toBe("PARTICIPANTS");
  });

  it("from a «مقطع» topic follows the same rule", async () => {
    const w = await world();
    const team = await db.team.create({ data: { workspaceId: w.space.id, name: "X", members: { create: [{ userId: w.a.id }] } } });
    const topic = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Team talk", teamId: team.id } });
    const msg = await w.say(w.a.id, topic.id, "شغلة الفريق");
    await loginAs(w.a.id);
    expect((await make(w, msg, { visibility: "SPACE" })).status).toBe(422);
    expect(await visibilityOf((await make(w, msg)).json?.["taskId"] as string)).toBe("PARTICIPANTS");
  });

  it("from an OPEN topic nothing changes: the company's default, or the person's own choice", async () => {
    const w = await world();
    const msg = await w.say(w.a.id, w.open.id, "شغلة علنية");
    await loginAs(w.a.id);
    expect(await visibilityOf((await make(w, msg)).json?.["taskId"] as string)).toBe("SPACE");
    expect(await visibilityOf((await make(w, msg, { visibility: "PARTICIPANTS" })).json?.["taskId"] as string)).toBe("PARTICIPANTS");
  });
});

describe("a ticket made from a private conversation", () => {
  it("needs confirmPublic: its department reads it", async () => {
    const w = await world();
    const dept = await db.department.create({ data: { orgId: w.orgId, name: `Support ${Math.random()}`, memberships: { create: [{ userId: w.a.id }] } } });
    const secretMsg = await w.say(w.a.id, w.secret.id, "مشكلة بالزبون");
    const openMsg = await w.say(w.a.id, w.open.id, "مشكلة عامة");
    await loginAs(w.a.id);
    const refused = await call(ticketRoute.POST, { method: "POST", params: { id: secretMsg }, body: { departmentId: dept.id } });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain("work.confirm_public_required");
    expect((await call(ticketRoute.POST, { method: "POST", params: { id: secretMsg }, body: { departmentId: dept.id, confirmPublic: true } })).status).toBe(201);
    expect((await call(ticketRoute.POST, { method: "POST", params: { id: openMsg }, body: { departmentId: dept.id } })).status).toBe(201);
  });
});
