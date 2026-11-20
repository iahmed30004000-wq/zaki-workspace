import type { OrgRole, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { perRequest } from "@/server/env";
import type { Actor } from "@/server/policy/actor";
import { isSpaceManager } from "@/server/workspace-role";

/**
 * «فريقي» — ONE MEANING (D-A3, A2.3). Before this file the same words meant three things: the spaces I manage plus the teams I lead,
 * the people under me by `managerId`, and every space I can open for `users.manage`, so one KPI showed three numbers side by side.
 *
 *   MY TEAM = everybody under me in the reporting line: `OrganizationMember.managerId`, transitive, ACTIVE people only, never a guest
 *   and never an OWNER rank, at most `PEOPLE_SCOPE_DEPTH` levels, inside the viewer's own company (the line is per company).
 *
 *   «company»  the OWNER rank that still holds `board.team` (a partner can have it taken away: A1.3): the whole company.
 *   «reports»  anybody else with at least one report: exactly those people, nothing about anybody else.
 *   «none»     nobody under them (or an external partner): there is NO team, so a card shows nothing instead of a 0.
 *
 * The SPACE numbers of the spaces a person manages (`managedSpaceIds`) are a second, separate thing shown under «المساحات»; they are
 * never mixed into «my team».
 *
 * ⚠️ This file decides WHO is in a scope. It never decides which TASKS a person may see: every number built from it is ALSO read through
 * `taskVisibleWhere` (P0.2), so a count that includes a task the viewer may not open is impossible by construction.
 * 🔧 Not `src/server/services/team-scope.ts`: that file means the «مقاطع» inside one space and carries `taskVisibleWhere`.
 */

/** The reporting line is capped at this many levels (the same cap the writes enforce). */
export const PEOPLE_SCOPE_DEPTH = 6;

export type PeopleScopeKind = "company" | "reports" | "none";

export interface PeopleScope {
  orgId: string;
  viewerId: string;
  kind: PeopleScopeKind;
  /** ACTIVE staff under the viewer; empty for «company» (everybody) and «none». Never contains the viewer. */
  reportIds: ReadonlySet<string>;
}

/** What a number was counted over, in data (the chip says it in words). `spaceName` is set when the page narrowed the numbers to one space. */
export interface TeamScopeInfo {
  who: "company" | "reports";
  spaceName: string | null;
}

/** One person's line, as stored. */
export interface LineRow {
  userId: string;
  managerId: string | null;
  role: OrgRole;
  status: string;
}

/**
 * Everybody below `rootId` — direct and indirect, ACTIVE staff only (not a guest, not an OWNER rank), at most `depth` levels. The walk
 * follows the line THROUGH a suspended or offboarded person (their people do not drop out of the tree), but never lists them. A loop in
 * old data ends: a person is visited once. Pure.
 */
export function reportsFromLines(rows: readonly LineRow[], rootId: string, depth: number = PEOPLE_SCOPE_DEPTH): string[] {
  const children = new Map<string, string[]>();
  const info = new Map<string, LineRow>();
  for (const r of rows) {
    info.set(r.userId, r);
    if (!r.managerId) continue;
    const list = children.get(r.managerId) ?? [];
    list.push(r.userId);
    children.set(r.managerId, list);
  }
  const seen = new Set<string>([rootId]);
  const out: string[] = [];
  let level = [rootId];
  for (let d = 0; d < depth && level.length; d++) {
    const next: string[] = [];
    for (const id of level) {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        next.push(child);
        const row = info.get(child);
        if (row && row.status === "ACTIVE" && row.role !== "GUEST" && row.role !== "OWNER") out.push(child);
      }
    }
    level = next;
  }
  return out;
}

/** Does this person have a team at all? (A card, a widget or a tab for it is drawn only then.) */
export const hasTeam = (scope: PeopleScope): boolean => scope.kind !== "none";

/** The chip of a scope (what the numbers were counted over). */
export const teamScopeInfoOf = (scope: PeopleScope, spaceName: string | null = null): TeamScopeInfo | null =>
  scope.kind === "none" ? null : { who: scope.kind, spaceName };

/**
 * The people's part of a task question: the company, or the tasks held (as the primary person or beside them) by somebody in the team.
 * «none» matches nothing. It is only the PEOPLE part: always combine it with `taskVisibleWhere`.
 */
export function teamTaskWhere(scope: PeopleScope): Prisma.TaskWhereInput {
  if (scope.kind === "company") return {};
  if (scope.kind === "none" || scope.reportIds.size === 0) return { id: { in: [] } };
  const ids = [...scope.reportIds];
  return { OR: [{ assigneeId: { in: ids } }, { coAssignees: { some: { userId: { in: ids } } } }] };
}

/** Is this person (a task's holder) inside the scope? */
export const inTeam = (scope: PeopleScope, userId: string): boolean => scope.kind === "company" || scope.reportIds.has(userId);

/**
 * The company's lines (all statuses, so a chain through a suspended person holds), read ONCE per server render (`perRequest`): the page, the
 * pulse, the strip and the board all ask. The key is the company's id (a string); nothing outlives the render, a line changed is seen by the
 * very next request. The array is shared by the render's callers: nobody changes it.
 */
const orgLines = perRequest(
  async (orgId: string): Promise<LineRow[]> =>
    db.organizationMember.findMany({ where: { organizationId: orgId }, select: { userId: true, managerId: true, role: true, status: true } }),
);

/**
 * Who is «my team» for this person. At most one query over the company's lines (once per render). An external partner has none; the OWNER rank
 * holding `board.team` has the company.
 */
export async function loadPeopleScope(actor: Pick<Actor, "userId" | "orgId" | "isOwner" | "isExternal" | "caps">): Promise<PeopleScope> {
  const base = { orgId: actor.orgId, viewerId: actor.userId };
  if (actor.isExternal) return { ...base, kind: "none", reportIds: new Set() };
  if (actor.isOwner && actor.caps.has("board.team")) return { ...base, kind: "company", reportIds: new Set() };
  const reportIds = new Set(reportsFromLines(await orgLines(actor.orgId), actor.userId));
  return { ...base, kind: reportIds.size > 0 ? "reports" : "none", reportIds };
}

/**
 * The spaces whose SPACE numbers a person reads under «المساحات»: not archived, of their company, where they manage the space
 * (`isSpaceManager`: the OWNER, the space's ADMIN, an org ADMIN who is in it). Never confused with «my team».
 */
export async function managedSpaceIds(actor: Pick<Actor, "userId" | "orgId" | "role">): Promise<string[]> {
  const rows = await db.workspaceMember.findMany({
    where: { userId: actor.userId, workspace: { organizationId: actor.orgId, archivedAt: null } },
    select: { workspaceId: true, role: true },
  });
  return rows.filter((r) => isSpaceManager(actor.role, r.role)).map((r) => r.workspaceId);
}
