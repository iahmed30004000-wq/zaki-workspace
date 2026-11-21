import type { Prisma, TicketStatus } from "@prisma/client";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { actorCan } from "@/server/policy/actor";
import { approvalsOn } from "@/server/services/approval-access";
import { listApprovals, waitingCount, workSpacesOf } from "@/server/services/approvals";
import { orgSummaryOf } from "@/server/services/features";
import { currentSpace, spacesOf } from "@/server/services/current-space";
import { knowledgeAccess } from "@/server/services/knowledge";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { amountText } from "@/lib/approvals/shared";
import type { ListItem } from "@/lib/approvals/view";
import { KNOWLEDGE_KINDS } from "@/lib/cards/shared";
import { knowledgeSettingsOf } from "@/lib/cards/knowledge-settings";
import { featureOn } from "@/lib/features";
import {
  SECTION_KEYS,
  type ApprovalRow,
  type AssignRow,
  type CardRow,
  type RequestGroup,
  type RequestRow,
  type RequestSection,
  type RequestTab,
  type SectionKey,
  type SheetRow,
  type TicketRow,
  type WorkRequestsView,
} from "@/components/work/requests/types";

/**
 * «الطلبات» (W1.4) — ONE inbox for everything that waits for a decision. It READS; it decides nothing. Every row is acted on through the
 * door that already exists for it (approvals.ts `decideApproval`, task-assign.ts `answerAssignRequest`, tickets.ts `updateTicket`,
 * card-status.ts `setCardStatus`, knowledge.ts `setSheetStatus`), so no rank rule is loosened and no second decision path exists.
 *
 * «بانتظاري» — what waits for ME:
 *   - approvals: the requests whose turn is mine (the same rows as `/approvals?v=waiting`);
 *   - assignment requests: the `TaskAssignRequest` addressed to me, on tasks I may see (P0.2 `taskVisibleWhere`: a private task I am no part
 *     of is not here, and not in the number);
 *   - tickets: the open tickets of MY departments (member or lead) that nobody took, and the ones handed to me;
 *   - cards: cards in «قيد المراجعة» in a space I moderate (the person who may move the status), product sheets excepted;
 *   - sheets: product sheets in review, only for the owner and the approvers the owner named (Q1.1 D-Q4).
 * «طلباتي» — what I asked and still waits: my approvals still open or sent back, my assignment requests, my open tickets, my cards in review.
 *
 * A GUEST (external partner) has no inbox: nothing is read for them. Every count is computed with the rows' own filters, so the number on
 * «الشغل» is exactly the length of «بانتظاري» and never counts what the person may not open. The numbers are the caller's own.
 */

type Who = Pick<Actor, "userId" | "orgId" | "role" | "caps" | "isOwner" | "isExternal">;

/** How many rows a section draws (the newest first); `total` is the real count. */
const ROW_CAP = 30;
const OPEN_TICKET: TicketStatus[] = ["OPEN", "IN_PROGRESS"];

/** Read once per call, only when a section needs it. */
function lazy<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= fn());
}

/**
 * B4 — what one pass reads: `spaceId` narrows the inbox to ONE space (each space is its own account), `null` is every space the person works in; `tickets`
 * says whether the company-wide tickets are part of the pass (a space's list has them: departments have no space; the per-space groups of «الشركة» leave them
 * to the one company-wide group).
 */
interface Pass {
  spaceId: string | null;
  tickets: "include" | "skip" | "only";
}

interface Ctx {
  actor: Who;
  tab: RequestTab;
  withRows: boolean;
  /** The space this pass is narrowed to; null = all of the person's spaces. */
  spaceId: string | null;
  spaces: () => Promise<Awaited<ReturnType<typeof workSpacesOf>>>;
  scope: () => Promise<Awaited<ReturnType<typeof loadWorkScope>>>;
  keyPrefix: () => Promise<string>;
  /** The company's knowledge space when «المنتجات» is on, whether this person works in it, and whether they approve its sheets. */
  knowledge: () => Promise<{ spaceId: string | null; member: boolean; approver: boolean }>;
}

function contextOf(actor: Who, tab: RequestTab, withRows: boolean, spaceId: string | null): Ctx {
  return {
    actor,
    tab,
    withRows,
    spaceId,
    spaces: lazy(() => workSpacesOf(actor)),
    scope: lazy(() => loadWorkScope(actor.userId)),
    keyPrefix: lazy(async () => (await db.organization.findUnique({ where: { id: actor.orgId }, select: { keyPrefix: true } }))?.keyPrefix ?? "ZK"),
    knowledge: lazy(async () => {
      const settings = (await orgSummaryOf(actor.orgId))?.settings ?? {};
      if (!featureOn(settings, "knowledgeCards")) return { spaceId: null, member: false, approver: false };
      const spaceId = knowledgeSettingsOf(settings).spaceId;
      if (!spaceId) return { spaceId: null, member: false, approver: false };
      // the person's own place in the space (staff of the space; the owner): anything else is simply «not in it»
      return knowledgeAccess(actor as Actor).then(
        (access) => ({ spaceId, member: true, approver: access.approver }),
        () => ({ spaceId, member: false, approver: false }),
      );
    }),
  };
}

const names = async (ids: string[]): Promise<Map<string, string>> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
};

const newestFirst = <T extends { at: string }>(rows: T[]): T[] => [...rows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

// ───────────────────────────────────────────────────── approvals ─────────────────────────────────────────────────────

function approvalRow(item: ListItem, canDecide: boolean): ApprovalRow {
  return {
    kind: "approval",
    id: item.id,
    title: item.title,
    at: item.createdAt,
    href: `/approvals/${item.id}`,
    place: item.workspaceName || null,
    byName: item.requester.name,
    amount: item.amount ? amountText(item.amount.minor, item.amount.currency) : null,
    status: item.status,
    waitingOn: item.waitingOn?.name ?? null,
    canDecide,
  };
}

async function approvalsSection(c: Ctx): Promise<RequestSection | null> {
  // the switch `approvals` is the owner's: off, the section does not exist (nothing of approvals answers)
  if (!(await approvalsOn(c.actor.orgId))) return null;
  if (c.tab === "waiting") {
    const total = await waitingCount(c.actor, { workspaceId: c.spaceId });
    const items = c.withRows && total > 0 ? await listApprovals(c.actor, { view: "waiting", limit: ROW_CAP, workspaceId: c.spaceId }) : [];
    return { key: "approvals", total, rows: items.map((item) => approvalRow(item, true)), allHref: "/approvals?v=waiting" };
  }
  const [pending, sentBack] = await Promise.all([
    listApprovals(c.actor, { view: "mine", status: "PENDING", limit: 200, workspaceId: c.spaceId }),
    listApprovals(c.actor, { view: "mine", status: "CHANGES_REQUESTED", limit: 200, workspaceId: c.spaceId }),
  ]);
  const all = newestFirst([...pending, ...sentBack].map((item) => approvalRow(item, false)));
  return { key: "approvals", total: all.length, rows: c.withRows ? all.slice(0, ROW_CAP) : [], allHref: "/approvals?v=mine" };
}

// ───────────────────────────────────────────────────── assignment requests ─────────────────────────────────────────────────────

async function assignmentsSection(c: Ctx): Promise<RequestSection> {
  const scope = await c.scope();
  const where: Prisma.TaskAssignRequestWhereInput = {
    orgId: c.actor.orgId,
    status: "PENDING",
    ...(c.tab === "waiting" ? { toUserId: c.actor.userId } : { fromUserId: c.actor.userId }),
    // only on tasks the person may open: a private task they are no part of is neither listed nor counted; B4: and of the space the pass is for
    task: c.spaceId ? { AND: [taskVisibleWhere(scope), { workspaceId: c.spaceId }] } : taskVisibleWhere(scope),
  };
  const total = await db.taskAssignRequest.count({ where });
  if (!c.withRows || total === 0) return { key: "assignments", total, rows: [], allHref: null };
  const found = await db.taskAssignRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ROW_CAP,
    select: {
      id: true,
      taskId: true,
      fromUserId: true,
      toUserId: true,
      asCo: true,
      createdAt: true,
      task: { select: { number: true, title: true, workspaceId: true } },
    },
  });
  const [people, prefix, spaceNames] = await Promise.all([
    names(found.flatMap((r) => [r.fromUserId, r.toUserId])),
    c.keyPrefix(),
    db.workspace.findMany({ where: { id: { in: [...new Set(found.map((r) => r.task.workspaceId))] } }, select: { id: true, name: true } }),
  ]);
  const spaceName = new Map(spaceNames.map((w) => [w.id, w.name]));
  const rows: AssignRow[] = found.map((r) => ({
    kind: "assign",
    id: r.id,
    title: r.task.title,
    at: r.createdAt.toISOString(),
    href: `/tasks/${r.taskId}`,
    place: spaceName.get(r.task.workspaceId) ?? null,
    taskId: r.taskId,
    requestId: r.id,
    key: `${prefix}-${r.task.number}`,
    fromName: people.get(r.fromUserId) ?? "",
    toName: people.get(r.toUserId) ?? "",
    asCo: r.asCo,
    canAnswer: c.tab === "waiting",
  }));
  return { key: "assignments", total, rows, allHref: null };
}

// ───────────────────────────────────────────────────── tickets ─────────────────────────────────────────────────────

async function ticketsSection(c: Ctx): Promise<RequestSection | null> {
  // the same box the tickets pages need
  if (!actorCan(c.actor, "tickets.view")) return null;
  const me = c.actor.userId;
  let where: Prisma.TicketWhereInput;
  if (c.tab === "waiting") {
    const mine = await db.department.findMany({
      where: { orgId: c.actor.orgId, OR: [{ leadId: me }, { memberships: { some: { userId: me } } }] },
      select: { id: true },
    });
    if (mine.length === 0) return { key: "tickets", total: 0, rows: [], allHref: "/tickets" };
    // «open» for a department: nobody took it yet, or it was handed to me and is not finished
    where = {
      orgId: c.actor.orgId,
      departmentId: { in: mine.map((d) => d.id) },
      OR: [{ status: "OPEN", assigneeId: null }, { assigneeId: me, status: { in: OPEN_TICKET } }],
    };
  } else {
    where = { orgId: c.actor.orgId, creatorId: me, status: { in: OPEN_TICKET } };
  }
  const total = await db.ticket.count({ where });
  if (!c.withRows || total === 0) return { key: "tickets", total, rows: [], allHref: "/tickets" };
  const found = await db.ticket.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ROW_CAP,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      priority: true,
      assigneeId: true,
      createdAt: true,
      department: { select: { name: true } },
      assignee: { select: { name: true } },
    },
  });
  const prefix = await c.keyPrefix();
  const mayEdit = actorCan(c.actor, "tickets.edit");
  const rows: TicketRow[] = found.map((t) => ({
    kind: "ticket",
    id: t.id,
    title: t.title,
    at: t.createdAt.toISOString(),
    href: "/tickets",
    place: t.department?.name ?? null,
    key: `${prefix}-T${t.number}`,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee?.name ?? null,
    // acting is the ticket's own update: the person is of the department (so `canEditTicket` holds) and holds `tickets.edit`
    canTake: c.tab === "waiting" && mayEdit && (t.assigneeId !== me || t.status === "OPEN"),
    canResolve: c.tab === "waiting" && mayEdit && t.assigneeId === me && t.status === "IN_PROGRESS",
  }));
  return { key: "tickets", total, rows, allHref: "/tickets" };
}

// ───────────────────────────────────────────────────── cards and sheets ─────────────────────────────────────────────────────

async function cardsSection(c: Ctx): Promise<RequestSection | null> {
  const spaces = await c.spaces();
  const seesFiles = !c.actor.isExternal && actorCan(c.actor, "files.view");
  const cardKindsHidden = seesFiles ? [...KNOWLEDGE_KINDS] : ["FILE", ...KNOWLEDGE_KINDS];
  let where: Prisma.CardWhereInput;
  if (c.tab === "waiting") {
    // the people who may move the status: those who moderate the card's space (the owner everywhere)
    const managed = spaces.filter((s) => s.manager && (!c.spaceId || s.id === c.spaceId)).map((s) => s.id);
    if (managed.length === 0) return null;
    where = {
      orgId: c.actor.orgId,
      workspaceId: { in: managed },
      status: "REVIEW",
      archivedAt: null,
      workspace: { archivedAt: null },
      // the cards door (cards.ts `loadCard`) never serves a product sheet or a general answer: those are the knowledge door's, listed under «sheets»;
      // and a space's file cards are closed to somebody whose library box is off
      kind: { notIn: cardKindsHidden },
    };
  } else {
    where = {
      orgId: c.actor.orgId,
      createdById: c.actor.userId,
      workspaceId: { in: spaces.filter((s) => !c.spaceId || s.id === c.spaceId).map((s) => s.id) },
      status: "REVIEW",
      archivedAt: null,
      workspace: { archivedAt: null },
      kind: { notIn: cardKindsHidden },
    };
  }
  const total = await db.card.count({ where });
  if (!c.withRows || total === 0) return { key: "cards", total, rows: [], allHref: null };
  const found = await db.card.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: ROW_CAP,
    select: { id: true, title: true, kind: true, updatedAt: true, workspace: { select: { name: true } }, createdBy: { select: { name: true } } },
  });
  const rows: CardRow[] = found.map((card) => ({
    kind: "card",
    id: card.id,
    title: card.title,
    at: card.updatedAt.toISOString(),
    href: `/cards/${card.id}`,
    place: card.workspace.name,
    cardKind: card.kind,
    byName: card.createdBy.name,
    canDecide: c.tab === "waiting",
  }));
  return { key: "cards", total, rows, allHref: null };
}

async function sheetsSection(c: Ctx): Promise<RequestSection | null> {
  // «بانتظاري»: only for the owner and the approvers he named; «طلباتي»: the sheets I sent to review, for anybody who works in the knowledge space
  const knowledge = await c.knowledge();
  if (!knowledge.spaceId || !(c.tab === "waiting" ? knowledge.approver : knowledge.member)) return null;
  // B4: the sheets are the knowledge space's own: they wait in that space, not in the others
  if (c.spaceId && c.spaceId !== knowledge.spaceId) return null;
  const where: Prisma.CardWhereInput = {
    orgId: c.actor.orgId,
    workspaceId: knowledge.spaceId,
    workspace: { archivedAt: null },
    kind: { in: [...KNOWLEDGE_KINDS] },
    status: "REVIEW",
    archivedAt: null,
    ...(c.tab === "mine" ? { createdById: c.actor.userId } : {}),
  };
  const total = await db.card.count({ where });
  if (!c.withRows || total === 0) return { key: "sheets", total, rows: [], allHref: "/knowledge" };
  const found = await db.card.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: ROW_CAP,
    select: { id: true, title: true, version: true, updatedAt: true, workspace: { select: { name: true } }, createdBy: { select: { name: true } } },
  });
  const rows: SheetRow[] = found.map((card) => ({
    kind: "sheet",
    id: card.id,
    title: card.title,
    at: card.updatedAt.toISOString(),
    href: `/knowledge/${card.id}`,
    place: card.workspace.name,
    byName: card.createdBy.name,
    version: card.version,
    canDecide: c.tab === "waiting",
  }));
  return { key: "sheets", total, rows, allHref: "/knowledge" };
}

// ───────────────────────────────────────────────────── the inbox ─────────────────────────────────────────────────────

async function sectionsOf(actor: Who, tab: RequestTab, withRows: boolean, pass: Pass = { spaceId: null, tickets: "include" }): Promise<RequestSection[]> {
  // an external partner has no inbox: nothing is read for them
  if (actor.isExternal || actor.role === "GUEST") return [];
  const c = contextOf(actor, tab, withRows, pass.spaceId);
  const builders: Record<SectionKey, (ctx: Ctx) => Promise<RequestSection | null>> = {
    approvals: approvalsSection,
    assignments: assignmentsSection,
    tickets: ticketsSection,
    cards: cardsSection,
    sheets: sheetsSection,
  };
  const keys = SECTION_KEYS.filter((key) => (pass.tickets === "only" ? key === "tickets" : pass.tickets === "skip" ? key !== "tickets" : true));
  const built = await Promise.all(keys.map((key) => builders[key](c)));
  return built.filter((section): section is RequestSection => section !== null);
}

/** The flat sections of several passes put together (one per kind, in the screen's order): totals added, the newest rows kept. */
function mergeSections(lists: RequestSection[][]): RequestSection[] {
  return SECTION_KEYS.flatMap((key) => {
    const parts = lists.flatMap((list) => list.filter((s) => s.key === key));
    if (parts.length === 0) return [];
    return [{ key, total: parts.reduce((sum, s) => sum + s.total, 0), rows: newestFirst(parts.flatMap((s) => s.rows)).slice(0, ROW_CAP), allHref: parts.find((s) => s.allHref)?.allHref ?? null }];
  });
}

/**
 * B4 — «الشركة»: the view over ALL the person's spaces. One pass per space (tickets left out), then the company-wide tickets once; a space with nothing
 * waiting has no group. The flat `sections` are these groups put together, so the total and Today's rows are the same numbers.
 */
async function groupedSections(actor: Who, tab: RequestTab, withRows: boolean): Promise<{ sections: RequestSection[]; groups: RequestGroup[] }> {
  if (actor.isExternal || actor.role === "GUEST") return { sections: [], groups: [] };
  const spaces = await spacesOf({ userId: actor.userId, orgId: actor.orgId, role: actor.role });
  const [perSpace, company] = await Promise.all([
    Promise.all(spaces.map(async (space) => ({ space, sections: await sectionsOf(actor, tab, withRows, { spaceId: space.id, tickets: "skip" }) }))),
    sectionsOf(actor, tab, withRows, { spaceId: null, tickets: "only" }),
  ]);
  const groups: RequestGroup[] = [
    ...perSpace.map(({ space, sections }): RequestGroup => ({ spaceId: space.id, name: space.name, total: sections.reduce((sum, s) => sum + s.total, 0), sections })),
    { spaceId: null, name: null, total: company.reduce((sum, s) => sum + s.total, 0), sections: company },
  ].filter((g) => g.total > 0);
  return { sections: mergeSections(groups.map((g) => g.sections)), groups };
}

/** How the inbox is cut (B4): `spaceId` = that one space; `groups` = every space, grouped (inside «الشركة»); nothing = every space, flat (the service's old shape). */
export interface RequestsScope {
  spaceId?: string | null;
  groups?: boolean;
}

/**
 * The scope of the person's request: the space they are in (each space is its own account) and, inside «الشركة» or with no space, all of them grouped.
 * Reads the cookie, so only a request's code may call it.
 */
export async function requestsScopeHere(actor: Who): Promise<RequestsScope> {
  const space = await currentSpace({ userId: actor.userId, orgId: actor.orgId, role: actor.role });
  return !space || space.kind === "HQ" ? { groups: true } : { spaceId: space.id };
}

/** The person's own lists for one tab. The caller (route or page) has checked the switch and refused a guest. */
export async function workRequestsOf(actor: Who, tab: RequestTab, scope: RequestsScope = {}): Promise<WorkRequestsView> {
  const head = { tab, viewerId: actor.userId, builtAt: new Date().toISOString() };
  if (scope.groups) {
    const { sections, groups } = await groupedSections(actor, tab, true);
    return { ...head, space: null, groups, total: sections.reduce((sum, s) => sum + s.total, 0), sections };
  }
  const spaceId = scope.spaceId ?? null;
  const [sections, space] = await Promise.all([
    sectionsOf(actor, tab, true, { spaceId, tickets: "include" }),
    spaceId ? db.workspace.findFirst({ where: { id: spaceId, organizationId: actor.orgId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  return { ...head, ...(spaceId ? { space } : {}), total: sections.reduce((sum, s) => sum + s.total, 0), sections };
}

/** The number on «الشغل»: how many things wait for this person (the length of «بانتظاري» in the space they are in); counts only, no rows are read. */
export async function waitingRequestCount(actor: Who, scope: RequestsScope = {}): Promise<number> {
  if (scope.groups) return (await groupedSections(actor, "waiting", false)).sections.reduce((sum, s) => sum + s.total, 0);
  const sections = await sectionsOf(actor, "waiting", false, { spaceId: scope.spaceId ?? null, tickets: "include" });
  return sections.reduce((sum, s) => sum + s.total, 0);
}

export type { RequestRow };
