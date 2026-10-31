import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { assertCan, type Actor } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { assertFeatureOn } from "@/server/services/features";
import { DOOR_PERMISSIONS, generateToken, isDoorPermission, type DoorPermission } from "@/server/door/tokens";

/**
 * «الباب»: the owner's screen for the tokens (src/components/api-door-card.tsx, under «الأتمتة»). Whoever holds
 * «integrations.manage» makes, lists and revokes the company's tokens, while the switch «باب الربط» is on.
 *
 * A token is made for ONE space the maker reaches, with named permissions (reads by default), an optional expiry; the whole token
 * is returned ONCE, here, and only its hash is kept. It acts in the name of the maker (see api-door.ts).
 */

export const TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

export type ApiTokenStatus = "active" | "revoked" | "expired";

export interface ApiTokenDTO {
  id: string;
  name: string;
  /** The public part (`zws_ab12…`): enough to recognise a token on the screen, useless to use it. */
  hint: string;
  permissions: DoorPermission[];
  space: { id: string; name: string };
  createdBy: { id: string; name: string };
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  /** manual | person_suspended | person_offboarded */
  revokedReason: string | null;
  status: ApiTokenStatus;
}

const TOKEN_SELECT = {
  id: true,
  name: true,
  prefix: true,
  permissions: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  revokedReason: true,
  workspace: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ApiTokenSelect;

function toDTO(row: Prisma.ApiTokenGetPayload<{ select: typeof TOKEN_SELECT }>, now = new Date()): ApiTokenDTO {
  const status: ApiTokenStatus = row.revokedAt ? "revoked" : row.expiresAt && row.expiresAt <= now ? "expired" : "active";
  return {
    id: row.id,
    name: row.name,
    hint: `zws_${row.prefix}…`,
    permissions: row.permissions.filter(isDoorPermission),
    space: row.workspace,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    status,
  };
}

/** Whoever holds «integrations.manage», while the switch is on (404 `features.off` when it is off). */
async function manager(actor: Actor): Promise<void> {
  assertCan(actor, "integrations.manage");
  await assertFeatureOn(actor.orgId, "apiDoor");
}

export async function listApiTokens(actor: Actor): Promise<{ tokens: ApiTokenDTO[]; spaces: { id: string; name: string }[] }> {
  await manager(actor);
  const reach = await accessibleWorkspaceIds(actor.userId);
  const [rows, spaces] = await Promise.all([
    db.apiToken.findMany({ where: { organizationId: actor.orgId }, orderBy: { createdAt: "desc" }, take: 200, select: TOKEN_SELECT }),
    db.workspace.findMany({ where: { organizationId: actor.orgId, id: { in: reach } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const now = new Date();
  return { tokens: rows.map((r) => toDTO(r, now)), spaces };
}

export interface CreateApiTokenInput {
  name: string;
  permissions: string[];
  workspaceId: string;
  /** Days until it expires; null: it does not expire (the owner chose that, and the screen says what it costs). */
  expiresInDays: number | null;
}

export async function createApiToken(actor: Actor, input: CreateApiTokenInput): Promise<{ token: string; item: ApiTokenDTO }> {
  await manager(actor);
  // a partner outside the company never makes a door into it, whatever switch somebody gave them
  if (actor.isExternal) throw new ForbiddenError("insufficient_role");
  const permissions = [...new Set(input.permissions)].filter(isDoorPermission);
  if (permissions.length === 0 || permissions.length !== new Set(input.permissions).size) throw new ForbiddenError("door.err.permissions");
  // the space must be one the maker reaches: the same rule that decides what they open (an ADMIN inherits nothing)
  const reach = await accessibleWorkspaceIds(actor.userId);
  const space = reach.includes(input.workspaceId)
    ? await db.workspace.findFirst({ where: { id: input.workspaceId, organizationId: actor.orgId }, select: { id: true } })
    : null;
  if (!space) throw new ForbiddenError("door.err.space");
  const name = input.name.trim();
  const fresh = generateToken();
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;

  const row = await db.$transaction(async (tx) => {
    const made = await tx.apiToken.create({
      data: {
        organizationId: actor.orgId,
        name,
        prefix: fresh.prefix,
        tokenHash: fresh.hash,
        permissions,
        workspaceId: space.id,
        createdById: actor.userId,
        expiresAt,
      },
      select: TOKEN_SELECT,
    });
    await tx.auditLog.create({
      data: {
        action: "door.token.created",
        actorId: actor.userId,
        orgId: actor.orgId,
        target: made.id,
        workspaceId: space.id,
        meta: { name, permissions, expiresAt: expiresAt?.toISOString() ?? null },
      },
    });
    return made;
  });
  return { token: fresh.token, item: toDTO(row) };
}

/** Revokes one token of the company, for good (a revoked token is never brought back: make a new one). Revoking twice is the same answer. */
export async function revokeApiToken(actor: Actor, tokenId: string): Promise<ApiTokenDTO> {
  await manager(actor);
  const found = await db.apiToken.findFirst({ where: { id: tokenId, organizationId: actor.orgId }, select: { id: true, workspaceId: true, revokedAt: true } });
  if (!found) throw new NotFoundError("door.err.not_found");
  if (!found.revokedAt) {
    await db.$transaction(async (tx) => {
      const { count } = await tx.apiToken.updateMany({
        where: { id: found.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: actor.userId, revokedReason: "manual" },
      });
      if (count === 1) {
        await tx.auditLog.create({
          data: { action: "door.token.revoked", actorId: actor.userId, orgId: actor.orgId, target: found.id, workspaceId: found.workspaceId, meta: { reason: "manual" } },
        });
      }
    });
  }
  return toDTO(await db.apiToken.findUniqueOrThrow({ where: { id: found.id }, select: TOKEN_SELECT }));
}

/**
 * «يلغي مفاتيح اللي انوقف»: the tokens a person made in this company die with the person's access (suspended or offboarded), inside
 * the transaction that changes their status. They are NOT given back by reactivating the person: a token that died is made again, on purpose.
 * (The door also refuses them live, from the person's status: this makes the death permanent and visible on the screen.)
 */
export async function revokeTokensOfPerson(
  tx: Prisma.TransactionClient,
  input: { orgId: string; userId: string; byUserId: string; reason: "person_suspended" | "person_offboarded" },
): Promise<number> {
  const live = await tx.apiToken.findMany({ where: { organizationId: input.orgId, createdById: input.userId, revokedAt: null }, select: { id: true, workspaceId: true } });
  if (live.length === 0) return 0;
  await tx.apiToken.updateMany({
    where: { id: { in: live.map((t) => t.id) }, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: input.byUserId, revokedReason: input.reason },
  });
  await tx.auditLog.createMany({
    data: live.map((t) => ({
      action: "door.token.revoked",
      actorId: input.byUserId,
      orgId: input.orgId,
      target: t.id,
      workspaceId: t.workspaceId,
      meta: { reason: input.reason, issuer: input.userId },
    })),
  });
  return live.length;
}

export { DOOR_PERMISSIONS };
