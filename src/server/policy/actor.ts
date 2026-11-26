import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, requireUser } from "@/server/auth";
import { perRequest } from "@/server/env";
import { can, effectiveCapabilities, type Capability } from "./capabilities";
import { sectionGridOf } from "./section-grid";

/**
 * Who is making this request, as far as the rules are concerned: the person, the organization
 * they work in (their oldest ACTIVE membership), their rank and what they may do.
 */
export interface Actor {
  userId: string;
  orgId: string;
  role: OrgRole;
  caps: ReadonlySet<Capability>;
  isOwner: boolean;
  /** The company's primary owner: the only one who makes or unmakes another OWNER (absent: not him). */
  isPrimaryOwner?: boolean;
  /** An external partner: sees only what is shared with them, no prices, no staff directory. */
  isExternal: boolean;
  /** «محصور بمساحة»: works only in the spaces it was put in (src/server/policy/space-only.ts). Absent: not limited. */
  spaceOnly?: boolean;
}

/**
 * The membership read for one person, ONCE per server render (`perRequest`, F1.1): the layout and every page of the render
 * ask, only the first reaches the database. The key is the person's id (a string): an `opts` literal or an `Actor` is a new
 * object on every call and would never hit. Nothing outlives the render: a rank changed, a seat suspended is seen by the
 * very next request.
 */
const actorOf = perRequest(async (userId: string): Promise<Actor> => {
  const member = await db.organizationMember.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: {
      organizationId: true,
      role: true,
      capabilities: true,
      revokedCapabilities: true,
      primaryOwner: true,
      spaceOnly: true,
      organization: { select: { settings: true } },
    },
  });
  if (!member) throw new ForbiddenError("not_org_member");
  return {
    userId,
    orgId: member.organizationId,
    role: member.role,
    // the section grid counts while its switch in «الميزات» is on
    caps: effectiveCapabilities(member, { sectionGrid: sectionGridOf(member.organization.settings) }),
    isOwner: member.role === "OWNER",
    isPrimaryOwner: member.role === "OWNER" && member.primaryOwner,
    isExternal: member.role === "GUEST",
    ...(member.spaceOnly ? { spaceOnly: true } : {}),
  };
});

export async function requireActor(opts: { allowPending?: boolean } = {}): Promise<Actor> {
  // the person first (401, or 403 while they owe the onboarding), THEN the membership
  const user = await requireUser(opts);
  return actorOf(user.id);
}

export function actorCan(actor: Pick<Actor, "caps">, capability: Capability): boolean {
  return actor.caps.has(capability);
}

/**
 * The signed-in person's box for a section that also serves the spaces' external partners (projects, tasks): a GUEST
 * passes (the space's own rules decide for them), anyone else needs the box.
 */
export function actorCanWork(actor: Pick<Actor, "caps" | "isExternal">, capability: Capability): boolean {
  return actor.isExternal || actor.caps.has(capability);
}

/** 403 `code` (`insufficient_role` unless told otherwise) unless the actor holds the capability (a guest holds none). */
export function assertCan(actor: Pick<Actor, "caps">, capability: Capability, code = "insufficient_role"): void {
  if (!actorCan(actor, capability)) throw new ForbiddenError(code);
}

/** The capability check for a member row read from the database (not the signed-in actor). */
export { can };

/**
 * The person's box, from their ACTIVE membership, for a service that is handed only `{ orgId, userId }` (false for
 * anyone who is not an ACTIVE member). `spaceGuestsPass`: an external partner (GUEST) holds no capability, yet works
 * in the spaces shared with them under the space's own rules (projects, tasks, calls): for them those rules decide.
 */
export async function memberCan(
  ctx: { orgId: string; userId: string },
  capability: Capability,
  opts: { spaceGuestsPass?: boolean } = {},
): Promise<boolean | "not_member"> {
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } },
    select: {
      status: true,
      role: true,
      capabilities: true,
      revokedCapabilities: true,
      primaryOwner: true,
      spaceOnly: true,
      organization: { select: { settings: true } },
    },
  });
  if (!member || member.status !== "ACTIVE") return "not_member";
  if (opts.spaceGuestsPass && member.role === "GUEST") return true;
  return can(member, capability, { sectionGrid: sectionGridOf(member.organization.settings) });
}

/**
 * The same as a door: throws 403 `code` unless the person holds the capability (`not_org_member` for anyone not an
 * ACTIVE member). The routes check too; this is the door a new caller can not forget.
 */
export async function assertMemberCan(
  ctx: { orgId: string; userId: string },
  capability: Capability,
  code = "insufficient_role",
  opts: { spaceGuestsPass?: boolean } = {},
): Promise<void> {
  const ok = await memberCan(ctx, capability, opts);
  if (ok === "not_member") throw new ForbiddenError("not_org_member");
  if (!ok) throw new ForbiddenError(code);
}
