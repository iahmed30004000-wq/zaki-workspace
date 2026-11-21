import type { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { requireActor } from "@/server/policy/actor";
import { createTask } from "@/server/services/tasks";
import * as workRequestsService from "@/server/services/work-requests";
import { waitingBySpace, workRequestsOf } from "@/server/services/work-requests";
import { withFeature } from "@/lib/features";
import { approvalsWorld, ask, jar } from "./approvals-helpers";
import { makeDepartment, makeTicket } from "./guest-helpers";
import { call, db, loginAs, makeProject, makeWorkspace } from "./helpers";

/**
 * S5.8 «عدّاد الانتظار لكل مساحة على القائمة»: each space is its own account (B4), and the other spaces show only as numbers on the drawer. The number
 * beside a space is what waits for THIS person's decision there: the very rows of «الطلبات» «بانتظاري» (approvals whose turn is mine, assignment requests
 * addressed to me, cards I decide, product sheets), counted by `waitingBySpace` (ONE grouped read per kind, never one pass per space) and carried by the
 * same `/api/workspaces` answer the drawer already reads, only while the company's switch `spaceBadges` (and `workRequests`) is on. Against a real database.
 */

afterEach(() => jar().delete(SPACE_COOKIE));

async function setFeatures(orgId: string, features: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let settings: Record<string, unknown> = (org.settings as Record<string, unknown> | null) ?? {};
  for (const [key, on] of Object.entries(features)) settings = withFeature(settings, key as never, on);
  await db.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
}

interface Row {
  id: string;
  name: string;
  waiting?: number;
}
type Answer = { organizations: { workspaces: Row[] }[] };

async function spacesAs(userId: string, spaceId: string) {
  await loginAs(userId);
  jar().set(SPACE_COOKIE, spaceId);
  const res = await call(workspacesRoute.GET, { url: "http://localhost/api/workspaces" });
  expect(res.status).toBe(200);
  return { answer: res.json as unknown as Answer, text: res.text };
}
const rowsOf = (answer: Answer): Row[] => answer.organizations.flatMap((o) => o.workspaces);
const waitingOf = (answer: Answer): Record<string, number | undefined> => Object.fromEntries(rowsOf(answer).map((r) => [r.id, r.waiting]));

/**
 * The approvals company: the LEAD works in `ws` AND `other` (somebody above the asker is who an assignment request is addressed to). Waiting for HIM in `other`: one approval and one assignment request (on a task there);
 * in `ws`, one approval. A third space (`secret`) the lead is NOT in holds an approval waiting for the admin and a card in review.
 */
async function world() {
  const w = await approvalsWorld();
  await db.workspaceMember.create({ data: { workspaceId: w.other.id, userId: w.lead.id, role: "MEMBER" } });
  await setFeatures(w.orgId, { workRequests: true, spaceBadges: true });
  await ask(w, w.admin, [w.lead.id], { title: "في مساحتي الحالية" });
  await ask(w, w.outsider, [w.lead.id], { title: "في المساحة الثانية", workspaceId: w.other.id });
  const made = await makeProject(w.other.id);
  const created = await createTask({ userId: w.outsider.id, orgId: w.orgId }, { workspaceId: w.other.id, projectId: made.project.id, boardId: made.board.id, title: "مهمة إسناد", assigneeId: w.lead.id });
  await db.taskAssignRequest.findFirstOrThrow({ where: { taskId: created.id, toUserId: w.lead.id, status: "PENDING" } });
  const secret = await makeWorkspace(w.orgId, [{ userId: w.outsider.id }, { userId: w.admin.id, role: "ADMIN" }], "مساحة سرية");
  await ask(w, w.outsider, [w.admin.id], { title: "في المساحة السرية", workspaceId: secret.id });
  await db.card.create({ data: { orgId: w.orgId, workspaceId: secret.id, createdById: w.outsider.id, kind: "NOTE", title: "بطاقة سرية", status: "REVIEW" } });
  return { ...w, secret };
}

describe("the number beside each space (the switch is on)", () => {
  it("the lead sees, beside the OTHER space, what waits for him there: the approval and the assignment request", async () => {
    const w = await world();
    const { answer } = await spacesAs(w.lead.id, w.ws.id);
    const waiting = waitingOf(answer);
    expect(waiting[w.other.id]).toBe(2);
    expect(waiting[w.ws.id]).toBe(1);
  });

  it("is the SAME number «الطلبات» shows for that space (never a second count that can disagree), tickets left out: they belong to no space", async () => {
    const w = await world();
    const dept = await makeDepartment(w.orgId, { name: "الدعم", memberIds: [w.lead.id], leadId: w.lead.id });
    await makeTicket({ orgId: w.orgId, departmentId: dept.id, creatorId: w.owner.id });
    const { answer } = await spacesAs(w.lead.id, w.ws.id);
    const actor = await requireActor();
    for (const id of [w.ws.id, w.other.id]) {
      const view = await workRequestsOf(actor, "waiting", { spaceId: id });
      const withoutTickets = view.sections.filter((s) => s.key !== "tickets").reduce((sum, s) => sum + s.total, 0);
      expect(waitingOf(answer)[id], id).toBe(withoutTickets);
    }
    // and the service itself, for the spaces the person works in
    const map = await waitingBySpace(actor, [w.ws.id, w.other.id]);
    expect([...map.entries()].sort()).toEqual(
      [
        [w.ws.id, 1],
        [w.other.id, 2],
      ].sort(),
    );
  });

  it("a space the person is not in is never counted and never named, even when it holds things waiting for others (and asking the service for it gives nothing)", async () => {
    const w = await world();
    const { answer, text } = await spacesAs(w.lead.id, w.ws.id);
    expect(rowsOf(answer).map((r) => r.id).sort()).toEqual([w.ws.id, w.other.id].sort());
    expect(text).not.toContain(w.secret.id);
    const map = await waitingBySpace(await requireActor(), [w.ws.id, w.other.id, w.secret.id]);
    expect(map.has(w.secret.id)).toBe(false);
    // the admin, who IS in the secret space, has his own number there and none in `other`
    const admin = await spacesAs(w.admin.id, w.ws.id);
    expect(waitingOf(admin.answer)[w.secret.id]).toBe(2); // the approval + the card in review (he is its ADMIN)
    expect(waitingOf(admin.answer)[w.other.id]).toBeUndefined();
    expect(admin.text).not.toContain(w.other.id);
  });

  it("the owner (who sees every space on the drawer) gets a number for each: the cards in review he decides", async () => {
    const w = await world();
    await db.card.create({ data: { orgId: w.orgId, workspaceId: w.other.id, createdById: w.lead.id, kind: "NOTE", title: "بطاقة هناك", status: "REVIEW" } });
    const { answer } = await spacesAs(w.owner.id, w.ws.id);
    const waiting = waitingOf(answer);
    expect(waiting[w.other.id]).toBe(1);
    expect(waiting[w.secret.id]).toBe(1);
  });

  it("a number only counts what the person decides: the one who asked has nothing waiting on his side", async () => {
    const w = await world();
    const { answer } = await spacesAs(w.outsider.id, w.other.id);
    expect(Object.values(waitingOf(answer)).every((n) => n === 0)).toBe(true);
  });

  it("a guest gets no number at all, and no key", async () => {
    const w = await world();
    const { answer } = await spacesAs(w.guest.id, w.ws.id);
    expect(rowsOf(answer).length).toBeGreaterThan(0);
    for (const row of rowsOf(answer)) expect(Object.keys(row)).not.toContain("waiting");
    expect((await waitingBySpace(await requireActor(), [w.ws.id])).size).toBe(0);
  });

  it("zero is sent as 0 (the drawer draws nothing for it)", async () => {
    const w = await world();
    const { answer } = await spacesAs(w.member2.id, w.ws.id);
    expect(waitingOf(answer)[w.ws.id]).toBe(0);
  });
});

describe("the switches", () => {
  it("OFF: the answer carries no `waiting` on a space, for anybody", async () => {
    const w = await world();
    await setFeatures(w.orgId, { spaceBadges: false });
    for (const person of [w.lead, w.admin, w.owner]) {
      const { answer } = await spacesAs(person.id, w.ws.id);
      for (const row of rowsOf(answer)) expect(Object.keys(row), person.id).not.toContain("waiting");
    }
  });

  it("is off in a company that never touched it, and the keys of a space are exactly the old ones", async () => {
    const w = await approvalsWorld();
    await setFeatures(w.orgId, { workRequests: true });
    const { answer } = await spacesAs(w.lead.id, w.ws.id);
    expect(Object.keys(rowsOf(answer)[0] as object).sort()).toEqual(["emoji", "holdsProjects", "id", "name", "overdue", "slug", "unread"]);
  });

  it("needs «الطلبات» too: with `workRequests` off the numbers are not sent (nothing waits in an inbox that does not exist)", async () => {
    const w = await world();
    await setFeatures(w.orgId, { workRequests: false });
    const { answer } = await spacesAs(w.lead.id, w.ws.id);
    for (const row of rowsOf(answer)) expect(Object.keys(row)).not.toContain("waiting");
  });

  it("a count that fails degrades: the spaces, the unread numbers and the banner still answer, with no numbers", async () => {
    const w = await world();
    const failing = vi.spyOn(workRequestsService, "waitingBySpace").mockRejectedValueOnce(new Error("boom"));
    const { answer } = await spacesAs(w.lead.id, w.ws.id);
    expect(rowsOf(answer).length).toBe(2);
    for (const row of rowsOf(answer)) expect(Object.keys(row)).not.toContain("waiting");
    expect(failing).toHaveBeenCalledTimes(1);
    failing.mockRestore();
    expect(typeof db.card.groupBy).toBe("function");
  });

  it("the number for the current space is still the one on «الشغل» (`waiting` of the answer is untouched)", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    jar().set(SPACE_COOKIE, w.other.id);
    const res = await call(workspacesRoute.GET, { url: "http://localhost/api/workspaces" });
    expect((res.json as { waiting: number }).waiting).toBe(2);
  });
});
