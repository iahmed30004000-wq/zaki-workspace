import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { isSpaceManager } from "@/server/workspace-role";

/**
 * «لوحة المالك» — WHO MAY READ WHAT, in one place. Every page and every route of the board asks `boardAccess` and nothing else.
 *
 *   owner   the OWNER rank WHO HOLDS `board.team` (the primary owner holds everything; a partner unless the primary owner took
 *           it away): every person, every space, the company's totals and the «اليوم» strip. Reading leaves no trace, like
 *           all owner reading. A partner who lost `board.team` falls to the rows below: his own page while he holds
 *           `board.self`, nothing when he holds neither (A1.3: one meaning per rule, a revoked permission works everywhere).
 *   team    holds `board.team` («لوحة الفريق», off until the owner switches it on for a person): the people of the spaces
 *           they manage (space ADMIN, or an org ADMIN who is in it) and of the teams they lead, and ONLY the work that
 *           happened in those spaces / teams. Never the owner's own page, never a partner's, never a guest's, no company
 *           totals. They also read their own page when they hold `board.self`.
 *   self    holds `board.self` («لوحتي», on for every staff rank): their own page, nobody else's, no totals.
 *   nobody  an external partner (a guest), a person holding neither switch, or the company with the feature switched off.
 *
 * ⚠️ Whoever is outside their reach gets 404, never 403: a link to somebody else's page does not even say it exists.
 * 🔧 `reach` is what the screens and routes check a person id against; `scope` is what every query is limited to.
 */

export type BoardMode = "owner" | "team" | "self";

/** What the queries are limited to. `restricted: false` means the whole company. */
export interface BoardScope {
  restricted: boolean;
  /** Tasks, steps and conversations of these spaces count (every project of them). */
  workspaceIds: string[];
  /** Tasks and conversations of these teams count (the projects of a team the person leads, in a space they do not manage). */
  teamIds: string[];
}

export interface BoardAccess {
  mode: BoardMode;
  orgId: string;
  viewerId: string;
  /** The people the viewer may open besides themselves; null: everybody of the company (owner). */
  reach: ReadonlySet<string> | null;
  /** The viewer may open their own page (`board.self`, or the owner). */
  ownPage: boolean;
  /** The company-wide totals and the people table of everybody (owner only). */
  companyWide: boolean;
  scope: BoardScope;
}

const nobody = () => new NotFoundError("ownerboard.not_found");

export async function boardAccess(actor: Actor): Promise<BoardAccess> {
  // a switched-off feature does not exist for anybody, the owner included
  await assertFeatureOn(actor.orgId, "ownerBoard");
  if (actor.isExternal) throw nobody();

  const wantsTeam = actor.caps.has("board.team");
  const wantsSelf = actor.caps.has("board.self");

  // the OWNER rank is the whole company only while it still holds the switch (a partner's can be taken away)
  if (actor.isOwner && wantsTeam) {
    return {
      mode: "owner",
      orgId: actor.orgId,
      viewerId: actor.userId,
      reach: null,
      ownPage: true,
      companyWide: true,
      scope: { restricted: false, workspaceIds: [], teamIds: [] },
    };
  }

  if (!wantsTeam && !wantsSelf) throw nobody();

  if (!wantsTeam) {
    return {
      mode: "self",
      orgId: actor.orgId,
      viewerId: actor.userId,
      reach: new Set(),
      ownPage: true,
      companyWide: false,
      scope: { restricted: false, workspaceIds: [], teamIds: [] },
    };
  }

  const { workspaceIds, teamIds, people } = await teamReach(actor);
  return {
    mode: "team",
    orgId: actor.orgId,
    viewerId: actor.userId,
    reach: people,
    ownPage: wantsSelf,
    companyWide: false,
    scope: { restricted: true, workspaceIds, teamIds },
  };
}

/** May the viewer open this person's page? (Their own, or somebody in reach.) */
export function mayOpenPerson(access: BoardAccess, userId: string): boolean {
  if (userId === access.viewerId) return access.ownPage;
  return access.reach === null || access.reach.has(userId);
}

/** The same, as a refusal: 404 `ownerboard.not_found`. */
export function assertMayOpenPerson(access: BoardAccess, userId: string): void {
  if (!mayOpenPerson(access, userId)) throw nobody();
}

/**
 * The spaces a team lead's board covers and the people in them. Spaces: those they manage (`isSpaceManager`: the space's
 * ADMIN, or an org ADMIN who is in it) that are not archived. Teams: those they lead, in spaces they do not manage
 * (the rest of a managed space is already covered). People: ACTIVE, not guests, not owners, not the viewer.
 */
async function teamReach(actor: Actor): Promise<{ workspaceIds: string[]; teamIds: string[]; people: Set<string> }> {
  const [rows, led] = await Promise.all([
    db.workspaceMember.findMany({
      where: { userId: actor.userId, workspace: { organizationId: actor.orgId, archivedAt: null } },
      select: { workspaceId: true, role: true },
    }),
    db.team.findMany({
      where: { leadId: actor.userId, workspace: { organizationId: actor.orgId, archivedAt: null } },
      select: { id: true, workspaceId: true },
    }),
  ]);
  const managed = new Set(rows.filter((r) => isSpaceManager(actor.role, r.role)).map((r) => r.workspaceId));
  const teams = led.filter((t) => !managed.has(t.workspaceId));
  const workspaceIds = [...managed];
  const teamIds = teams.map((t) => t.id);

  const [spaceRows, teamRows] = await Promise.all([
    workspaceIds.length ? db.workspaceMember.findMany({ where: { workspaceId: { in: workspaceIds } }, select: { userId: true } }) : [],
    teamIds.length ? db.teamMember.findMany({ where: { teamId: { in: teamIds } }, select: { userId: true } }) : [],
  ]);
  const candidates = new Set<string>([...spaceRows.map((r) => r.userId), ...teamRows.map((r) => r.userId)]);
  candidates.delete(actor.userId);
  if (candidates.size === 0) return { workspaceIds, teamIds, people: new Set() };

  const active = await db.organizationMember.findMany({
    where: { organizationId: actor.orgId, status: "ACTIVE", role: { notIn: ["GUEST", "OWNER"] }, userId: { in: [...candidates] } },
    select: { userId: true },
  });
  return { workspaceIds, teamIds, people: new Set(active.map((m) => m.userId)) };
}
