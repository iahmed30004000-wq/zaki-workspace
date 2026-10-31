import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { isFeatureOn } from "@/server/services/features";
import type { BoardSection, SectionContext } from "@/server/services/owner-board-sections";

/**
 * «الوقت المسجّل» — ONE section for two screens: the owner board's people table (registered in `BOARD_SECTIONS`) and the number
 * beside a person's score (registered in `SCORE_SECTIONS`). The minutes are the time report's own rule: finished entries that
 * STARTED in the window, summed per person; nothing else is read (no task title, no note, no money).
 *
 * ⚠️ A board scope narrows it. A team lead's board counts only the entries made in the spaces / teams they cover, exactly like
 * every other number of the board; the OWNER's scope is the whole company. The score passes no restriction (the score's own
 * door has already decided who may open the person).
 * 🔧 Switched off (`timeTracking`), the section does not exist: no column, no empty cell.
 */

/** The entries a scope covers: the entry's space, or the project of its task when that project belongs to a covered team. */
function scopeFilter(scope: SectionContext["scope"]): Prisma.TimeEntryWhereInput {
  if (!scope.restricted) return {};
  const or: Prisma.TimeEntryWhereInput[] = [];
  if (scope.workspaceIds.length) or.push({ workspaceId: { in: scope.workspaceIds } });
  if (scope.teamIds.length) or.push({ task: { project: { teamId: { in: scope.teamIds } } } });
  return or.length ? { OR: or } : { id: { in: [] } };
}

export const timeTrackedSection: BoardSection = {
  id: "time",
  columns: [{ key: "time.minutes", labelKey: "teamdev.score.time", formulaKey: "teamdev.score.time_formula", kind: "minutes" }],
  enabled: (orgId) => isFeatureOn(orgId, "timeTracking"),
  async load(ctx: SectionContext) {
    const out = new Map<string, Record<string, number | string | null>>();
    if (!(await isFeatureOn(ctx.orgId, "timeTracking"))) return out;
    if (ctx.userIds.length === 0) return out;
    const rows = await db.timeEntry.groupBy({
      by: ["userId"],
      _sum: { seconds: true },
      where: {
        orgId: ctx.orgId,
        userId: { in: [...ctx.userIds] },
        stoppedAt: { not: null },
        startedAt: { gte: ctx.window.start, lt: ctx.window.end },
        ...scopeFilter(ctx.scope),
      },
    });
    for (const id of ctx.userIds) out.set(id, { "time.minutes": 0 });
    for (const r of rows) out.set(r.userId, { "time.minutes": Math.round((r._sum.seconds ?? 0) / 60) });
    return out;
  },
};
