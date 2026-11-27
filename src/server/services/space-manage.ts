import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { currentSpace, spacesOf } from "@/server/services/current-space";
import { mayOverview, spacesOverview } from "@/server/services/spaces-overview";
import { SpaceConflictError } from "@/server/services/workspaces";

/**
 * MANAGING THE SPACES FROM «كل المساحات» (the owner's asks, 2026-10-26): put them in order by dragging, archive one (it
 * leaves every list — the switcher, the overview, search by space — with everything in it kept as it is) and bring it
 * back. The OWNER and the ADMINs (`mayOverview`), on the spaces they can open; «الشركة» is never archived and always
 * stays first.
 */

export const orderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });
export const archiveSchema = z.object({ archived: z.boolean() });

function assertManager(actor: Actor): void {
  if (!mayOverview(actor)) throw new ForbiddenError("spaces.manage_denied");
}

/** Saves the order of the spaces as the person dragged them (only spaces they can open; «الشركة» stays first anyway). */
export async function reorderSpaces(actor: Actor, ids: string[]): Promise<void> {
  assertManager(actor);
  const mine = new Set((await spacesOf(actor)).map((s) => s.id));
  const order = ids.filter((id) => mine.has(id));
  await db.$transaction(order.map((id, i) => db.workspace.update({ where: { id }, data: { position: i + 1 } })));
}

/** The archived spaces the person may bring back (the OWNER: all of the company's; an ADMIN: the ones they are in). */
export async function archivedSpaces(actor: Actor): Promise<{ id: string; name: string; emoji: string | null; archivedAt: string }[]> {
  if (!mayOverview(actor)) return [];
  const rows = await db.workspace.findMany({
    where: {
      organizationId: actor.orgId,
      archivedAt: { not: null },
      ...(actor.role === "OWNER" ? {} : { members: { some: { userId: actor.userId } } }),
    },
    orderBy: { archivedAt: "desc" },
    select: { id: true, name: true, emoji: true, archivedAt: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, archivedAt: r.archivedAt!.toISOString() }));
}

/** Archives a space or brings it back. Never «الشركة». */
export async function setSpaceArchived(actor: Actor, spaceId: string, archived: boolean): Promise<void> {
  assertManager(actor);
  const space = await db.workspace.findFirst({
    where: {
      id: spaceId,
      organizationId: actor.orgId,
      ...(actor.role === "OWNER" ? {} : { members: { some: { userId: actor.userId } } }),
    },
    select: { id: true, kind: true },
  });
  if (!space) throw new NotFoundError("workspace.not_found");
  if (space.kind === "HQ") throw new SpaceConflictError("spaces.archive_hq");
  await db.workspace.update({ where: { id: space.id }, data: { archivedAt: archived ? new Date() : null } });
}

/**
 * «كل المساحات» as one answer: the cards (numbers only, never the work), the space the person is in, the archived ones they may bring back.
 * ONE function for the page body (`SpacesBody`) and the phone's door (GET /api/spaces/overview). Not the person's: «not found».
 */
export async function spacesScreenFor(actor: Actor): Promise<{ cards: Awaited<ReturnType<typeof spacesOverview>>; hereId: string | null; archived: Awaited<ReturnType<typeof archivedSpaces>> }> {
  if (!mayOverview(actor)) throw new NotFoundError("spaces.manage_denied");
  const [cards, here, archived] = await Promise.all([spacesOverview(actor), currentSpace(actor), archivedSpaces(actor)]);
  return { cards, hereId: here?.id ?? null, archived };
}
