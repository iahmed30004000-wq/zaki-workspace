import { overdueDueFilter } from "@/lib/due-day";
import type { WorkspaceKind } from "@prisma/client";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { unreadBySpace } from "@/server/chat/unread";
import { spacesOf } from "@/server/services/current-space";
import { loadWorkScope } from "@/server/services/team-scope";
import { spaceFigures } from "@/server/services/space-figures";
import { resolveTimeZone, zonedDayStart } from "@/lib/zoned-time";

/**
 * «كل المساحات» — the owner's and the admins' one look over every space they can open (the owner's decision,
 * 2026-10-25): each space stays a separate site, and this page only counts what is in each and lets them enter
 * one. Nothing of a space's content is shown here: the numbers, never the work.
 */
export interface SpaceCard {
  id: string;
  name: string;
  emoji: string | null;
  kind: WorkspaceKind;
  members: number;
  /** Open tasks (not done, not archived) the viewer may see there. */
  open: number;
  /** …of which past their due day (the company's day). */
  overdue: number;
  /** Messages waiting for the viewer in its topics. */
  unread: number;
}

/** Only the OWNER and the ADMINs get the overview. */
export function mayOverview(actor: Pick<Actor, "role">): boolean {
  return actor.role === "OWNER" || actor.role === "ADMIN";
}

export async function spacesOverview(actor: Actor, now: Date = new Date()): Promise<SpaceCard[]> {
  const spaces = await spacesOf(actor);
  if (spaces.length === 0) return [];
  const ids = spaces.map((s) => s.id);
  const [org, scope, unread] = await Promise.all([
    db.organization.findUnique({ where: { id: actor.orgId }, select: { timezone: true } }),
    loadWorkScope(actor.userId),
    unreadBySpace({ userId: actor.userId, orgId: actor.orgId, orgRole: actor.role }),
  ]);
  const todayStart = zonedDayStart(now, resolveTimeZone(org?.timezone));
  // the open and late numbers are `spaceFigures`, the one per-space source (the same as the report «حسب المساحة» and the overview's insight)
  const [members, figures] = await Promise.all([
    /* The people who are actually there: suspending somebody keeps their organization row and, for a
       while, their space row too, so counting rows alone showed a space with people who had left. A
       GUEST is a person of the space (an external partner) and still counts — the status decides. */
    db.workspaceMember.groupBy({
      by: ["workspaceId"],
      where: {
        workspaceId: { in: ids },
        user: { memberships: { some: { organizationId: actor.orgId, status: "ACTIVE" } } },
      },
      _count: { _all: true },
    }),
    spaceFigures({ orgId: actor.orgId, spaceIds: ids, overdue: overdueDueFilter(now, resolveTimeZone(org?.timezone)), scope }),
  ]);
  const m = new Map(members.map((r) => [r.workspaceId, r._count._all] as const));
  return spaces.map((s) => ({
    id: s.id,
    name: s.name,
    emoji: s.emoji,
    kind: s.kind,
    members: m.get(s.id) ?? 0,
    open: figures.get(s.id)?.open ?? 0,
    overdue: figures.get(s.id)?.overdue ?? 0,
    unread: unread[s.id] ?? 0,
  }));
}
