import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import type { ManagerMap } from "@/lib/team-development";
import { reportsFromLines } from "@/server/policy/people-scope";

/**
 * «الأداء والتطوير» — WHO MAY READ AND WRITE WHAT, in one place. Every page and every route of the feature asks
 * `devAccess` and nothing else; a service never decides access on its own.
 *
 *   owner        the OWNER rank (the primary owner and his partners: `actor.isOwner`): every person, every record, silently
 *                (reading leaves no audit row, no notification, no «seen»). ENTERING and the lines are the two capabilities
 *                below, which the primary owner holds and a partner holds unless they were taken away (A1.3).
 *   supervisor   anybody with at least one ACTIVE report: READS their subtree (direct and indirect) whatever their rank is.
 *                ENTERING anything about somebody else (skills, reviews, plans, notes) also needs `people.review`.
 *   lines        `people.manage_lines` («الهيكل»): sets who answers to whom and keeps the skills checklist. It reads the
 *                tree of names, never a score or a review.
 *   self         every staff member: their own skills (both columns), their own SHARED reviews and notes, their own plan and
 *                score. Never another person's.
 *   nobody       an external partner (a guest), or the company with the feature switched off.
 *
 * ⚠️ Whoever is outside their reach gets 404, never 403: a link to somebody else's page does not even say it exists.
 * 🔧 `reach` is what every screen and route checks a person id against. A person's own supervisor reads them whatever the
 *    supervisor's rank is: the line is data (`managerId`), not a rank comparison. Suspended and offboarded people are not in a
 *    supervisor's reach: their history is the owner's alone.
 */

export interface DevAccess {
  orgId: string;
  viewerId: string;
  viewerRole: OrgRole;
  isOwner: boolean;
  /** At least one ACTIVE report. */
  isSupervisor: boolean;
  /** Sets the lines and keeps the skills catalogue (`people.manage_lines`: the owner rank holds it unless it was taken from a partner). */
  canManageLines: boolean;
  /** Enters skills, reviews, plans and notes about people in reach (`people.review`: the owner rank holds it unless it was taken from a partner). */
  canReview: boolean;
  /** The people below the viewer, ACTIVE staff only; null for the owner (everybody). Never contains the viewer. */
  reach: ReadonlySet<string> | null;
  /** person → manager over every row of the company, so a chain through a suspended person still holds. */
  managerOf: ManagerMap;
  /** Every non-guest member of the company, any status: what the owner may open (suspended and offboarded people included). */
  members: ReadonlyMap<string, { role: OrgRole; status: string }>;
  /** The company's ACTIVE staff (not guests): the people lists and pickers are made from these. */
  staff: ReadonlyMap<string, { name: string; jobTitle: string | null; role: OrgRole }>;
}

const nobody = () => new NotFoundError("teamdev.not_found");

export async function devAccess(actor: Actor): Promise<DevAccess> {
  // a switched-off feature does not exist for anybody, the owner included
  await assertFeatureOn(actor.orgId, "teamDevelopment");
  if (actor.isExternal) throw nobody();

  // all-statuses: a chain that runs through a suspended or offboarded person must still be followed, and the owner reads them
  const rows = await db.organizationMember.findMany({
    where: { organizationId: actor.orgId },
    select: { userId: true, managerId: true, role: true, status: true, user: { select: { name: true, jobTitle: true } } },
  });
  const managerOf = new Map(rows.map((r) => [r.userId, r.managerId] as const));
  const staff = new Map(
    rows.filter((r) => r.status === "ACTIVE" && r.role !== "GUEST").map((r) => [r.userId, { name: r.user.name, jobTitle: r.user.jobTitle ?? null, role: r.role }] as const),
  );
  const members = new Map(rows.filter((r) => r.role !== "GUEST").map((r) => [r.userId, { role: r.role, status: r.status }] as const));
  // «فريقي» (A2.3, D-A3): the one rule of policy/people-scope.ts: ACTIVE staff below the viewer, through any status, depth ≤ 6
  const below = reportsFromLines(rows, actor.userId);
  const reach = actor.isOwner ? null : new Set(below);
  return {
    orgId: actor.orgId,
    viewerId: actor.userId,
    viewerRole: actor.role,
    isOwner: actor.isOwner,
    isSupervisor: below.length > 0,
    // the capability alone: the owner rank holds both (the primary owner always, a partner unless they were taken away)
    canManageLines: actor.caps.has("people.manage_lines"),
    canReview: actor.caps.has("people.review"),
    reach,
    managerOf,
    members,
    staff,
  };
}

/** May the viewer OPEN this person's file at all (their own, or somebody in reach)? */
export function mayOpenPerson(access: DevAccess, userId: string): boolean {
  if (userId === access.viewerId) return true;
  if (access.reach === null) return access.members.has(userId); // the owner: any non-guest member of the company, any status
  return access.reach.has(userId);
}

/** The same, as a refusal: 404 `teamdev.not_found`. */
export function assertMayOpenPerson(access: DevAccess, userId: string): void {
  if (!mayOpenPerson(access, userId)) throw nobody();
}

/** The person is the viewer, as far as «my own file» goes. */
export const isSelf = (access: DevAccess, userId: string): boolean => userId === access.viewerId;

/** May the viewer read what only REVIEWERS see about this person (the owner, or a supervisor of theirs)? Never the person themselves. */
export function readsAsReviewer(access: DevAccess, userId: string): boolean {
  if (userId === access.viewerId) return false;
  return access.reach === null ? access.members.has(userId) : access.reach.has(userId);
}

/**
 * May the viewer ENTER something about this person (a manual skill level, a review, a plan item, a note)? Not about themselves
 * (their own estimate is a SELF entry), and a supervisor needs `people.review` besides the subtree.
 */
export function mayEnterFor(access: DevAccess, userId: string): boolean {
  if (userId === access.viewerId) return false;
  if (!access.canReview) return false;
  return access.isOwner ? access.staff.has(userId) : (access.reach?.has(userId) ?? false);
}

export function assertMayEnterFor(access: DevAccess, userId: string): void {
  // outside reach the person does not exist for the viewer (404); inside reach without `people.review` the form was never
  // offered: 403 `teamdev.review_denied` (the viewer already reads this person, so it tells them nothing new)
  if (!readsAsReviewer(access, userId)) throw nobody();
  // a suspended or offboarded person takes nothing new (the owner still reads their history): not found, like any person who is gone
  if (!access.staff.has(userId)) throw nobody();
  if (!mayEnterFor(access, userId)) throw new ForbiddenError("teamdev.review_denied");
}

/** The viewer may change reporting lines and the skills catalogue. */
export function assertCanManageLines(access: DevAccess): void {
  if (!access.canManageLines) throw nobody();
}
