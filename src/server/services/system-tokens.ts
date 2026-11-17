import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { createApiToken, listApiTokens, revokeApiToken, type ApiTokenDTO } from "@/server/services/api-tokens";
import { DEFAULT_SYSTEM_EXPIRY_DAYS, DOOR_SYSTEMS, doorSystem } from "@/lib/door/systems";

/**
 * «الإعدادات ← توكنات الأنظمة» (W1): the OWNER's page for the tokens of the systems that call Zaki Workspace (first: «الميديا باير»). It is the door's own
 * token (`ApiToken`, src/server/services/api-tokens.ts: hashed, shown once, expiry, revoke, last use, dies with its maker): this adds the system
 * (its name and fixed scopes), the owner-only rule and a 90-day default. The door itself does not change.
 *
 *  - OWNER only: an admin who may make door tokens on «الأتمتة» may not make one here (403).
 *  - the scopes come from the system, never from the request.
 *  - only tokens made here (`system` set) are listed or revoked here; the others stay on «الأتمتة».
 *  - making needs the switch «باب الربط» on; seeing and revoking never do.
 */
function owner(actor: Actor): void {
  if (!actor.isOwner || actor.isExternal) throw new ForbiddenError("insufficient_role");
}

export interface SystemTokensAnswer {
  tokens: ApiTokenDTO[];
  systems: Array<{ key: string; name: string; permissions: string[] }>;
  spaces: { id: string; name: string }[];
  switchOn: boolean;
}

export async function listSystemTokens(actor: Actor): Promise<SystemTokensAnswer> {
  owner(actor);
  // the same listing and the same DTO as the door's own screen, narrowed IN THE QUERY to the tokens of this page (never cut to the company's newest 200 first)
  const all = await listApiTokens(actor, { systemsOnly: true });
  return {
    tokens: all.tokens,
    systems: DOOR_SYSTEMS.map((s) => ({ key: s.key, name: s.name, permissions: [...s.permissions] })),
    spaces: all.spaces,
    switchOn: all.switchOn,
  };
}

export async function createSystemToken(actor: Actor, input: { system: string; workspaceId: string; expiresInDays?: number | null }): Promise<{ token: string; item: ApiTokenDTO }> {
  owner(actor);
  const system = doorSystem(input.system);
  if (!system) throw new ForbiddenError("door.err.system");
  return createApiToken(actor, {
    name: system.name,
    permissions: [...system.permissions],
    workspaceId: input.workspaceId,
    expiresInDays: input.expiresInDays === undefined ? DEFAULT_SYSTEM_EXPIRY_DAYS : input.expiresInDays,
    system: system.key,
  });
}

export async function revokeSystemToken(actor: Actor, tokenId: string): Promise<ApiTokenDTO> {
  owner(actor);
  const found = await db.apiToken.findFirst({ where: { id: tokenId, organizationId: actor.orgId, system: { not: null } }, select: { id: true } });
  if (!found) throw new NotFoundError("door.err.not_found");
  return revokeApiToken(actor, found.id);
}
