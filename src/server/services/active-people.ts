import { db, type DbClient } from "@/server/db";
import { ForbiddenError } from "@/server/auth";
import { can, type Capability } from "@/server/policy/capabilities";
import { sectionGridOn } from "@/server/policy/section-grid";

/**
 * "Nobody who was suspended or removed still counts."
 *
 * A suspended or offboarded member keeps their OrganizationMember row (history, authorship), so a
 * query that reads that table without looking at `status` quietly treats them as present again.
 * These are the few look-ups the services share; every one of them knows only ACTIVE members
 * (tests/active-membership-guard.test.ts fails for any membership read in src/ that forgets to).
 */

/** The member's row (rank and switches included), only while it is ACTIVE; null for none, suspended or offboarded. */
export async function activeMember(orgId: string, userId: string, client: DbClient = db) {
  const member = await client.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    // `primaryOwner` decides whether an OWNER is the owner or a partner: a partner's removed boxes
    // count, the primary owner's do not. Leaving it out read every partner as the primary owner, so
    // a capability the owner took away came back in every service guard (security review C2).
    select: { role: true, primaryOwner: true, status: true, capabilities: true, revokedCapabilities: true, spaceOnly: true },
  });
  return member && member.status === "ACTIVE" ? member : null;
}

/**
 * Work can only be handed to somebody who is in the organization AND active in it. Two answers, so
 * the person at the screen learns which it is: `assignee.not_member` (not in this organization at
 * all) or `assignee.not_active` (suspended or offboarded).
 */
export async function assertActiveAssignee(orgId: string, userId: string, client: DbClient = db): Promise<void> {
  const row = await client.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { status: true },
  });
  if (!row) throw new ForbiddenError("assignee.not_member");
  if (row.status !== "ACTIVE") throw new ForbiddenError("assignee.not_active");
}

/**
 * Throws 403 `insufficient_role` unless this person holds the capability (a guest holds none), and
 * `not_org_member` unless they are an ACTIVE member of the organization at all. For callers that
 * were handed a context (`{ orgId, userId }`) rather than the signed-in `Actor`.
 */
export async function assertCapability(
  ctx: { orgId: string; userId: string },
  capability: Capability,
  client: DbClient = db,
): Promise<void> {
  const member = await activeMember(ctx.orgId, ctx.userId, client);
  if (!member) throw new ForbiddenError("not_org_member");
  if (!can(member, capability, { sectionGrid: await sectionGridOn(ctx.orgId, client) })) throw new ForbiddenError("insufficient_role");
}

/**
 * The same rule as `assertCapability`, as a question instead of a refusal: for the case where the
 * person may read the ROW but not one FIELD of it (`prices.view` and an opportunity's amount), so the
 * answer is a hidden value, not a 403 on the whole screen. A non-member, a suspended person and a
 * guest hold nothing, so all three answer false.
 */
export async function holdsCapability(
  ctx: { orgId: string; userId: string },
  capability: Capability,
  client: DbClient = db,
): Promise<boolean> {
  const member = await activeMember(ctx.orgId, ctx.userId, client);
  if (!member) return false;
  return can(member, capability, { sectionGrid: await sectionGridOn(ctx.orgId, client) });
}
