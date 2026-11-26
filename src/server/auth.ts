import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "./db";
import { perRequest } from "./env";
import { actingUserId } from "./acting-as";
import { log } from "./log";
import { getSessionUser, clearSessionCookie, setSessionCookie } from "./session";
import { createSession, readSession, renewSession, revokeReplacedSession, touchSession } from "./services/sessions";
import type { OrgRole, WorkspaceRole } from "@prisma/client";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { onboardingStateOf } from "./policy/org-settings";
import { assignedOnlyInSpace, heldProjects } from "./policy/assigned-only";
import { isSpaceManager, workspaceRoleOf } from "./workspace-role";

export { clearSessionCookie, setSessionCookie };

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export interface CurrentUser {
  id: string;
  /** Optional: an account may have only a username. */
  email: string | null;
  username: string | null;
  name: string;
  locale: string;
  /** The password is a temporary one chosen by the owner: it must be changed first. */
  mustChangePassword: boolean;
  /** The transparency notice (work chats are archived and visible to the owner) is not accepted yet. */
  transparencyPending: boolean;
  /**
   * The session version this request was authenticated with (it equals the cookie's `tv` and was
   * equal to the database value when the request began). A route that re-issues the cookie signs
   * THIS value, never a fresh read: a revocation that lands while the request is in flight must
   * not be laundered into a brand-new cookie.
   */
  tv: number;
  /** The `UserSession` this request belongs to (C4.2); null for a cookie issued before the table existed. */
  sid?: string | null;
}

/**
 * The signed-in user, or null. Null means: no cookie, a cookie that is no longer honoured (the
 * user's session version moved on: suspended, offboarded, password reset, "log out everywhere"; or
 * ITS session row was ended or is gone: «اطلع من هالجهاز», C4.2), or no ACTIVE membership anywhere.
 * A cookie without a session id (issued before C4.2) is still honoured until it expires: the deploy
 * signs nobody out. The session row is read in parallel with the user (no extra round trip) and its
 * `lastSeenAt` is written at most once every few minutes (`touchSession`). Safe to call in server components.
 *
 * Read ONCE per server render (`perRequest`, F1.1): the layout and the page both ask, and the second ask is free. Nothing
 * outlives the render, so a session revoked a moment later is refused by the very next request.
 */
export const currentUser: () => Promise<CurrentUser | null> = perRequest(async () => {
  // a machine caller that passed its own gate acts for ONE person for the length of one call (src/server/acting-as.ts: only the MCP route sets it)
  const acting = actingUserId();
  const session = acting ? { userId: acting, tv: -1, sid: null as string | null } : await getSessionUser();
  if (!session) return null;
  const [user, row] = await Promise.all([
    db.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        locale: true,
        tokenVersion: true,
        mustChangePassword: true,
        transparencyVersion: true,
        memberships: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { organization: { select: { settings: true } } },
        },
      },
    }),
    session.sid ? readSession(session.sid) : Promise.resolve(null),
  ]);
  if (!user || (!acting && user.tokenVersion !== session.tv)) return null;
  const active = user.memberships[0];
  if (!active) return null;
  // a cookie that names a session must find it live and the person's own; a cookie that names none is an old one (honoured until it expires)
  if (session.sid && (!row || row.userId !== user.id || row.revokedAt)) return null;
  if (row) await touchSession(row);
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    locale: user.locale,
    tv: user.tokenVersion,
    sid: session.sid ?? null,
    ...onboardingStateOf(user, active.organization.settings),
  };
});

/**
 * For server-rendered pages: the person looking at the page, or null when nobody is signed in
 * (the page decides, usually `redirect("/login")`). Somebody who still owes the onboarding
 * (temporary password, transparency notice) never gets a page: they are sent to /onboarding BEFORE
 * anything is read. The (app) layout redirects them too, but in the App Router a page runs (and
 * its output is streamed) even when its layout redirects, so every page must refuse for itself.
 */
export const pageUser: () => Promise<CurrentUser | null> = perRequest(async () => {
  const user = await currentUser();
  if (user && (user.mustChangePassword || user.transparencyPending)) redirect("/onboarding");
  return user;
});

/**
 * The signed-in user or a 401. Until they have changed a temporary password and accepted the
 * transparency notice the answer is 403 `auth.onboarding_required`; only the few routes that
 * ARE the onboarding (change password, accept notice, who am I, sign out) pass `allowPending`.
 */
export async function requireUser(opts: { allowPending?: boolean } = {}): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) {
    throw new UnauthorizedError("auth.required");
  }
  if (!opts.allowPending && (user.mustChangePassword || user.transparencyPending)) {
    throw new ForbiddenError("auth.onboarding_required");
  }
  return user;
}

/**
 * Signs `userId` in: a cookie carrying a session version, the id of the person's session row and whatever onboarding they still owe.
 * Used after login, password change and accepting the notice.
 *
 * `opts.fresh` (a sign-in, a registration) starts a NEW session row for this device (`opts.userAgent` is stored trimmed) and ends the one the browser's
 * old cookie named, so a browser that signs in again is one device in the list, not two. Without it the cookie being replaced KEEPS its session: the row
 * follows the new version and expiry (a password change leaves this device signed in and ends the others through the version). An old cookie that has no
 * session stays as it is (the re-issue is old-shaped too: the deploy changes nothing for it) unless `opts.adopt` asks for it to get a row now
 * (`GET /api/me/sessions`: the person opened their devices list, so this device must be in it and endable from another).
 *
 * `opts.tv` is the version to sign. A sign-in (nobody is authenticated yet) leaves it out and gets
 * the CURRENT version. A request that is already authenticated passes the version it was
 * authenticated with (`CurrentUser.tv`, or the new version a password change just wrote): if the
 * session was revoked in the meantime that cookie is simply already stale, instead of the
 * revocation being undone by a fresh read.
 */
export async function startSession(userId: string, opts: { tv?: number; fresh?: boolean; adopt?: boolean; userAgent?: string | null } = {}): Promise<{ sid: string | null }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      tokenVersion: true,
      mustChangePassword: true,
      transparencyVersion: true,
      memberships: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { organization: { select: { settings: true } } },
      },
    },
  });
  const onboarding = onboardingStateOf(user, user.memberships[0]?.organization.settings ?? {});
  const tv = opts.tv ?? user.tokenVersion;
  const held = await getSessionUser();
  let sid: string | null = null;
  if (opts.fresh) {
    if (held?.sid) await revokeReplacedSession(held.sid);
    sid = await createSession({ userId, tokenVersion: tv, userAgent: opts.userAgent !== undefined ? opts.userAgent : await requestUserAgent() });
  } else if (held?.sid && held.userId === userId) {
    // the request's own session: NEVER re-read or revived here (a revocation that landed in flight leaves this cookie dead)
    sid = held.sid;
    await renewSession(sid, userId, tv);
  } else if (opts.adopt) {
    sid = await createSession({ userId, tokenVersion: tv, userAgent: opts.userAgent !== undefined ? opts.userAgent : await requestUserAgent() });
  }
  await setSessionCookie({
    userId,
    tv,
    ...(sid ? { sid } : {}),
    ...(onboarding.mustChangePassword ? { mcp: true } : {}),
    ...(onboarding.transparencyPending ? { tp: true } : {}),
  });
  return { sid };
}

/** The caller's user agent, for a session created outside a sign-in route (an old cookie being adopted). Null when there is no request to read. */
async function requestUserAgent(): Promise<string | null> {
  try {
    return (await headers()).get("user-agent");
  } catch {
    return null;
  }
}

export class UnauthorizedError extends Error {
  constructor(msg = "auth.required") {
    super(msg);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(msg = "forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(msg = "not_found") {
    super(msg);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(issues: { path: string; message: string }[]) {
    super("validation.failed");
    this.name = "ValidationError";
    this.issues = issues;
  }
}

// ---------- Guards ----------

export interface OrgAccessContext {
  orgId: string;
  orgRole: OrgRole;
  userId: string;
  /** Set by `requireWorkspace`: does this person see every team of the space (src/server/services/team-scope.ts)? */
  spaceManager?: boolean;
}

/**
 * Verifies ACTIVE organization membership and returns the role. A suspended or offboarded member
 * is "not a member". GUESTs have read-only access by default; callers must check capabilities.
 */
export async function requireOrgMember(orgId: string): Promise<OrgAccessContext> {
  const user = await requireUser();
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    select: { role: true, status: true },
  });
  if (!member || member.status !== "ACTIVE") throw new ForbiddenError("not_org_member");
  return { orgId, orgRole: member.role, userId: user.id };
}

/** Throws unless the member holds one of the allowed roles. */
export async function requireOrgRole(
  orgId: string,
  roles: OrgRole[],
): Promise<OrgAccessContext> {
  const ctx = await requireOrgMember(orgId);
  if (!roles.includes(ctx.orgRole)) throw new ForbiddenError("insufficient_role");
  return ctx;
}

/**
 * A workspace (space) is visible to the people IN it, and to the organization OWNER, who sees
 * every one of them. Everybody else — an ADMIN included — needs a WorkspaceMember row, and an
 * ACTIVE organization membership to go with it (a removed employee's leftover row grants nothing).
 *
 * `roles` are the WORKSPACE roles allowed in. An org GUEST is a guest in every workspace whatever
 * their row says; an org ADMIN who is in a workspace outranks a lower row of their own.
 */
export async function requireWorkspace(
  workspaceId: string,
  roles: WorkspaceRole[] = ["ADMIN", "MEMBER", "GUEST"],
): Promise<OrgAccessContext> {
  const user = await requireUser();
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, organizationId: true },
  });
  if (!workspace) throw new NotFoundError("workspace.not_found");
  const [orgMember, wsMember] = await Promise.all([
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: workspace.organizationId, userId: user.id } },
      select: { role: true, status: true },
    }),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      select: { role: true },
    }),
  ]);
  if (!orgMember || orgMember.status !== "ACTIVE") throw new ForbiddenError("not_workspace_member");
  const ctx: OrgAccessContext = {
    orgId: workspace.organizationId,
    orgRole: orgMember.role,
    userId: user.id,
    spaceManager: isSpaceManager(orgMember.role, wsMember?.role),
  };
  if (orgMember.role === "OWNER") return ctx;
  if (!wsMember) throw new ForbiddenError("not_workspace_member");
  if (roles.includes(workspaceRoleOf(orgMember.role, wsMember.role))) return ctx;
  if (orgMember.role === "ADMIN" && roles.includes("ADMIN")) return ctx;
  throw new ForbiddenError("insufficient_role");
}

/**
 * A project the caller may open: the space guard (`requireWorkspace(project.workspaceId, roles)`), then its
 * TEAM — a project of a team is seen by that team and the space's managers only. Somebody outside the team
 * gets "not found", as if it did not exist (the link says nothing). Returns the context and the project's ids.
 */
export async function requireProjectAccess(
  projectId: string,
  roles: WorkspaceRole[] = ["ADMIN", "MEMBER", "GUEST"],
): Promise<OrgAccessContext & { project: { id: string; workspaceId: string; teamId: string | null } }> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, workspaceId: true, teamId: true } });
  if (!project) throw new NotFoundError("project.not_found");
  const ctx = await requireWorkspace(project.workspaceId, roles);
  if (!(await seesTeamOf(ctx.userId, project.teamId, ctx.spaceManager === true))) throw new NotFoundError("project.not_found");
  await assertProjectHeld(ctx.userId, project.id, project.workspaceId);
  return { ...ctx, project };
}

/** The same for a task: its space, then its project's team. */
export async function requireTaskAccess(
  taskId: string,
  roles: WorkspaceRole[] = ["ADMIN", "MEMBER", "GUEST"],
): Promise<OrgAccessContext & { task: { id: string; workspaceId: string; projectId: string; teamId: string | null } }> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      visibility: true,
      creatorId: true,
      assigneeId: true,
      coAssignees: { select: { userId: true } },
      project: { select: { teamId: true } },
    },
  });
  if (!task) throw new NotFoundError("task.not_found");
  const ctx = await requireWorkspace(task.workspaceId, roles);
  const teamId = task.project?.teamId ?? null;
  if (!(await seesTeamOf(ctx.userId, teamId, ctx.spaceManager === true))) throw new NotFoundError("task.not_found");
  await assertTaskParticipant(ctx.userId, task, "task.not_found");
  return { ...ctx, task: { id: task.id, workspaceId: task.workspaceId, projectId: task.projectId, teamId } };
}

/** What the private-task check needs about one task (`visibility` is `Task.visibility`). */
export interface TaskParticipantFacts {
  id: string;
  workspaceId: string;
  visibility: string;
  creatorId: string;
  assigneeId: string | null;
  coAssignees?: { userId: string }[];
}

/**
 * A private task («المعنيين بس»): only the people it concerns, their managers up the reporting line, the space's managers
 * and whoever holds silent oversight pass; everybody else gets "not found" — the existence of the task is private too.
 *
 * Then «كل واحد بيشوف مهامه بس» (`assignedTasksOnly`): somebody held to their own, who does not hold this one (and was not
 * asked to take it), is refused with 403, whoever they are to it. Somebody who holds the task costs nothing here.
 */
export async function assertTaskParticipant(userId: string, task: TaskParticipantFacts, notFound = "task.not_found"): Promise<void> {
  const coAssigneeIds = (task.coAssignees ?? []).map((c) => c.userId);
  if (task.assigneeId === userId || coAssigneeIds.includes(userId)) return;
  if (task.visibility === "PARTICIPANTS") {
    const { loadWorkScope, concernsPerson } = await import("@/server/services/team-scope");
    if (!concernsPerson(await loadWorkScope(userId), { ...task, coAssigneeIds })) throw new NotFoundError(notFound);
  }
  if (!(await assignedOnlyInSpace(userId, task.workspaceId))) return;
  const asked = await db.taskAssignRequest.findFirst({ where: { taskId: task.id, toUserId: userId, status: "PENDING" }, select: { id: true } });
  if (!asked) throw new ForbiddenError("task.not_assigned");
}

/** «كل واحد بيشوف مهامه بس»: somebody held to their own opens only a project where they hold a task (403). */
async function assertProjectHeld(userId: string, projectId: string, workspaceId: string): Promise<void> {
  if (!(await assignedOnlyInSpace(userId, workspaceId))) return;
  const row = await db.project.findFirst({ where: { id: projectId, OR: heldProjects(userId) }, select: { id: true } });
  if (!row) throw new ForbiddenError("project.not_assigned");
}

/**
 * The space guard plus the TEAM of the thing being opened (a project's `teamId`, or the project's of a board, a
 * column, a task, a comment): outside the team → "not found". Use it wherever `requireWorkspace` guarded a
 * project-bound row.
 */
export async function requireTeamWork(
  workspaceId: string,
  teamId: string | null | undefined,
  roles: WorkspaceRole[] = ["ADMIN", "MEMBER", "GUEST"],
  notFound = "not_found",
  /** when the thing opened is a TASK: its private-task facts (the check of «المعنيين بس» runs too) */
  task?: TaskParticipantFacts,
  /** when the thing opened is a PROJECT or hangs off one (a board, a column, a milestone): «مهامه بس» runs on it */
  projectId?: string,
): Promise<OrgAccessContext> {
  const ctx = await requireWorkspace(workspaceId, roles);
  if (!(await seesTeamOf(ctx.userId, teamId ?? null, ctx.spaceManager === true))) throw new NotFoundError(notFound);
  if (task) await assertTaskParticipant(ctx.userId, task, notFound);
  if (projectId) await assertProjectHeld(ctx.userId, projectId, workspaceId);
  return ctx;
}

/** No team, a manager, or a member of the team (one query at most). Kept here so auth.ts imports no service. */
async function seesTeamOf(userId: string, teamId: string | null, manager: boolean): Promise<boolean> {
  if (!teamId || manager) return true;
  return !!(await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } }, select: { id: true } }));
}

export async function audit(
  action: string,
  opts: {
    actorId?: string | null;
    orgId?: string | null;
    target?: string | null;
    meta?: Prisma.InputJsonValue;
  } = {},
): Promise<void> {
  log.info(action, { actor: opts.actorId, org: opts.orgId, target: opts.target });
  await db.auditLog.create({
    data: {
      action,
      actorId: opts.actorId ?? null,
      orgId: opts.orgId ?? null,
      target: opts.target ?? null,
      meta: opts.meta ?? Prisma.JsonNull,
    },
  });
}

/** Short stable id for logging correlation (no PII). */
export function correlationId(): string {
  return createHash("sha256").update(crypto.randomUUID()).digest("hex").slice(0, 12);
}
