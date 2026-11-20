import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { isFeatureOn } from "@/server/services/features";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";

/**
 * «آلي» (W1.9, D-W4): which of these tasks came in through the door from another system or an agent (`Task.apiTokenId` is set). The old screens build their rows from
 * services that do not carry the column, so they ask here by id and pass `automated: …` to the row (`RowTask.automated`).
 *
 * The read is the person's own (P0.2): an id the person may not open, or one of another company, is never named, whatever was asked. Nothing is read for no ids.
 *
 * The mark belongs to «مهام قديمة» (`workStaleSweep`, D-W4: the owner's answer on separating «آلي» from people's work is pending, so it is not always on): with the
 * switch OFF (the default) nothing is named and no page changes; the switch's hint in «الميزات» says the same.
 */
export async function automatedTaskIds(actor: Pick<Actor, "userId" | "orgId">, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  if (!(await isFeatureOn(actor.orgId, "workStaleSweep"))) return new Set();
  const scope = await loadWorkScope(actor.userId);
  const rows = await db.task.findMany({
    where: { id: { in: [...ids] }, orgId: actor.orgId, apiTokenId: { not: null }, AND: [taskVisibleWhere(scope)] },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}
