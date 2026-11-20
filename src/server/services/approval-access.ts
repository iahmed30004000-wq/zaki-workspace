import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { featureOn } from "@/lib/features";
import { purposeOf, type FormPurpose } from "@/lib/approvals/forms";
import { assertFeatureOn } from "@/server/services/features";
import { holdsCapability } from "@/server/services/active-people";
import { canWriteInWorkspace, isSpaceManager } from "@/server/workspace-role";

/**
 * «طلبات الموافقة» — WHO MAY DO WHAT, in one place. Every route, page and service of approvals and forms asks here.
 *
 *   the switch   `approvals` in «الميزات»: off, nothing answers (404 `features.off`) for anybody, the owner included.
 *   a guest      an external partner never creates, sees or is asked (403 `guest.no_access`); the amount never reaches them
 *                because nothing does.
 *   in a space   a request belongs to ONE space. Only people who work in it (a row in the space that is not a guest's, an
 *                ACTIVE organization membership) can ask, be asked or read; the OWNER reads every space without a row.
 *   a reader     the requester, a person named in the chain, the space's managers (its ADMIN, an org ADMIN who is in it) and
 *                the OWNER. Anybody else gets 404, never 403: a link says nothing.
 *   a decider    ONLY the named approver whose turn it is. The owner reading silently decides nothing unless he is that
 *                approver: then he decides as himself, like anybody.
 *
 * ⚠️ Rank, status and the space row are read from the database on every call, never from the cookie.
 */

export interface PersonCtx {
  userId: string;
  orgId: string;
  /** The rank held in this company (read from the database by the caller's guard). */
  role: string;
}

/** The switch is on and the person is not an external partner. Called first by everything. */
export async function approvalsGate(actor: { orgId: string; role: string }): Promise<void> {
  await assertFeatureOn(actor.orgId, "approvals");
  if (actor.role === "GUEST") throw new ForbiddenError("guest.no_access");
}

/** Is the company's switch on (for pages and the map; never throws). */
export async function approvalsOn(orgId: string): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return featureOn(org?.settings ?? {}, "approvals");
}

export interface SpaceViewer {
  /** Works in the space (may ask, be asked, read what is theirs). */
  sees: boolean;
  /** Reads every request of the space (its ADMIN, an org ADMIN in it, the OWNER). */
  manager: boolean;
  /** The OWNER rank: every space, read without a trace. */
  owner: boolean;
  /** The space exists in this company (a missing or foreign one is false for everybody). */
  exists: boolean;
  archived: boolean;
}

const NOBODY: SpaceViewer = { sees: false, manager: false, owner: false, exists: false, archived: false };

/** What this person is in this space, from the database. */
export async function spaceViewer(who: PersonCtx, workspaceId: string): Promise<SpaceViewer> {
  const space = await db.workspace.findFirst({ where: { id: workspaceId, organizationId: who.orgId }, select: { archivedAt: true } });
  if (!space) return NOBODY;
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: who.orgId, userId: who.userId } },
    select: { role: true, status: true },
  });
  if (!member || member.status !== "ACTIVE" || member.role === "GUEST") return { ...NOBODY, exists: true, archived: space.archivedAt !== null };
  const row = member.role === "OWNER" ? null : await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: who.userId } }, select: { role: true } });
  const wsRole = row?.role ?? null;
  return {
    sees: canWriteInWorkspace(member.role, wsRole),
    manager: isSpaceManager(member.role, wsRole),
    owner: member.role === "OWNER",
    exists: true,
    archived: space.archivedAt !== null,
  };
}

/**
 * I1.3 - does this person see the AMOUNT of an office-money request? Only a holder of `prices.view` or `cash.view` (read from the database, a guest
 * and a suspended person hold neither). The person who asked is told by the caller: they always see their own.
 */
export async function seesMoney(who: { orgId: string; userId: string }): Promise<boolean> {
  return (await holdsCapability(who, "cash.view")) || (await holdsCapability(who, "prices.view"));
}

/** Of these form rows (a request's `formId`), the ones that are money forms, with their purpose. A null or an ordinary form is not in the map. */
export async function moneyForms(formIds: readonly (string | null)[]): Promise<Map<string, FormPurpose>> {
  const ids = [...new Set(formIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db.formTemplate.findMany({ where: { id: { in: ids } }, select: { id: true, schema: true } });
  const out = new Map<string, FormPurpose>();
  for (const row of rows) {
    const purpose = purposeOf(row.schema);
    if (purpose) out.set(row.id, purpose);
  }
  return out;
}

/** May this person read this request? (`approverIds`: everybody named in ANY version of its chain.) */
export function mayRead(viewer: SpaceViewer, userId: string, request: { requesterId: string }, approverIds: readonly string[]): boolean {
  if (!viewer.sees) return false;
  return viewer.manager || request.requesterId === userId || approverIds.includes(userId);
}

/** Can this other person be asked, or ask: ACTIVE in the company, not a guest, working in the space? One read each. */
export async function canWorkInSpace(orgId: string, workspaceId: string, userId: string): Promise<boolean> {
  const viewer = await spaceViewer({ userId, orgId, role: "" }, workspaceId);
  return viewer.sees;
}

export interface Candidate {
  id: string;
  name: string;
  role: string;
}

/** The people who may be asked in a space: everybody who works in it (staff, ACTIVE), the owner included. Sorted by name. */
export async function eligibleApprovers(orgId: string, workspaceId: string): Promise<Candidate[]> {
  const space = await db.workspace.findFirst({ where: { id: workspaceId, organizationId: orgId }, select: { id: true } });
  if (!space) return [];
  const rows = await db.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, role: true } });
  const wsRoleOf = new Map(rows.map((r) => [r.userId, r.role] as const));
  const members = await db.organizationMember.findMany({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      role: { not: "GUEST" },
      OR: [{ role: "OWNER" }, { userId: { in: rows.map((r) => r.userId) } }],
    },
    select: { userId: true, role: true, user: { select: { name: true } } },
  });
  return members
    .filter((m) => canWriteInWorkspace(m.role, wsRoleOf.get(m.userId) ?? null))
    .map((m) => ({ id: m.userId, name: m.user.name, role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** Of these people, the ones who may NOT be asked in this space (empty: all fine). */
export async function ineligible(orgId: string, workspaceId: string, userIds: readonly string[]): Promise<string[]> {
  const ok = new Set((await eligibleApprovers(orgId, workspaceId)).map((c) => c.id));
  return userIds.filter((id) => !ok.has(id));
}

/**
 * The gate of the file routes for a file an approval request holds: the person reads it when they may read one of the requests
 * it is attached to (switch on, working in the space, requester, named, manager or owner). Everything else is «no». It never
 * throws: `assertMayReadFile` falls through to its own 404.
 */
export async function mayReadApprovalFile(who: PersonCtx, fileId: string): Promise<boolean> {
  if (who.role === "GUEST") return false;
  if (!(await approvalsOn(who.orgId))) return false;
  const links = await db.approvalAttachment.findMany({ where: { fileId }, select: { requestId: true } });
  for (const link of links) {
    const request = await db.approvalRequest.findFirst({
      where: { id: link.requestId, orgId: who.orgId },
      select: { workspaceId: true, requesterId: true, formId: true, steps: { select: { approverId: true } } },
    });
    if (!request) continue;
    const viewer = await spaceViewer(who, request.workspaceId);
    if (!mayRead(viewer, who.userId, request, request.steps.map((s) => s.approverId))) continue;
    // the invoice photo of an office-money request shows its amount: it follows the amount's rule (the person who asked keeps their own)
    if (request.formId && request.requesterId !== who.userId && (await moneyForms([request.formId])).has(request.formId) && !(await seesMoney(who))) continue;
    return true;
  }
  return false;
}

/** 404 for a request the person may not read, the same as for one that does not exist. */
export const notFound = () => new NotFoundError("approvals.not_found");
