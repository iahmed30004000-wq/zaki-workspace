import {
  Prisma,
  type CampaignStatus,
  type MemberStatus,
  type OpportunityStage,
  type OrgRole,
  type ProjectStatus,
  type WorkspaceRole,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit, hashPassword } from "@/server/auth";
import { assertCan, requireActor, type Actor } from "@/server/policy/actor";
import { CAPABILITIES } from "@/server/policy/capabilities";
import { CREATABLE_ROLES } from "@/server/policy/rank";
import { canManageWorkspaceMembers } from "@/server/services/access";
import { canManageDepartments } from "@/server/services/departments";
import { activeMember } from "@/server/services/active-people";
import { assignedTo } from "@/server/services/tasks";
import { pushNotification } from "@/server/notify";
import { getServerT } from "@/lib/i18n/server";
import { addPersonToHq, removePersonAudit, removePersonFromHq } from "@/server/chat/hq";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import { MAX_LINE_DEPTH, depthAbove, exceedsLineDepth } from "@/lib/team-development";
import { generateTemporaryPassword, passwordSchema, usernameSchema } from "@/server/services/credentials";
import { revokeTokensOfPerson } from "@/server/services/api-tokens";
import {
  STATUS_TRANSITIONS,
  activeRoutineWhere,
  canAdministratePerson,
  canChangeRoleOf,
  canTransitionStatus,
  grantableRoles,
  inCatalogueOrder,
  openTaskWhere,
  openTicketWhere,
  replaceCapabilityList,
  unheldRankDefaults,
  wouldCreateManagerCycle,
  type StatusAction,
} from "@/server/services/org-members";

/**
 * The account lifecycle: the owner (and, below him, whoever holds `users.manage`) creates, edits,
 * suspends, reactivates and offboards people, resets passwords and ends sessions.
 *
 *  - The rank rules are the pure functions of member-rules.ts (re-exported by org-members.ts);
 *    this file only applies them.
 *  - Every account starts, and every reset or reactivation restarts, with a TEMPORARY password
 *    (`mustChangePassword`); a password the server generated is returned exactly once and is
 *    never logged, audited or stored in clear.
 *  - Suspend, offboard, reactivation, password reset and "log out everywhere" bump the person's
 *    `tokenVersion`: every cookie they hold stops working on its next request (src/server/auth.ts).
 *  - Nothing here deletes a person: offboarding keeps the account, the membership row
 *    (OFFBOARDED) and everything they wrote; it removes their space rows and hands their open
 *    work to somebody else, in one transaction.
 */

/** A refusal that is neither 403 nor 404: 400 = a choice is missing, 409 = the account's state or a name in use. */
export class AccountsError extends Error {
  readonly status: 400 | 409;
  constructor(status: 400 | 409, key: string) {
    super(key);
    this.name = "AccountsError";
    this.status = status;
  }
}

function invalid(path: string, key: string): ValidationError {
  return new ValidationError([{ path, message: key }]);
}

/**
 * The caller of every account route: signed in and onboarded, ACTIVE, holding `users.manage`, and
 * working in THIS organization. A suspended or offboarded caller never gets this far (their
 * cookie no longer resolves to a user).
 */
export async function requireAccountsActor(orgId: string): Promise<Actor> {
  const actor = await requireActor();
  assertCan(actor, "users.manage");
  if (actor.orgId !== orgId) throw new ForbiddenError("not_org_member");
  return actor;
}

// ---------- request bodies ----------

/** An empty form field means "not given". */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
/** An empty form field means "clear it". */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const nameSchema = z
  .string({ required_error: "accounts.name_too_short", invalid_type_error: "accounts.name_too_short" })
  .trim()
  .min(2, "accounts.name_too_short")
  .max(80, "accounts.name_too_long");
const jobTitleSchema = z.string().trim().max(80, "accounts.job_title_too_long");
const emailSchema = z.string().trim().toLowerCase().max(255, "accounts.email_invalid").email("accounts.email_invalid");
const idSchema = z.string().trim().min(1).max(64);
const roleSchema = z.enum(CREATABLE_ROLES as [OrgRole, ...OrgRole[]], {
  errorMap: () => ({ message: "accounts.role_invalid" }),
});
/** A rank change may also make a partner (OWNER): who may do it is decided in `updateAccount` (the primary owner only). */
const rankChangeSchema = z.enum(["OWNER", ...CREATABLE_ROLES] as [OrgRole, ...OrgRole[]], {
  errorMap: () => ({ message: "accounts.role_invalid" }),
});
const capabilityListSchema = z
  .array(z.enum(CAPABILITIES, { errorMap: () => ({ message: "accounts.cap_unknown" }) }))
  .max(CAPABILITIES.length * 2);
/** A missing username reads as an empty one: "too short", like any other. */
const usernameField = z.preprocess((v) => (v === undefined || v === null ? "" : v), usernameSchema);

export const createAccountSchema = z.object({
  name: nameSchema,
  username: usernameField,
  email: z.preprocess(blankToUndefined, emailSchema.optional()),
  /** Absent: the server generates a temporary password and returns it once. */
  password: z.preprocess(blankToUndefined, passwordSchema.optional()),
  role: roleSchema.default("MEMBER"),
  managerId: z.preprocess(blankToNull, idSchema.nullable().optional()),
  workspaceIds: z.array(idSchema).max(500).optional(),
  capabilities: capabilityListSchema.optional(),
  jobTitle: z.preprocess(blankToUndefined, jobTitleSchema.optional()),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z
  .object({
    name: nameSchema.optional(),
    /** Corrects a mistyped username (still unique, stored lower-case). */
    username: usernameSchema.optional(),
    /** Corrects or clears (null / "") the e-mail address. */
    email: z.preprocess(blankToNull, emailSchema.nullable().optional()),
    jobTitle: z.preprocess(blankToNull, jobTitleSchema.nullable().optional()),
    role: rankChangeSchema.optional(),
    managerId: z.preprocess(blankToNull, idSchema.nullable().optional()),
    capabilities: capabilityListSchema.optional(),
    revokedCapabilities: capabilityListSchema.optional(),
    /** Reset to this temporary password (the person must change it at the next sign-in). */
    password: z.preprocess(blankToUndefined, passwordSchema.optional()),
  })
  .superRefine((v, ctx) => {
    if (Object.values(v).every((x) => x === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "orgm.no_change" });
    }
    if (v.capabilities && v.revokedCapabilities?.some((c) => v.capabilities?.includes(c))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revokedCapabilities"], message: "accounts.cap_both_lists" });
    }
  });
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const accountStatusSchema = z.object({
  action: z.enum(["suspend", "reactivate", "offboard"], { errorMap: () => ({ message: "accounts.action_invalid" }) }),
  transferToUserId: z.preprocess(blankToNull, idSchema.nullable().optional()),
});
export type AccountStatusInput = z.infer<typeof accountStatusSchema>;

/** The optional body of the legacy DELETE (it offboards). */
export const offboardBodySchema = z.object({
  transferToUserId: z.preprocess(blankToNull, idSchema.nullable().optional()),
});

// ---------- shared checks ----------

interface Target {
  /** The membership row. */
  id: string;
  userId: string;
  name: string;
  role: OrgRole;
  status: MemberStatus;
  capabilities: string[];
  revokedCapabilities: string[];
  managerId: string | null;
  primaryOwner: boolean;
}

/** The caller as far as rank goes (the primary owner also administers the partners). */
const rankedActor = (actor: Actor) => ({ role: actor.role, primaryOwner: actor.isPrimaryOwner === true });

/**
 * The person an action is about: never the caller (403 `accounts.self_denied`; their own password
 * has /api/me/password), a member of the caller's organization (404 otherwise, so another
 * company's people cannot be probed) and somebody the caller's rank may administer.
 */
async function administrableTarget(actor: Actor, userId: string): Promise<Target> {
  if (userId === actor.userId) throw new ForbiddenError("accounts.self_denied");
  const row = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: actor.orgId, userId } },
    select: {
      id: true,
      role: true,
      status: true,
      capabilities: true,
      revokedCapabilities: true,
      managerId: true,
      primaryOwner: true,
      user: { select: { name: true } },
    },
  });
  if (!row) throw new NotFoundError("orgm.not_member");
  if (!canAdministratePerson(rankedActor(actor), row)) throw new ForbiddenError("orgm.role_denied");
  return {
    id: row.id,
    userId,
    name: row.user.name,
    role: row.role,
    status: row.status,
    capabilities: row.capabilities,
    revokedCapabilities: row.revokedCapabilities,
    managerId: row.managerId,
    primaryOwner: row.primaryOwner,
  };
}

/** Everybody of the organization with their manager (every status: an old loop must still be seen). */
async function managerChain(client: Prisma.TransactionClient, orgId: string) {
  return client.organizationMember.findMany({
    where: { organizationId: orgId },
    select: { userId: true, managerId: true, role: true, status: true },
  });
}

/** A manager is an ACTIVE, non-guest member of the organization, and never closes a loop. */
export async function assertManager(client: Prisma.TransactionClient, orgId: string, managerId: string, subjectId: string | null): Promise<void> {
  const members = await managerChain(client, orgId);
  const manager = members.find((m) => m.userId === managerId);
  if (!manager || manager.status !== "ACTIVE" || manager.role === "GUEST") {
    throw invalid("managerId", "accounts.manager_invalid");
  }
  const managerOf = new Map(members.map((m) => [m.userId, m.managerId]));
  if (subjectId && wouldCreateManagerCycle(managerOf, subjectId, managerId)) {
    throw invalid("managerId", "accounts.manager_cycle");
  }
  // no chain of more than MAX_LINE_DEPTH supervisors («الهيكل»); a new account is a leaf under the manager
  const tooDeep = subjectId ? exceedsLineDepth(managerOf, subjectId, managerId) : depthAbove(managerOf, managerId) + 1 > MAX_LINE_DEPTH;
  if (tooDeep) throw invalid("managerId", "accounts.manager_too_deep");
}

/** The advisory-lock namespace of manager changes (the second key is the organization). */
const MANAGER_CHAIN_LOCK = 41_001;

/**
 * Manager changes in one organization happen one at a time: a transaction-scoped advisory lock,
 * released at commit. Whoever holds it reads the chain again before writing, so two changes made
 * at the same moment cannot close a loop between them.
 */
export async function lockManagerChain(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MANAGER_CHAIN_LOCK}::int, hashtext(${orgId}))`;
}

/**
 * Locks the membership row until the transaction ends and decides on it, not on what was read
 * before: an offboarding that committed in between freezes the account (409
 * `accounts.offboarded_frozen`), a rank changed in between makes the edit stale (409
 * `accounts.bad_transition`). An offboarding that starts now waits for this edit to finish.
 */
async function lockMembership(tx: Prisma.TransactionClient, target: Target): Promise<{ status: MemberStatus }> {
  const rows = await tx.$queryRaw<{ status: MemberStatus; role: OrgRole }[]>`
    SELECT "status"::text AS "status", "role"::text AS "role" FROM "OrganizationMember" WHERE "id" = ${target.id} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new NotFoundError("orgm.not_member");
  if (row.status === "OFFBOARDED") throw new AccountsError(409, "accounts.offboarded_frozen");
  if (row.role !== target.role) throw new AccountsError(409, "accounts.bad_transition");
  return { status: row.status };
}

/**
 * The spaces a new person may be put into: spaces of this organization (422 otherwise) whose
 * members the caller may manage — the space's own rule (`canManageWorkspaceMembers`), the very
 * door its members route uses; the OWNER manages every space (403 `accounts.workspace_denied`).
 */
async function checkedWorkspaces(actor: Actor, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const found = await db.workspace.count({ where: { id: { in: unique }, organizationId: actor.orgId } });
  if (found !== unique.length) throw invalid("workspaceIds", "accounts.workspace_invalid");
  if (!actor.isOwner) {
    for (const id of unique) {
      if (!(await canManageWorkspaceMembers(actor.userId, id))) throw new ForbiddenError("accounts.workspace_denied");
    }
  }
  return unique;
}

/** Usernames and e-mail addresses are unique across every account (but `exceptUserId`'s own), whatever the letter case. */
async function assertNamesFree(names: { username?: string | null; email?: string | null }, exceptUserId?: string): Promise<void> {
  const others = exceptUserId ? { id: { not: exceptUserId } } : {};
  if (names.username) {
    const sameName = await db.user.findFirst({
      where: { ...others, username: { equals: names.username, mode: "insensitive" } },
      select: { id: true },
    });
    if (sameName) throw new AccountsError(409, "accounts.username_taken");
  }
  if (names.email) {
    const sameMail = await db.user.findFirst({
      where: { ...others, email: { equals: names.email, mode: "insensitive" } },
      select: { id: true },
    });
    if (sameMail) throw new AccountsError(409, "email.taken");
  }
}

/** Two requests racing for the same name: the unique index decides, the answer stays a 409 with its key. */
function nameConflict(err: unknown): AccountsError | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return null;
  const target = String((err.meta as { target?: unknown } | undefined)?.target ?? "");
  if (target.includes("username")) return new AccountsError(409, "accounts.username_taken");
  if (target.includes("email")) return new AccountsError(409, "email.taken");
  return null;
}

/**
 * An offboarded account is frozen until it is reactivated: no edit, no password reset (the members
 * screen offers neither). Signing it out stays possible: it is harmless and changes nothing.
 */
function assertNotOffboarded(target: Target): void {
  if (target.status === "OFFBOARDED") throw new AccountsError(409, "accounts.offboarded_frozen");
}

/** Ends every session of the person (their cookies carry the old version), plus any other change to the user row. */
async function endSessions(tx: Prisma.TransactionClient, userId: string, data: Prisma.UserUpdateInput = {}): Promise<void> {
  await tx.user.update({ where: { id: userId }, data: { ...data, tokenVersion: { increment: 1 } }, select: { id: true } });
}

/**
 * Moves the membership to `to` only if it is still in a status the action may start from: two
 * clicks at once make one change, and the second gets 409 (inside the caller's transaction).
 */
async function flipStatus(tx: Prisma.TransactionClient, actor: Actor, target: Target, action: StatusAction, to: MemberStatus): Promise<void> {
  const { count } = await tx.organizationMember.updateMany({
    where: { id: target.id, status: { in: [...STATUS_TRANSITIONS[action]] } },
    data: { status: to, statusChangedAt: new Date(), statusChangedById: actor.userId },
  });
  if (count !== 1) throw new AccountsError(409, "accounts.bad_transition");
}

// ---------- create ----------

export interface CreatedAccount {
  userId: string;
  username: string;
  /** Only when the server generated it — shown once, never stored in clear. */
  temporaryPassword?: string;
}

export async function createAccount(actor: Actor, input: CreateAccountInput): Promise<CreatedAccount> {
  if (!grantableRoles(actor.role).includes(input.role)) throw new ForbiddenError("orgm.role_denied");
  const caps = replaceCapabilityList(actor, input.role, [], input.capabilities ?? []);
  if (caps.problem) throw new ForbiddenError(caps.problem);
  // nobody produces an account holding more than they hold: the rank's defaults the creator lacks start switched off
  const revokedCapabilities = inCatalogueOrder(unheldRankDefaults(actor, input.role, caps.next));
  const managerId = input.managerId ?? null;
  if (managerId) {
    if (input.role === "GUEST") throw invalid("managerId", "accounts.guest_no_manager");
    await assertManager(db, actor.orgId, managerId, null);
  }
  const workspaceIds = await checkedWorkspaces(actor, input.workspaceIds ?? []);
  await assertNamesFree({ username: input.username, email: input.email });

  const temporaryPassword = input.password === undefined ? generateTemporaryPassword() : undefined;
  const passwordHash = await hashPassword(input.password ?? (temporaryPassword as string));
  const spaceRole: WorkspaceRole = input.role === "GUEST" ? "GUEST" : "MEMBER";

  let userId: string;
  try {
    userId = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: input.username,
          email: input.email ?? null,
          name: input.name,
          jobTitle: input.jobTitle ?? null,
          passwordHash,
          mustChangePassword: true,
          memberships: {
            create: { organizationId: actor.orgId, role: input.role, capabilities: caps.next, revokedCapabilities, managerId },
          },
        },
        select: { id: true },
      });
      if (workspaceIds.length) {
        await tx.workspaceMember.createMany({
          data: workspaceIds.map((workspaceId) => ({ workspaceId, userId: user.id, role: spaceRole })),
        });
      }
      await addPersonToHq(actor.orgId, user.id, input.role, tx);
      return user.id;
    });
  } catch (err) {
    throw nameConflict(err) ?? err;
  }

  await audit("org.member_added", {
    actorId: actor.userId,
    orgId: actor.orgId,
    target: userId,
    meta: { role: input.role, username: input.username },
  });
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { name: true } });
  const { t } = getServerT();
  await pushNotification({
    userId,
    type: "welcome",
    title: t("accounts.welcome_title", { org: org?.name ?? "" }),
    body: t("accounts.welcome_body"),
    linkUrl: "/",
    // the company that welcomed them — never the other one they may belong to (review B7)
    organizationId: actor.orgId,
  });
  return { userId, username: input.username, ...(temporaryPassword ? { temporaryPassword } : {}) };
}

// ---------- update ----------

/**
 * Edits one account. Every field is optional; `capabilities` / `revokedCapabilities` replace the
 * stored lists; `password` resets to that temporary password. Becoming a GUEST clears both lists
 * and the manager and makes every space row a GUEST row; a GUEST promoted to staff becomes a
 * MEMBER of the spaces they were already in. A non-owner who re-ranks somebody gives them only the
 * new rank's defaults they hold themselves (the others start switched off).
 *
 * The edit is decided on the membership row locked inside the transaction (an offboarding that
 * committed meanwhile freezes it), manager changes run one at a time per organization, and a
 * person who is not ACTIVE here hears nothing about a new rank.
 */
export async function updateAccount(actor: Actor, userId: string, input: UpdateAccountInput): Promise<void> {
  const target = await administrableTarget(actor, userId);
  assertNotOffboarded(target); // the quick answer; decided again on the locked row below
  const role = input.role ?? target.role;
  const roleChanged = role !== target.role;
  if (roleChanged && !canChangeRoleOf(rankedActor(actor), target, role)) throw new ForbiddenError("orgm.role_denied");

  // a partner (an OWNER who is not the primary owner) holds everything but what is taken away: no extras, and any
  // capability may be taken away — only by the primary owner, the only one who administers him
  const partner = role === "OWNER";
  const caps = partner ? { next: [] as string[], problem: null } : replaceCapabilityList(actor, role, target.capabilities, input.capabilities);
  if (caps.problem) throw new ForbiddenError(caps.problem);
  const revoked = replaceCapabilityList(actor, role, roleChanged && partner ? [] : target.revokedCapabilities, input.revokedCapabilities, partner);
  if (revoked.problem) throw new ForbiddenError(revoked.problem);
  // re-ranked by a non-owner: the new rank's defaults the caller does not hold start switched off
  const revokedNext = roleChanged ? inCatalogueOrder([...revoked.next, ...unheldRankDefaults(actor, role, caps.next)]) : revoked.next;
  if (caps.next.some((c) => revokedNext.includes(c))) throw invalid("revokedCapabilities", "accounts.cap_both_lists");

  let managerId = target.managerId;
  if (role === "GUEST") {
    if (input.managerId) throw invalid("managerId", "accounts.guest_no_manager");
    managerId = null;
  } else if (input.managerId !== undefined) {
    if (input.managerId !== null) await assertManager(db, actor.orgId, input.managerId, userId);
    managerId = input.managerId;
  }

  const membership: Prisma.OrganizationMemberUpdateInput = {};
  if (roleChanged) membership.role = role;
  if (!sameList(caps.next, target.capabilities)) membership.capabilities = caps.next;
  if (!sameList(revokedNext, target.revokedCapabilities)) membership.revokedCapabilities = revokedNext;
  if (managerId !== target.managerId) membership.manager = managerId ? { connect: { id: managerId } } : { disconnect: true };

  const user: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) user.name = input.name;
  if (input.jobTitle !== undefined) user.jobTitle = input.jobTitle;
  if (input.username !== undefined || input.email !== undefined) {
    const current = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, email: true } });
    const username = input.username !== undefined && input.username !== current.username ? input.username : undefined;
    const email = input.email !== undefined && input.email !== current.email ? input.email : undefined;
    await assertNamesFree({ username, email }, userId);
    if (username !== undefined) user.username = username;
    if (email !== undefined) user.email = email;
  }
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  let status: MemberStatus;
  try {
    status = await db.$transaction(async (tx) => {
      const locked = await lockMembership(tx, target);
      if (managerId && managerId !== target.managerId) {
        // one manager change per organization at a time, and the chain is judged again under the lock
        await lockManagerChain(tx, actor.orgId);
        await assertManager(tx, actor.orgId, managerId, userId);
      }
      if (Object.keys(membership).length) await tx.organizationMember.update({ where: { id: target.id }, data: membership });
      if (passwordHash) await endSessions(tx, userId, { ...user, passwordHash, mustChangePassword: true });
      else if (Object.keys(user).length) await tx.user.update({ where: { id: userId }, data: user, select: { id: true } });
      if (roleChanged) await alignSpaceRoles(tx, actor.orgId, userId, target.role, role);
      return locked.status;
    });
  } catch (err) {
    throw nameConflict(err) ?? err;
  }

  const changed = [...Object.keys(user), ...Object.keys(membership).filter((k) => k !== "role")].map((k) => (k === "manager" ? "managerId" : k));
  if (changed.length) {
    await audit("org.member_updated", {
      actorId: actor.userId,
      orgId: actor.orgId,
      target: userId,
      meta: {
        fields: changed,
        ...(membership.capabilities ? { capabilities: caps.next } : {}),
        ...(membership.revokedCapabilities ? { revokedCapabilities: revokedNext } : {}),
      },
    });
  }
  if (roleChanged) {
    await audit("org.member_role_changed", {
      actorId: actor.userId,
      orgId: actor.orgId,
      target: userId,
      meta: { from: target.role, to: role },
    });
    // somebody suspended (or out) here learns nothing new, even while active in another company
    if (status === "ACTIVE") {
      const { t } = getServerT();
      await pushNotification({
        userId,
        type: "org_role_changed",
        title: t("accounts.role_changed_title"),
        body: t("accounts.role_changed_body", { role: t(ROLE_KEYS[role] ?? "role.member") }),
        linkUrl: "/",
        organizationId: actor.orgId,
      });
    }
  }
  if (passwordHash) {
    await audit("org.member_password_reset", { actorId: actor.userId, orgId: actor.orgId, target: userId });
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Space rows follow a rank change. To or from GUEST: an org guest is a guest in every space anyway.
 * Any other change: the HQ space role follows the rank (ADMIN ↔ space ADMIN, everybody else MEMBER),
 * so a demoted admin stops moderating the company-wide space and a new admin starts (review B4).
 * The other spaces keep the roles their own admins gave.
 */
async function alignSpaceRoles(tx: Prisma.TransactionClient, orgId: string, userId: string, from: OrgRole, to: OrgRole) {
  const rows = { userId, workspace: { organizationId: orgId } };
  if (to === "GUEST") {
    await tx.workspaceMember.deleteMany({ where: { ...rows, workspace: { organizationId: orgId, kind: "HQ" } } });
    await tx.workspaceMember.updateMany({ where: { ...rows, role: { not: "GUEST" } }, data: { role: "GUEST" } });
  } else if (from === "GUEST") {
    await tx.workspaceMember.updateMany({ where: { ...rows, role: "GUEST" }, data: { role: "MEMBER" } });
    await addPersonToHq(orgId, userId, to, tx);
  } else {
    // addPersonToHq re-reads the rank written above and upserts the HQ row with the matching role
    await addPersonToHq(orgId, userId, to, tx);
  }
}

// ---------- status: suspend / reactivate / offboard ----------

export async function setAccountStatus(
  actor: Actor,
  userId: string,
  input: AccountStatusInput,
): Promise<{ temporaryPassword?: string }> {
  const target = await administrableTarget(actor, userId);
  if (!canTransitionStatus(input.action, target.status)) throw new AccountsError(409, "accounts.bad_transition");
  switch (input.action) {
    case "suspend":
      await suspendAccount(actor, target);
      return {};
    case "reactivate":
      return { temporaryPassword: await reactivateAccount(actor, target) };
    case "offboard":
      await offboardAccount(actor, target, input.transferToUserId ?? null);
      return {};
  }
}

/** Immediate sign-out everywhere; the person keeps their spaces, so reactivation restores everything. */
async function suspendAccount(actor: Actor, target: Target): Promise<void> {
  await db.$transaction(async (tx) => {
    await flipStatus(tx, actor, target, "suspend", "SUSPENDED");
    await endSessions(tx, target.userId);
    // «الباب»: the tokens this person made die with their access (reactivating them does not bring them back)
    await revokeTokensOfPerson(tx, { orgId: actor.orgId, userId: target.userId, byUserId: actor.userId, reason: "person_suspended" });
  });
  await audit("org.member_suspended", { actorId: actor.userId, orgId: actor.orgId, target: target.userId, meta: { from: target.status } });
}

/** Back to ACTIVE with a new temporary password (returned once) that must be changed. */
async function reactivateAccount(actor: Actor, target: Target): Promise<string> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    await flipStatus(tx, actor, target, "reactivate", "ACTIVE");
    await endSessions(tx, target.userId, { passwordHash, mustChangePassword: true });
    await addPersonToHq(actor.orgId, target.userId, target.role, tx);
  });
  await audit("org.member_reactivated", { actorId: actor.userId, orgId: actor.orgId, target: target.userId, meta: { from: target.status } });
  return temporaryPassword;
}

interface Transferee {
  userId: string;
  role: OrgRole;
}

/** Who receives a leaver's work: an ACTIVE, non-guest member of the same organization, not the leaver. */
async function checkedTransferee(orgId: string, leaverId: string, transferToUserId: string): Promise<Transferee> {
  if (transferToUserId === leaverId) throw invalid("transferToUserId", "accounts.transferee_invalid");
  const member = await activeMember(orgId, transferToUserId);
  if (!member || member.role === "GUEST") throw invalid("transferToUserId", "accounts.transferee_invalid");
  return { userId: transferToUserId, role: member.role };
}

/** The person's open work in this organization (definitions shared with the roster's count). */
async function openWorkOf(client: Prisma.TransactionClient, orgId: string, userId: string) {
  // «لمين» with more than one person: a task the person holds beside its primary is their work too
  const tasks = await client.task.findMany({
    where: { ...openTaskWhere(orgId), ...assignedTo(userId) },
    select: { id: true, workspaceId: true, assigneeId: true },
  });
  const tickets = await client.ticket.findMany({ where: { ...openTicketWhere(orgId), assigneeId: userId }, select: { id: true } });
  const routines = await client.routine.findMany({ where: { ...activeRoutineWhere(orgId), assigneeId: userId }, select: { id: true } });
  return { tasks, tickets, routines, total: tasks.length + tickets.length + routines.length, userId };
}

/**
 * Offboarding, in ONE transaction (a failure anywhere leaves the account exactly as it was):
 *  - status OFFBOARDED, every session ended;
 *  - open tasks / tickets / routines to the receiver. Receiving work never opens a space: the
 *    receiver must already be in every space of that work, or be added to it by a caller who may
 *    add people there (the OWNER, or whoever manages that space's members) - otherwise 403
 *    `accounts.transfer_needs_space_access` and nothing changes;
 *  - what the leaver still led or owned is handed over (`handOverResponsibilities`);
 *  - the leaver leaves every space, every group chat (DMs stay, so the other side keeps the
 *    history) and every department roster of this organization;
 *  - the people they managed report to the leaver's own manager (or to nobody).
 * Nothing else is deleted: the account, the membership row and everything they wrote stay.
 * Reactivation gives NONE of this back but «الشركة»: spaces, group chats, departments, leads and owners
 * stay where offboarding put them, and the owner puts the person back where they belong. The company
 * space (HQ) is everybody's, so a reactivated person is back in it at once (the owner's decision,
 * 2026-10-24; reactivateAccount → addPersonToHq).
 */
async function offboardAccount(actor: Actor, target: Target, transferToUserId: string | null): Promise<void> {
  const transferee = transferToUserId ? await checkedTransferee(actor.orgId, target.userId, transferToUserId) : null;
  if (!transferee && (await openWorkOf(db, actor.orgId, target.userId)).total > 0) {
    throw new AccountsError(400, "accounts.transfer_required");
  }

  const moved = await db.$transaction(async (tx) => {
    await flipStatus(tx, actor, target, "offboard", "OFFBOARDED");
    const work = await openWorkOf(tx, actor.orgId, target.userId);
    if (work.total > 0) {
      if (!transferee) throw new AccountsError(400, "accounts.transfer_required");
      await transferWork(tx, actor, work, transferee);
    }
    const handedOver = await handOverResponsibilities(tx, actor, target.userId, transferee);
    const where = { userId: target.userId };
    const spaces = await tx.workspaceMember.deleteMany({ where: { ...where, workspace: { organizationId: actor.orgId } } });
    // and out of every team of the company's spaces (a team holds only people of its space)
    await tx.teamMember.deleteMany({ where: { ...where, team: { workspace: { organizationId: actor.orgId } } } });
    await tx.team.updateMany({ where: { leadId: target.userId, workspace: { organizationId: actor.orgId } }, data: { leadId: null } });
    const groupChats = await tx.conversationMember.deleteMany({
      where: { ...where, conversation: { orgId: actor.orgId, kind: { not: "DM" } } },
    });
    const departments = await tx.departmentMember.deleteMany({ where: { ...where, department: { orgId: actor.orgId } } });
    // out of the HQ topics too (DMs stay, the other side keeps the history): inside the same transaction,
    // and so is its audit row (a crash between the two used to leave the person out with no trace)
    await removePersonFromHq(tx, actor.orgId, target.userId);
    await removePersonAudit(actor.orgId, actor.userId, target.userId, tx);
    const reports = await repointReports(tx, actor.orgId, target);
    await endSessions(tx, target.userId);
    // «الباب»: the tokens this person made die with their access, in the same commit
    await revokeTokensOfPerson(tx, { orgId: actor.orgId, userId: target.userId, byUserId: actor.userId, reason: "person_offboarded" });
    return {
      tasks: work.tasks.length,
      tickets: work.tickets.length,
      routines: work.routines.length,
      spaces: spaces.count,
      groupChats: groupChats.count,
      departments: departments.count,
      reports,
      handedOver,
    };
  });

  await audit("org.member_offboarded", {
    actorId: actor.userId,
    orgId: actor.orgId,
    target: target.userId,
    meta: { from: target.status, transferTo: transferee?.userId ?? null, ...moved },
  });
  if (transferee && transferee.userId !== actor.userId && moved.tasks + moved.tickets + moved.routines > 0) {
    const { t } = getServerT();
    await pushNotification({
      userId: transferee.userId,
      type: "work_transferred",
      title: t("accounts.work_transferred_title", { name: target.name }),
      body: t("accounts.work_transferred_body", { tasks: moved.tasks, tickets: moved.tickets, routines: moved.routines }),
      linkUrl: "/my-work",
      organizationId: actor.orgId,
    });
  }
}

async function transferWork(
  tx: Prisma.TransactionClient,
  actor: Actor,
  work: Awaited<ReturnType<typeof openWorkOf>>,
  transferee: Transferee,
): Promise<void> {
  const to = transferee.userId;
  if (work.tasks.length) {
    // the OWNER sees every space; anybody else must be IN a space to open its tasks - and being
    // given work never opens one: only a caller who may add people to that space adds the receiver
    if (transferee.role !== "OWNER") {
      const spaces = [...new Set(work.tasks.map((t) => t.workspaceId))];
      const inAlready = await tx.workspaceMember.findMany({ where: { userId: to, workspaceId: { in: spaces } }, select: { workspaceId: true } });
      const missing = spaces.filter((id) => !inAlready.some((row) => row.workspaceId === id));
      if (!actor.isOwner) {
        for (const workspaceId of missing) {
          if (!(await canManageWorkspaceMembers(actor.userId, workspaceId))) throw new ForbiddenError("accounts.transfer_needs_space_access");
        }
      }
      if (missing.length) {
        await tx.workspaceMember.createMany({
          data: missing.map((workspaceId) => ({ workspaceId, userId: to, role: "MEMBER" as const })),
          skipDuplicates: true,
        });
      }
    }
    const ids = work.tasks.map((t) => t.id);
    // «لمين» with more than one person: the receiver takes over only the tasks whose PRIMARY was the leaver
    // (a task somebody else leads keeps its lead), and the leaver is removed from the ones they merely shared.
    // A task that lost its primary and has nobody else becomes the receiver's, so no open work is left behind.
    await tx.taskCoAssignee.deleteMany({ where: { taskId: { in: ids }, userId: work.userId } });
    const handed = work.tasks.filter((t) => t.assigneeId === work.userId || t.assigneeId === null).map((t) => t.id);
    await tx.task.updateMany({ where: { id: { in: handed } }, data: { assigneeId: to } });
    await tx.taskActivity.createMany({
      data: ids.map((taskId) => ({ taskId, actorId: actor.userId, event: "task.updated", meta: { fields: ["assignee"], reason: "offboarding" } })),
    });
  }
  if (work.tickets.length) {
    const ids = work.tickets.map((t) => t.id);
    await tx.ticket.updateMany({ where: { id: { in: ids } }, data: { assigneeId: to } });
    await tx.ticketActivity.createMany({
      data: ids.map((ticketId) => ({ ticketId, actorId: actor.userId, event: "assigned", meta: { assigneeId: to, reason: "offboarding" } })),
    });
  }
  if (work.routines.length) {
    await tx.routine.updateMany({ where: { id: { in: work.routines.map((r) => r.id) } }, data: { assigneeId: to } });
  }
}

/**
 * The leaver's people now report to the leaver's own manager when that one is still ACTIVE staff,
 * else to nobody (escalations then go to the owner). Done under the manager-chain lock, on the
 * chain as it is now; anybody for whom that would close a loop (old data) reports to nobody.
 */
async function repointReports(tx: Prisma.TransactionClient, orgId: string, target: Target): Promise<number> {
  await lockManagerChain(tx, orgId);
  const members = await managerChain(tx, orgId);
  const heirRow = target.managerId ? members.find((m) => m.userId === target.managerId) : undefined;
  const heir = heirRow && heirRow.status === "ACTIVE" && heirRow.role !== "GUEST" ? heirRow.userId : null;
  const reports = members.filter((m) => m.managerId === target.userId).map((m) => m.userId);
  const managerOf = new Map(members.map((m) => [m.userId, m.managerId]));
  managerOf.set(target.userId, null); // the leaver is in nobody's chain any more
  const toHeir = heir ? reports.filter((r) => !wouldCreateManagerCycle(managerOf, r, heir)) : [];
  const toNobody = reports.filter((r) => !toHeir.includes(r));
  if (toHeir.length) {
    await tx.organizationMember.updateMany({ where: { organizationId: orgId, userId: { in: toHeir } }, data: { managerId: heir } });
  }
  if (toNobody.length) {
    await tx.organizationMember.updateMany({ where: { organizationId: orgId, userId: { in: toNobody } }, data: { managerId: null } });
  }
  return reports.length;
}

const RUNNING_CAMPAIGN: CampaignStatus[] = ["DRAFT", "SCHEDULED", "RUNNING"];
const CLOSED_DEAL: OpportunityStage[] = ["WON", "LOST"];
const FINISHED_PROJECT: ProjectStatus[] = ["COMPLETED", "ARCHIVED"];

/**
 * What the leaver still led or owned goes to the receiver; it never opens anything to them:
 *  - Department.leadId: to the receiver only when the caller may appoint department leads (OWNER /
 *    ADMIN, departments.ts), otherwise the seat is vacated (a lead manages the department's tickets);
 *  - Team.leadId and the owner of a running Project / open Milestone: to the receiver when it can
 *    open that space (the OWNER, or a row there), otherwise vacated;
 *  - the owner of a running Campaign / open Opportunity: to the receiver. These columns are NOT
 *    NULL, so without a receiver they keep the leaver.
 * Without a receiver every nullable seat is vacated. Finished things (a DONE campaign, a WON or LOST
 * deal, a COMPLETED project, a COMPLETED milestone) keep the person who did them: that is history.
 */
async function handOverResponsibilities(tx: Prisma.TransactionClient, actor: Actor, leaverId: string, transferee: Transferee | null) {
  const orgId = actor.orgId;
  const to = transferee?.userId ?? null;
  const receiverSpaces =
    transferee === null || transferee.role === "OWNER"
      ? null
      : new Set(
          (await tx.workspaceMember.findMany({ where: { userId: transferee.userId, workspace: { organizationId: orgId } }, select: { workspaceId: true } })).map(
            (row) => row.workspaceId,
          ),
        );
  const opens = (workspaceId: string) => to !== null && (receiverSpaces === null || receiverSpaces.has(workspaceId));
  /** Ids to the receiver (where it can open the space) and ids to vacate. */
  const split = <T extends { id: string }>(rows: T[], spaceOf: (row: T) => string) => ({
    give: rows.filter((r) => opens(spaceOf(r))).map((r) => r.id),
    vacate: rows.filter((r) => !opens(spaceOf(r))).map((r) => r.id),
  });

  const departments = await tx.department.updateMany({
    where: { orgId, leadId: leaverId },
    data: { leadId: to !== null && canManageDepartments(actor.role) ? to : null },
  });

  const teams = split(
    await tx.team.findMany({ where: { leadId: leaverId, workspace: { organizationId: orgId } }, select: { id: true, workspaceId: true } }),
    (t) => t.workspaceId,
  );
  if (teams.give.length) await tx.team.updateMany({ where: { id: { in: teams.give } }, data: { leadId: to } });
  if (teams.vacate.length) await tx.team.updateMany({ where: { id: { in: teams.vacate } }, data: { leadId: null } });

  const projects = split(
    await tx.project.findMany({
      where: { ownerId: leaverId, status: { notIn: FINISHED_PROJECT }, workspace: { organizationId: orgId } },
      select: { id: true, workspaceId: true },
    }),
    (p) => p.workspaceId,
  );
  if (projects.give.length) await tx.project.updateMany({ where: { id: { in: projects.give } }, data: { ownerId: to } });
  if (projects.vacate.length) await tx.project.updateMany({ where: { id: { in: projects.vacate } }, data: { ownerId: null } });

  const milestones = split(
    await tx.milestone.findMany({
      where: { ownerId: leaverId, status: { not: "COMPLETED" }, project: { workspace: { organizationId: orgId } } },
      select: { id: true, project: { select: { workspaceId: true } } },
    }),
    (m) => m.project.workspaceId,
  );
  if (milestones.give.length) await tx.milestone.updateMany({ where: { id: { in: milestones.give } }, data: { ownerId: to } });
  if (milestones.vacate.length) await tx.milestone.updateMany({ where: { id: { in: milestones.vacate } }, data: { ownerId: null } });

  const campaigns = to ? await tx.campaign.updateMany({ where: { orgId, ownerId: leaverId, status: { in: RUNNING_CAMPAIGN } }, data: { ownerId: to } }) : { count: 0 };
  const opportunities = to
    ? await tx.opportunity.updateMany({ where: { orgId, ownerId: leaverId, stage: { notIn: CLOSED_DEAL } }, data: { ownerId: to } })
    : { count: 0 };

  return {
    departmentLeads: departments.count,
    teamLeads: teams.give.length + teams.vacate.length,
    projects: projects.give.length + projects.vacate.length,
    milestones: milestones.give.length + milestones.vacate.length,
    campaigns: campaigns.count,
    opportunities: opportunities.count,
  };
}

// ---------- password reset / log out everywhere ----------

/** A new temporary password (returned once), which must be changed; every session ends. */
export async function resetAccountPassword(actor: Actor, userId: string): Promise<{ temporaryPassword: string }> {
  const target = await administrableTarget(actor, userId);
  assertNotOffboarded(target);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    await lockMembership(tx, target);
    await endSessions(tx, target.userId, { passwordHash, mustChangePassword: true });
  });
  await audit("org.member_password_reset", { actorId: actor.userId, orgId: actor.orgId, target: target.userId });
  return { temporaryPassword };
}

/** Ends every session of the person; nothing else changes. */
export async function logoutEverywhere(actor: Actor, userId: string): Promise<void> {
  const target = await administrableTarget(actor, userId);
  await db.$transaction((tx) => endSessions(tx, target.userId));
  await audit("org.member_logged_out", { actorId: actor.userId, orgId: actor.orgId, target: target.userId });
}
