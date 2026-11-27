import type { Actor } from "@/server/policy/actor";
import { loadWorkScope, narrowScope, scopeSpaceIds } from "@/server/services/team-scope";
import { loadAnalytics } from "@/server/services/analytics";
import { ideaPlaceWhere } from "@/server/services/ideas";
import { currentSpace } from "@/server/services/current-space";

/**
 * «التقارير» of the person (src/components/control-panel/sections/analytics-report.tsx and the phone's GET /api/analytics): the
 * company's numbers over the spaces the person can open, narrowed to the space they are in, and that space's ideas (in «الشركة» the
 * shared ones). ONE read, so the report and the door cannot disagree. Who may see it at all is decided by each caller first.
 */
export async function analyticsFor(actor: Actor) {
  const here = await currentSpace(actor);
  const teams = narrowScope(await loadWorkScope(actor.userId), here?.id);
  return loadAnalytics(actor.orgId, scopeSpaceIds(teams), undefined, teams, {
    AND: [ideaPlaceWhere({ spaceId: here?.id ?? null, isHq: here?.kind === "HQ" })],
  });
}

/** The same numbers as plain JSON for the phone (the report reads a `Map` of names, which does not travel). */
export async function analyticsScreenFor(actor: Actor) {
  const d = await analyticsFor(actor);
  return {
    total: d.total,
    open: d.open,
    completed: d.completed,
    overdue: d.overdue,
    created30: d.created30,
    completed30: d.completed30,
    upcoming7: d.upcoming7,
    ideas: d.ideas,
    workspaces: d.workspaces,
    projects: d.projects,
    byPriority: d.byPriority.map((r) => ({ priority: r.priority, n: r._count._all })),
    ideasByStatus: d.byStatus30.map((r) => ({ status: r.status, n: r._count._all })),
    workload: d.assignees.map((a) => ({ userId: a.assigneeId, name: (a.assigneeId && d.nameOf.get(a.assigneeId)) || "", n: a._count._all })),
  };
}
