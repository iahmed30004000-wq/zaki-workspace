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
  usePathname: () => "/requests",
}));

import RequestsPage from "@/app/(app)/requests/page";
import * as requestsRoute from "@/app/api/work/requests/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import * as acceptRoute from "@/app/api/tasks/[id]/request/accept/route";
import * as returnRoute from "@/app/api/tasks/[id]/request/return/route";
import * as ticketRoute from "@/app/api/tickets/[id]/route";
import * as cardStatusRoute from "@/app/api/cards/[id]/status/route";
import * as sheetStatusRoute from "@/app/api/knowledge/[id]/status/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { requireActor } from "@/server/policy/actor";
import { createTask } from "@/server/services/tasks";
import { waitingCount } from "@/server/services/approvals";
import { waitingRequestCount, workRequestsOf } from "@/server/services/work-requests";
import type { RequestSection, SectionKey, WorkRequestsView } from "@/components/work/requests/types";
import { withFeature } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { approvalsWorld, ask, decide, jar } from "./approvals-helpers";
import { makeDepartment, makeTicket } from "./guest-helpers";
import { html } from "./pages-access-helpers";
import { call, db, loginAs, makeProject, makeTask, makeWorkspace, uid } from "./helpers";

/**
 * W1.4 «الطلبات»: ONE inbox of everything that waits for a decision. Two tabs: «بانتظاري» (approvals whose turn is mine, assignment requests
 * addressed to me, open tickets of MY departments, cards and product sheets I decide) and «طلباتي» (what I asked and still waits).
 * It adds no decision path: every row acts through the doors that exist (approvals, task accept/return, tickets, card status, sheet status).
 * Every row is filtered by what the person may see; a guest sees nothing; the number on «الشغل» is the count of «بانتظاري» and
 * is the caller's own.
 */

afterEach(() => jar().delete(SPACE_COOKIE));

async function setSettings(orgId: string, patch: Record<string, unknown>, features: Record<string, boolean> = {}) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let settings: Record<string, unknown> = { ...((org.settings as Record<string, unknown> | null) ?? {}), ...patch };
  for (const [key, on] of Object.entries(features)) settings = withFeature(settings, key as never, on);
  await db.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
}

/** The approvals company (owner, admin = ADMIN of `ws`, lead, member, member2, guest; `other` is a space without admin/lead) with «الطلبات» on. */
async function world(opts: { on?: boolean } = {}) {
  const w = await approvalsWorld();
  await setSettings(w.orgId, {}, { workRequests: opts.on !== false });
  const made = await makeProject(w.ws.id);
  const task = (creatorId: string, assigneeId: string | null = null, title = `T ${uid()}`) =>
    makeTask({ orgId: w.orgId, workspaceId: w.ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId, assigneeId, title });
  const as = (u: { id: string }) => ({ userId: u.id, orgId: w.orgId });
  /** A task the member ASKED the person above them to take: a pending request addressed to `to`. */
  const askFor = async (from: { id: string }, to: { id: string }, title = `Ask ${uid()}`) => {
    const row = await createTask(as(from), { workspaceId: w.ws.id, projectId: made.project.id, boardId: made.board.id, title, assigneeId: to.id });
    const request = await db.taskAssignRequest.findFirstOrThrow({ where: { taskId: row.id, toUserId: to.id } });
    return { task: row, request };
  };
  const dept = await makeDepartment(w.orgId, { name: `Support ${uid()}`, memberIds: [w.member.id, w.member2.id], leadId: w.lead.id });
  const otherDept = await makeDepartment(w.orgId, { name: `Other ${uid()}`, memberIds: [w.lead.id] });
  const card = (createdById: string, over: Partial<{ workspaceId: string; status: string; kind: string; title: string }> = {}) =>
    db.card.create({ data: { orgId: w.orgId, workspaceId: over.workspaceId ?? w.ws.id, createdById, kind: over.kind ?? "NOTE", title: over.title ?? `Card ${uid()}`, status: over.status ?? "REVIEW" } });
  return { ...w, ...made, task, as, askFor, dept, otherDept, card };
}
type World = Awaited<ReturnType<typeof world>>;

/** The person's own lists, read as them through the real route. */
async function inbox(person: { id: string }, tab: "waiting" | "mine" = "waiting") {
  await loginAs(person.id);
  const res = await call(requestsRoute.GET, { url: `http://localhost/api/work/requests?tab=${tab}` });
  return { status: res.status, view: res.json as unknown as WorkRequestsView, message: res.json?.["message"] as string | undefined };
}
const section = (view: WorkRequestsView, key: SectionKey): RequestSection | undefined => view.sections.find((s) => s.key === key);
const titles = (view: WorkRequestsView, key: SectionKey) => (section(view, key)?.rows ?? []).map((r) => r.title);

describe("the switch and the door", () => {
  it("OFF (the default): the route answers 404 for everybody, the owner included; ON: it answers the person's own lists", async () => {
    const w = await world({ on: false });
    for (const person of [w.owner, w.admin, w.member]) expect((await inbox(person)).status, person.id).toBe(404);
    await setSettings(w.orgId, {}, { workRequests: true });
    for (const person of [w.owner, w.admin, w.member]) {
      const res = await inbox(person);
      expect(res.status).toBe(200);
      expect(res.view.tab).toBe("waiting");
    }
  });

  it("a guest (external partner) is refused outright: 403 on the route, no section from the service, a count of 0", async () => {
    const w = await world();
    await ask(w, w.admin, [w.member.id]);
    const res = await inbox(w.guest);
    expect(res.status).toBe(403);
    await loginAs(w.guest.id);
    const actor = await requireActor();
    expect((await workRequestsOf(actor, "waiting")).sections).toEqual([]);
    expect(await waitingRequestCount(actor)).toBe(0);
  });

  it("an unknown tab is «بانتظاري», and a bad value is never an error", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await call(requestsRoute.GET, { url: "http://localhost/api/work/requests?tab=nonsense" });
    expect(res.status).toBe(200);
    expect(res.json?.["tab"]).toBe("waiting");
  });
});

describe("approvals: the requests whose turn is mine", () => {
  it("the approver in turn sees it; the next in the chain only after the one before approved; the requester sees it under «طلباتي»", async () => {
    const w = await world();
    const id = await ask(w, w.admin, [w.lead.id, w.member.id], { title: "شراء شاشة" });
    expect(titles((await inbox(w.lead)).view, "approvals")).toEqual(["شراء شاشة"]);
    expect(titles((await inbox(w.member)).view, "approvals")).toEqual([]);
    expect(titles((await inbox(w.member2)).view, "approvals")).toEqual([]);
    // the requester: waiting on the lead
    const mine = section((await inbox(w.admin, "mine")).view, "approvals");
    expect(mine?.rows).toMatchObject([{ kind: "approval", title: "شراء شاشة", waitingOn: "Lead" }]);
    // the lead approves in the existing door: the member's turn comes
    await loginAs(w.lead.id);
    expect((await decide(id, "APPROVE")).status).toBe(200);
    expect(titles((await inbox(w.lead)).view, "approvals")).toEqual([]);
    expect(titles((await inbox(w.member)).view, "approvals")).toEqual(["شراء شاشة"]);
    // a row links into the detail page, which stays where it was
    expect(section((await inbox(w.member)).view, "approvals")?.rows[0]).toMatchObject({ href: `/approvals/${id}`, canDecide: true });
  });

  it("with `approvals` switched off the section does not exist (the other sections still do)", async () => {
    const w = await world();
    await ask(w, w.admin, [w.lead.id]);
    await setSettings(w.orgId, {}, { approvals: false });
    expect(section((await inbox(w.lead)).view, "approvals")).toBeUndefined();
  });

  it("a request in a space the approver no longer works in is neither listed nor counted (the approvals page's own number agrees)", async () => {
    const w = await world();
    await ask(w, w.admin, [w.member2.id]);
    await loginAs(w.member2.id);
    let actor = await requireActor();
    expect(await waitingCount(actor)).toBe(1);
    await db.workspaceMember.deleteMany({ where: { workspaceId: w.ws.id, userId: w.member2.id } });
    actor = await requireActor();
    expect(titles((await inbox(w.member2)).view, "approvals")).toEqual([]);
    expect(await waitingCount(actor)).toBe(0);
    expect(await waitingRequestCount(actor)).toBe(0);
  });
});

describe("task assignment requests (TaskAssignRequest had no inbox)", () => {
  it("the person asked sees the request, the asker sees it under «طلباتي», nobody else sees it", async () => {
    const w = await world();
    const { task, request } = await w.askFor(w.member, w.admin, "مهمة للمدير");
    const row = section((await inbox(w.admin)).view, "assignments")?.rows[0];
    expect(row).toMatchObject({ kind: "assign", title: "مهمة للمدير", taskId: task.id, requestId: request.id, fromName: "Member", href: `/tasks/${task.id}`, canAnswer: true });
    for (const stranger of [w.lead, w.member2, w.owner]) expect(titles((await inbox(stranger)).view, "assignments"), stranger.id).toEqual([]);
    expect(section((await inbox(w.member, "mine")).view, "assignments")?.rows[0]).toMatchObject({ title: "مهمة للمدير", toName: "Admin", canAnswer: false });
    // «بانتظاري» of the asker has no such row
    expect(titles((await inbox(w.member)).view, "assignments")).toEqual([]);
  });

  it("accept and return act through the existing doors and the row leaves both lists", async () => {
    const w = await world();
    const one = await w.askFor(w.member, w.admin);
    const two = await w.askFor(w.member2, w.admin);
    await loginAs(w.admin.id);
    expect((await call(acceptRoute.POST, { params: { id: one.task.id }, body: { requestId: one.request.id } })).status).toBe(200);
    expect((await call(returnRoute.POST, { params: { id: two.task.id }, body: { reason: "مشغول", requestId: two.request.id } })).status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: one.task.id } })).assigneeId).toBe(w.admin.id);
    expect(titles((await inbox(w.admin)).view, "assignments")).toEqual([]);
    expect(titles((await inbox(w.member, "mine")).view, "assignments")).toEqual([]);
  });

  it("a request on a PRIVATE task its addressee may not see is hidden and not counted (P0.2 taskVisibleWhere)", async () => {
    const w = await world();
    const { task } = await w.askFor(w.member, w.lead, "سرّية");
    await db.task.update({ where: { id: task.id }, data: { visibility: "PARTICIPANTS" } });
    expect(titles((await inbox(w.lead)).view, "assignments")).toEqual([]);
    await loginAs(w.lead.id);
    expect(await waitingRequestCount(await requireActor())).toBe(0);
    // the asker made it: they still see it under «طلباتي»
    expect(titles((await inbox(w.member, "mine")).view, "assignments")).toEqual(["سرّية"]);
    // a space ADMIN reads private tasks of the space: the same request addressed to the admin is listed
    const { task: second } = await w.askFor(w.member, w.admin, "سرّية للمدير");
    await db.task.update({ where: { id: second.id }, data: { visibility: "PARTICIPANTS" } });
    expect(titles((await inbox(w.admin)).view, "assignments")).toEqual(["سرّية للمدير"]);
  });
});

describe("tickets of MY departments", () => {
  it("a department member sees the open tickets nobody took and the ones given to them; not other departments', not others' work, not closed ones", async () => {
    const w = await world();
    const open = await makeTicket({ orgId: w.orgId, departmentId: w.dept.id, creatorId: w.owner.id, title: "شاشة معطلة" });
    await makeTicket({ orgId: w.orgId, departmentId: w.otherDept.id, creatorId: w.owner.id, title: "قسم ثاني" });
    await makeTicket({ orgId: w.orgId, departmentId: w.dept.id, creatorId: w.owner.id, assigneeId: w.member2.id, status: "IN_PROGRESS", title: "عند زميلي" });
    await makeTicket({ orgId: w.orgId, departmentId: w.dept.id, creatorId: w.owner.id, status: "RESOLVED", title: "انحلت" });
    const mine = await makeTicket({ orgId: w.orgId, departmentId: w.dept.id, creatorId: w.owner.id, assigneeId: w.member.id, status: "IN_PROGRESS", title: "عندي" });
    const view = (await inbox(w.member)).view;
    expect(titles(view, "tickets").sort()).toEqual(["شاشة معطلة", "عندي"].sort());
    const rows = section(view, "tickets")?.rows ?? [];
    expect(rows.find((r) => r.id === open.id)).toMatchObject({ kind: "ticket", canTake: true, canResolve: false });
    expect(rows.find((r) => r.id === mine.id)).toMatchObject({ canResolve: true });
    // a person of no department (the owner, the admin) has none: «my departments» only
    expect(titles((await inbox(w.owner)).view, "tickets")).toEqual([]);
    expect(titles((await inbox(w.admin)).view, "tickets")).toEqual([]);
    // the department's lead sees the same open ticket
    expect(titles((await inbox(w.lead)).view, "tickets")).toContain("شاشة معطلة");
  });

  it("taking a ticket acts through PATCH /api/tickets/[id]: it moves from «open, nobody» to «mine, in progress»", async () => {
    const w = await world();
    const open = await makeTicket({ orgId: w.orgId, departmentId: w.dept.id, creatorId: w.owner.id, title: "خذها" });
    await loginAs(w.member.id);
    expect((await call(ticketRoute.PATCH, { method: "PATCH", params: { id: open.id }, body: { status: "IN_PROGRESS", assigneeId: w.member.id } })).status).toBe(200);
    expect(titles((await inbox(w.member2)).view, "tickets")).toEqual([]);
    expect(section((await inbox(w.member)).view, "tickets")?.rows[0]).toMatchObject({ id: open.id, canTake: false, canResolve: true });
  });

  it("«طلباتي»: the tickets I raised that are still open", async () => {
    const w = await world();
    await makeTicket({ orgId: w.orgId, departmentId: w.dept.id, creatorId: w.admin.id, title: "رفعتها" });
    await makeTicket({ orgId: w.orgId, departmentId: w.dept.id, creatorId: w.admin.id, status: "CLOSED", title: "مغلقة" });
    expect(titles((await inbox(w.admin, "mine")).view, "tickets")).toEqual(["رفعتها"]);
    expect(titles((await inbox(w.member, "mine")).view, "tickets")).toEqual([]);
  });
});

describe("cards in review: only where I decide", () => {
  it("a manager of the space (its ADMIN, the owner) sees a card in review; a plain member does not; a draft is not waiting; another space's card is not theirs", async () => {
    const w = await world();
    const waiting = await w.card(w.member.id, { title: "بطاقة للمراجعة" });
    await w.card(w.member.id, { status: "DRAFT", title: "مسودة" });
    await w.card(w.member.id, { workspaceId: w.other.id, title: "بمساحة ثانية" });
    expect(titles((await inbox(w.admin)).view, "cards")).toEqual(["بطاقة للمراجعة"]);
    expect(titles((await inbox(w.owner)).view, "cards").sort()).toEqual(["بطاقة للمراجعة", "بمساحة ثانية"].sort());
    expect(titles((await inbox(w.member)).view, "cards")).toEqual([]);
    expect(section((await inbox(w.member)).view, "cards")).toBeUndefined();
    expect(titles((await inbox(w.lead)).view, "cards")).toEqual([]);
    expect(section((await inbox(w.admin)).view, "cards")?.rows[0]).toMatchObject({ id: waiting.id, kind: "card", href: `/cards/${waiting.id}`, canDecide: true });
  });

  it("approve and send back act through PUT /api/cards/[id]/status", async () => {
    const w = await world();
    const a = await w.card(w.member.id);
    const b = await w.card(w.member.id);
    await loginAs(w.admin.id);
    expect((await call(cardStatusRoute.PUT, { method: "PUT", params: { id: a.id }, body: { status: "APPROVED" } })).status).toBe(200);
    expect((await call(cardStatusRoute.PUT, { method: "PUT", params: { id: b.id }, body: { status: "DRAFT" } })).status).toBe(200);
    expect(titles((await inbox(w.admin)).view, "cards")).toEqual([]);
  });

  it("«طلباتي»: the cards I made that wait for a review", async () => {
    const w = await world();
    await w.card(w.member.id, { title: "بطاقتي" });
    expect(titles((await inbox(w.member, "mine")).view, "cards")).toEqual(["بطاقتي"]);
    expect(titles((await inbox(w.member2, "mine")).view, "cards")).toEqual([]);
  });
});

describe("product sheets waiting for approval (Q1.1)", () => {
  async function sheetWorld() {
    const w = await world();
    const space = await makeWorkspace(w.orgId, [{ userId: w.admin.id, role: "ADMIN" }, { userId: w.lead.id }, { userId: w.member.id }], "المعرفة");
    await setSettings(w.orgId, { knowledgeSpaceId: space.id, knowledgeEditorIds: [w.member.id], knowledgeApproverIds: [w.lead.id] }, { knowledgeCards: true });
    const sheet = await db.card.create({ data: { orgId: w.orgId, workspaceId: space.id, createdById: w.member.id, kind: "PRODUCT", title: "كريم مرطّب", status: "REVIEW", version: 3 } });
    return { ...w, space, sheet };
  }

  it("the owner and the approvers the owner named see it; an editor who may not approve and a plain manager do not; it is not repeated under «cards»", async () => {
    const w = await sheetWorld();
    expect(titles((await inbox(w.owner)).view, "sheets")).toEqual(["كريم مرطّب"]);
    expect(titles((await inbox(w.lead)).view, "sheets")).toEqual(["كريم مرطّب"]);
    expect(section((await inbox(w.lead)).view, "sheets")?.rows[0]).toMatchObject({ kind: "sheet", id: w.sheet.id, version: 3, href: `/knowledge/${w.sheet.id}`, canDecide: true });
    for (const person of [w.member, w.admin]) expect(titles((await inbox(person)).view, "sheets"), person.id).toEqual([]);
    for (const person of [w.owner, w.lead, w.admin, w.member]) expect(titles((await inbox(person)).view, "cards"), person.id).not.toContain("كريم مرطّب");
  });

  it("with `knowledgeCards` off the section does not exist", async () => {
    const w = await sheetWorld();
    await setSettings(w.orgId, {}, { knowledgeCards: false });
    expect(section((await inbox(w.owner)).view, "sheets")).toBeUndefined();
    // and a sheet is never offered as an ordinary card: the cards door refuses it (cards.ts), so a button there would only fail
    for (const person of [w.owner, w.lead, w.admin]) expect(titles((await inbox(person)).view, "cards"), person.id).not.toContain("كريم مرطّب");
  });

  it("a sheet in an ARCHIVED knowledge space is no longer waiting (the number must be able to clear)", async () => {
    const w = await sheetWorld();
    await db.workspace.update({ where: { id: w.space.id }, data: { archivedAt: new Date() } });
    expect(titles((await inbox(w.lead)).view, "sheets")).toEqual([]);
    await loginAs(w.lead.id);
    expect(await waitingRequestCount(await requireActor())).toBe(0);
  });

  it("approving acts through PUT /api/knowledge/[id]/status at the version that was seen", async () => {
    const w = await sheetWorld();
    await loginAs(w.lead.id);
    expect((await call(sheetStatusRoute.PUT, { method: "PUT", params: { id: w.sheet.id }, body: { status: "APPROVED", version: 3 } })).status).toBe(200);
    expect(titles((await inbox(w.lead)).view, "sheets")).toEqual([]);
  });

  it("«طلباتي»: the sheet its author sent to review", async () => {
    const w = await sheetWorld();
    const mine = (await inbox(w.member, "mine")).view;
    expect(titles(mine, "sheets")).toEqual(["كريم مرطّب"]);
    expect(section(mine, "sheets")?.rows[0]).toMatchObject({ canDecide: false });
    expect(titles(mine, "cards")).toEqual([]);
    // a person who does not work in the knowledge space has none
    expect(section((await inbox(w.member2, "mine")).view, "sheets")).toBeUndefined();
  });
});

describe("the number on «الشغل»", () => {
  /** Everything waiting for the member and the admin, so two people have two different numbers. */
  async function busy() {
    const w = await world();
    await ask(w, w.admin, [w.member.id]);
    await ask(w, w.lead, [w.member.id]);
    await makeTicket({ orgId: w.orgId, departmentId: w.dept.id, creatorId: w.owner.id });
    await w.askFor(w.member, w.admin);
    await w.card(w.member.id);
    return w;
  }
  const spaces = async (person: { id: string }) => {
    await loginAs(person.id);
    return (await call(workspacesRoute.GET, { url: "http://localhost/api/workspaces" })).json as unknown as { waiting: number };
  };

  it("is the count of «بانتظاري»: the sum of its sections, the same in the service, the route and /api/workspaces, and each person's own", async () => {
    const w = await busy();
    const expected = new Map<string, number>([
      [w.member.id, 3], // two approvals + the open ticket of the department
      [w.admin.id, 2], // the assignment request + the card in review (the space's ADMIN decides it)
      [w.owner.id, 1], // the card in review (he decides everywhere)
      [w.member2.id, 1], // the open ticket
    ]);
    for (const [id, n] of expected) {
      const view = (await inbox({ id })).view;
      expect(view.total, id).toBe(n);
      expect(view.sections.reduce((sum, s) => sum + s.total, 0), id).toBe(n);
      await loginAs(id);
      expect(await waitingRequestCount(await requireActor()), id).toBe(n);
      expect((await spaces({ id })).waiting, id).toBe(n);
    }
    // nobody else's number reaches somebody else: the lead's answer carries the lead's own (the ticket of the department), not the member's
    expect((await spaces(w.lead)).waiting).toBe(1);
  });

  it("a count that fails degrades to 0: the spaces, the unread numbers and the banner still answer", async () => {
    const w = await busy();
    // (one rejected call; after it the spy passes through to the real count, so it needs no restore)
    vi.spyOn(db.ticket, "count").mockRejectedValueOnce(new Error("boom"));
    await loginAs(w.member.id);
    const res = await call(workspacesRoute.GET, { url: "http://localhost/api/workspaces" });
    expect(res.status).toBe(200);
    expect((res.json as { waiting: number }).waiting).toBe(0);
    expect(((res.json as { organizations: unknown[] }).organizations ?? []).length).toBe(1);
  });

  it("is 0 for a guest and while the switch is off; /api/workspaces keeps every old field", async () => {
    const w = await busy();
    expect((await spaces(w.guest)).waiting).toBe(0);
    await setSettings(w.orgId, {}, { workRequests: false });
    const off = await spaces(w.member);
    expect(off.waiting).toBe(0);
    await loginAs(w.member.id);
    const answer = (await call(workspacesRoute.GET, { url: "http://localhost/api/workspaces" })).json as Record<string, unknown>;
    expect(Object.keys(answer).sort()).toEqual(["currentSpaceId", "foreign", "organizations", "waiting"]);
    expect(Object.keys((answer["organizations"] as Record<string, unknown>[])[0] as object).sort()).toEqual(["canCreateSpaces", "id", "keyPrefix", "name", "role", "workspaces"]);
  });
});

describe("the page", () => {
  const open = async (person: { id: string }, searchParams: Record<string, string> = {}) => {
    await loginAs(person.id);
    return html(RequestsPage({ searchParams }));
  };

  it("ON: «بانتظاري» is the default tab and draws the person's rows with their actions; «طلباتي» is the other tab; the approvals pages are linked", async () => {
    const w = await world();
    await ask(w, w.admin, [w.member.id], { title: "طلب عنوانه ظاهر" });
    const waiting = await open(w.member);
    expect(waiting).toContain("طلب عنوانه ظاهر");
    expect(waiting).toContain(AR["workreq.tab.waiting"]);
    expect(waiting).toContain(AR["workreq.tab.mine"]);
    // the approvals pages (list, detail, forms) stay where they are: «الطلبات» links into them
    expect(waiting).toContain('href="/approvals?v=waiting"');
    expect(waiting).toContain('href="/approvals/forms"');
    expect(waiting).toContain(AR["workreq.approve"]);
    const mine = await open(w.admin, { tab: "mine" });
    expect(mine).toContain("طلب عنوانه ظاهر");
    // nobody else's row is on somebody else's page
    expect(await open(w.member2)).not.toContain("طلب عنوانه ظاهر");
  });

  it("a guest gets the notice and none of the company's text; the owner with nothing waiting gets the empty state", async () => {
    const w = await world();
    await ask(w, w.admin, [w.member.id], { title: "طلب سرّي" });
    const guest = await open(w.guest);
    expect(guest).toContain(AR["guest.no_access"]);
    expect(guest).not.toContain("طلب سرّي");
    expect(await open(w.owner)).toContain(AR["workreq.empty.waiting.title"]);
  });

  it("OFF: the address still serves today's approvals page (the new map's tab never dead-ends)", async () => {
    const w = await world({ on: false });
    await ask(w, w.admin, [w.member.id], { title: "طلب قديم" });
    const page = await open(w.member, { v: "waiting" });
    expect(page).toContain(AR["approvals.title"]);
    expect(page).toContain("طلب قديم");
    // the inbox itself is not drawn: it is the approvals page, as it was
    expect(page).not.toContain("data-work-requests");
    expect(page).toContain("data-approvals-list");
  });
});

describe("a second company", () => {
  it("its rows never appear in this company's lists, and the other way round", async () => {
    const w = await approvalsWorld();
    await setSettings(w.orgId, {}, { workRequests: true });
    await setSettings(w.foreign.org.id, {}, { workRequests: true });
    await db.card.create({ data: { orgId: w.foreign.org.id, workspaceId: w.foreignWs.id, createdById: w.foreign.member.id, kind: "NOTE", title: "بطاقة شركة ثانية", status: "REVIEW" } });
    expect(titles((await inbox(w.owner)).view, "cards")).toEqual([]);
    expect(titles((await inbox(w.foreign.owner)).view, "cards")).toEqual(["بطاقة شركة ثانية"]);
  });
});
