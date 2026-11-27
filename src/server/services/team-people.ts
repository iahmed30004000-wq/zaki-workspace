import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertMayOpenPerson, devAccess, isSelf, mayEnterFor, type DevAccess } from "@/server/policy/team-development";
import { getServerT } from "@/lib/i18n/server";
import { dayKeyOf } from "@/lib/owner-board";
import { periodChoices } from "@/lib/team-score";
import { orgTimeZone } from "@/server/services/org-day";

/**
 * «الأداء والتطوير» — the front door: the people the viewer reads, and the header of one person's file.
 *
 * The owner reads every ACTIVE member of the company, a supervisor their subtree, anybody else only themselves. The list is
 * sorted by NAME (never by performance: the screens that show scores sort by score only when somebody clicks the column).
 */

export interface PersonListRow {
  userId: string;
  name: string;
  jobTitle: string | null;
  role: OrgRole;
  supervisor: string | null;
  /** Skills with a supervisor's level / with the person's own estimate (live skills only). */
  ratedBy: number;
  ratedSelf: number;
}

export interface DevelopmentHome {
  /** owner: everybody · supervisor: the subtree · self: only the viewer (the page sends them to their own file). */
  mode: "owner" | "supervisor" | "self";
  viewerId: string;
  canManageLines: boolean;
  canReview: boolean;
  skillsTotal: number;
  people: PersonListRow[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ar");

function readIds(access: DevAccess): string[] {
  if (access.reach === null) return [...access.staff.keys()].filter((id) => id !== access.viewerId);
  return [...access.reach];
}

export async function loadDevelopmentHome(actor: Actor): Promise<DevelopmentHome> {
  const access = await devAccess(actor);
  const mode = access.isOwner ? "owner" : access.isSupervisor ? "supervisor" : "self";
  const ids = mode === "self" ? [] : readIds(access);
  const [skillsTotal, levels] = await Promise.all([
    db.skill.count({ where: { organizationId: access.orgId, archivedAt: null } }),
    ids.length ? db.personSkill.groupBy({ by: ["userId", "source"], where: { organizationId: access.orgId, userId: { in: ids }, skill: { archivedAt: null } }, _count: { _all: true } }) : [],
  ]);
  const rated = new Map<string, { by: number; self: number }>();
  for (const l of levels) {
    const row = rated.get(l.userId) ?? { by: 0, self: 0 };
    if (l.source === "MANUAL") row.by = l._count._all;
    else row.self = l._count._all;
    rated.set(l.userId, row);
  }
  const people = ids
    .map((id) => {
      const p = access.staff.get(id);
      if (!p) return null;
      const manager = access.managerOf.get(id) ?? null;
      return {
        userId: id,
        name: p.name,
        jobTitle: p.jobTitle,
        role: p.role,
        supervisor: manager ? (access.staff.get(manager)?.name ?? null) : null,
        ratedBy: rated.get(id)?.by ?? 0,
        ratedSelf: rated.get(id)?.self ?? 0,
      } satisfies PersonListRow;
    })
    .filter((p): p is PersonListRow => p !== null)
    .sort(byName);
  return { mode, viewerId: access.viewerId, canManageLines: access.canManageLines, canReview: access.canReview, skillsTotal, people };
}

export interface PersonHeader {
  userId: string;
  name: string;
  jobTitle: string | null;
  role: OrgRole;
  /** Not an ACTIVE member any more: only the owner opens such a file. */
  inactive: boolean;
  supervisor: { userId: string; name: string } | null;
  isSelf: boolean;
  /** The viewer enters manual skill levels, reviews, plans and notes about this person. */
  canEnter: boolean;
  /** The viewer is the owner or a supervisor of this person (reads what only reviewers read). */
  asReviewer: boolean;
}

/** The header of one person's file; 404 for anybody who may not open it. */
export async function loadPersonHeader(actor: Actor, userId: string): Promise<PersonHeader> {
  const access = await devAccess(actor);
  assertMayOpenPerson(access, userId);
  // all-statuses: the owner opens the file of a suspended or offboarded person (their history stays readable by him alone)
  const row = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: access.orgId, userId } },
    select: { role: true, status: true, managerId: true, user: { select: { name: true, jobTitle: true } } },
  });
  if (!row || row.role === "GUEST") throw new NotFoundError("teamdev.not_found");
  const supervisorName = row.managerId ? (access.staff.get(row.managerId)?.name ?? null) : null;
  return {
    userId,
    name: row.user.name,
    jobTitle: row.user.jobTitle ?? null,
    role: row.role,
    inactive: row.status !== "ACTIVE",
    supervisor: row.managerId && supervisorName ? { userId: row.managerId, name: supervisorName } : null,
    isSelf: isSelf(access, userId),
    canEnter: mayEnterFor(access, userId),
    asReviewer: !isSelf(access, userId),
  };
}

/** The periods the viewer may pick (the last 12 months and 5 quarters of the company's calendar), each with its name. */
export async function periodChoicesFor(actor: Actor): Promise<ReturnType<typeof periodChoices>> {
  const { t } = getServerT();
  return periodChoices(dayKeyOf(new Date(), await orgTimeZone(actor.orgId)), t);
}
