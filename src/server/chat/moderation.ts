import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { canModerateTarget, isSpaceAdmin, loadOrgFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { Prisma } from "@prisma/client";

/**
 * Moderation of a space: a mute that stops a person posting (the space's admins are never muted),
 * and the audit trail every moderation act writes. Reading is never taken away: a muted person
 * still reads everything they could read.
 */

export const muteSchema = z.object({
  userId: z.string().min(1),
  /** "1h" | "1d" | "forever" | null (null lifts the mute) */
  until: z.enum(["1h", "1d", "forever"]).nullable(),
});

const MUTE_MS: Record<"1h" | "1d" | "forever", number> = {
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  forever: 100 * 365 * 24 * 60 * 60_000, // "forever" is a date far away, not a flag: the column stays simple
};

/** Mutes (or unmutes with minutes: null) one person in one space. Space admins only. */
export async function muteInSpace(
  ctx: OrgAccessContext,
  spaceId: string,
  input: z.infer<typeof muteSchema>,
): Promise<{ mutedUntil: string | null }> {
  const ws = await db.workspace.findFirst({
    where: { id: spaceId, organizationId: ctx.orgId },
    select: { id: true },
  });
  if (!ws) throw new NotFoundError("chat.e.not_found");

  const [org, mine, theirs] = await Promise.all([
    loadOrgFacts(ctx.userId, ctx.orgId),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: spaceId, userId: ctx.userId } },
      select: { role: true },
    }),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: spaceId, userId: input.userId } },
      select: { role: true, user: { select: { id: true } } },
    }),
  ]);
  if (!theirs) throw new NotFoundError("chat.e.not_found");

  const may = org?.role === "OWNER" /* oversight-ok: muting is management by rank */ || isSpaceAdmin(mine?.role ?? null);
  if (!may) throw new ForbiddenError("chat.e.moderator_only");

  // nobody mutes the OWNER; nobody mutes an equal or a higher standing
  // all-statuses: the target's standing is needed even when the row is not ACTIVE (a suspended
  // member still has a rank, and an unknown row must read as "not found", not as "lowest rank").
  const targetOrg = await db.organizationMember.findUnique({ // all-statuses: a suspended member still has a standing
    where: { organizationId_userId: { organizationId: ctx.orgId, userId: input.userId } },
    select: { role: true },
  });
  if (!targetOrg) throw new NotFoundError("chat.e.not_found");
  if (!canModerateTarget({ role: org?.role ?? "MEMBER", spaceRole: mine?.role }, { role: targetOrg.role, spaceRole: theirs?.role })) {
    throw new ForbiddenError("chat.e.mute_denied");
  }

  const mutedUntil = input.until === null ? null : new Date(Date.now() + MUTE_MS[input.until]);
  await db.$transaction(async (tx) => {
    await tx.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: spaceId, userId: input.userId } },
      data: { mutedUntil },
    });
    // for the muted person only (their composer locks or unlocks); nobody else needs the ids
    await emitRealtime(tx, ctx.orgId, "membership.changed", { spaceId, userId: input.userId, targetUserId: input.userId });
    await tx.auditLog.create({
      data: {
        action: mutedUntil ? "chat.mute" : "chat.unmute",
        actorId: ctx.userId,
        orgId: ctx.orgId,
        target: input.userId,
        workspaceId: spaceId,
        meta: { mutedUntil: mutedUntil?.toISOString() ?? null, until: input.until },
      },
    });
  });
  return { mutedUntil: mutedUntil?.toISOString() ?? null };
}

/** The moderation trail of a space (its admins and the OWNER): mutes, deletions, closes. */
export async function spaceModerationLog(
  ctx: OrgAccessContext,
  spaceId: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  const [org, mine] = await Promise.all([
    loadOrgFacts(ctx.userId, ctx.orgId),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: spaceId, userId: ctx.userId } },
      select: { role: true },
    }),
  ]);
  if (!(org?.role === "OWNER" /* oversight-ok: management by rank */ || isSpaceAdmin(mine?.role ?? null))) throw new ForbiddenError("chat.e.moderator_only");

  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const rows = await db.auditLog.findMany({
    where: {
      orgId: ctx.orgId,
      workspaceId: spaceId,
      action: { startsWith: "chat." },
      ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
  });
  // actor names in one round (AuditLog has no relation, on purpose: a row outlives its actor)
  const actorIds = [...new Set(rows.slice(0, limit).map((r) => r.actorId).filter((v): v is string => !!v))];
  const actors = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(actors.map((a) => [a.id, a.name]));
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((r) => ({ ...r, actorName: r.actorId ? (nameOf.get(r.actorId) ?? "") : "" })),
    nextCursor: hasMore ? rows[limit - 1]!.id : null,
  };
}

/**
 * The chat's audit entry. Written directly (not through `audit()`, which has no space/conversation
 * columns) so the archive can find it by space or by conversation.
 */
export async function logChat(entry: {
  orgId: string;
  actorId: string;
  action: string;
  target?: string | null;
  spaceId?: string | null;
  conversationId?: string | null;
  meta?: Prisma.InputJsonValue;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId,
      orgId: entry.orgId,
      target: entry.target ?? null,
      workspaceId: entry.spaceId ?? null,
      conversationId: entry.conversationId ?? null,
      meta: entry.meta ?? Prisma.JsonNull,
    },
  });
}
