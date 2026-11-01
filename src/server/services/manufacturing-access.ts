import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { actorCan, type Actor } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { assertFeatureOn } from "@/server/services/features";
import { canWriteInWorkspace } from "@/server/workspace-role";

/**
 * «مخزون التصنيع» — WHO MAY DO WHAT, in one place. Every route, page and service of the ledger asks here first.
 *
 *  - the switch  `mfgLedger` in «الميزات»: off, nothing answers (404 `features.off`) for anybody, the owner included.
 *  - a partner   an external partner (GUEST) gets «not found», never «forbidden»: the feature does not exist for them, and no price, no
 *                supplier and no quantity ever reaches them.
 *  - the space   a ledger belongs to ONE manufacturing space (`layout = MANUFACTURING`). A person needs a row in it (a guest row does not
 *                count) AND `manufacturing.view`; the OWNER reads every manufacturing space without a row, silently (no trace). A space of
 *                another kind, of another company, or one the person cannot open is «not found».
 *  - editing     `manufacturing.edit` records movements and stocktakes (403 without it). Receiving a lot records a PRICE, so it also needs
 *                `manufacturing.cost`; a storekeeper without the cost still issues, adjusts and counts.
 *  - cost        `manufacturing.cost` alone sees any unit cost, total, value or average. Without it the answer carries none (null), the CSV
 *                has no such column: hidden on the server, not on the screen.
 *
 * ⚠️ Rank, status and capabilities are read from the database on every call, never from the cookie (`requireActor`).
 */

export interface MfgScope {
  actor: Actor;
  spaceId: string;
  spaceName: string;
  /** Has a row in the space (the owner reading silently has none). */
  member: boolean;
  canEdit: boolean;
  canCost: boolean;
}

export const notFound = (): NotFoundError => new NotFoundError("mfg.not_found");

/**
 * The ledger of this space is the caller's to open, or it does not exist (404). Reads the switch first, then the rank, the capability and the
 * space, so a person who may not know about the feature learns nothing from the order of the answers.
 */
export async function mfgScope(actor: Actor, spaceId: string): Promise<MfgScope> {
  await assertFeatureOn(actor.orgId, "mfgLedger");
  if (actor.isExternal || !actorCan(actor, "manufacturing.view")) throw notFound();
  const reachable = await accessibleWorkspaceIds(actor.userId);
  if (!reachable.includes(spaceId)) throw notFound();
  const [space, row] = await Promise.all([
    db.workspace.findFirst({ where: { id: spaceId, organizationId: actor.orgId, layout: "MANUFACTURING", archivedAt: null }, select: { id: true, name: true } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: spaceId, userId: actor.userId } }, select: { role: true } }),
  ]);
  if (!space) throw notFound();
  // a guest row, or no row for anybody but the owner: not theirs
  if (!canWriteInWorkspace(actor.role, row?.role)) throw notFound();
  return {
    actor,
    spaceId,
    spaceName: space.name,
    member: !!row,
    canEdit: actorCan(actor, "manufacturing.edit"),
    canCost: actorCan(actor, "manufacturing.cost"),
  };
}

/** 403 `mfg.readonly` unless the person records movements (a viewer only reads). */
export function assertEdit(scope: MfgScope): void {
  if (!scope.canEdit) throw new ForbiddenError("mfg.readonly");
}

/** 403 `mfg.cost_denied` unless the person may handle prices (a receipt records one). */
export function assertCost(scope: MfgScope): void {
  if (!scope.canCost) throw new ForbiddenError("mfg.cost_denied");
}

/** The first space of the company a person may open that is a manufacturing space (for the tab and the page); null with none. */
export async function firstMfgSpaceId(actor: Actor): Promise<string | null> {
  const ids = await accessibleWorkspaceIds(actor.userId);
  if (ids.length === 0) return null;
  const space = await db.workspace.findFirst({
    where: { id: { in: ids }, organizationId: actor.orgId, layout: "MANUFACTURING", archivedAt: null },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  return space?.id ?? null;
}

/**
 * One line of the audit log for the ledger (`mfg.<action>`), written to the existing AuditLog (no table of its own). What goes in `meta` is what
 * a line needs to say: names and quantities, NEVER a price (the log is read by people who may not hold the cost). A failed write is logged and
 * swallowed: what the person did has already happened.
 */
export async function recordMfg(
  actor: { userId: string; orgId: string },
  spaceId: string,
  action: string,
  target: string,
  meta?: Prisma.InputJsonValue,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: { action: `mfg.${action}`, actorId: actor.userId, orgId: actor.orgId, target, workspaceId: spaceId, meta: meta ?? Prisma.JsonNull },
    });
  } catch (err) {
    log.error("mfg.audit_failed", { action, message: err instanceof Error ? err.message : String(err) });
  }
}
