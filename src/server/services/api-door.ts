import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { clientIp } from "@/server/rate-limit";
import { log } from "@/server/log";
import { can } from "@/server/policy/capabilities";
import { assertMemberCan } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { isFeatureOn } from "@/server/services/features";
import { createIdea, type IdeaDTO } from "@/server/services/ideas";
import { createTaskInTx } from "@/server/services/tasks";
import { userSeesProject } from "@/server/services/team-scope";
import { orgTimeZone } from "@/server/services/org-day";
import { dispatchEvent } from "@/server/services/n8n";
import { dueInstantForDay, parseDayText } from "@/lib/due-day";
import { bearerOf, parseToken, permits, tokenMatches, type DoorPermission } from "@/server/door/tokens";
import { DoorError } from "@/server/door/http";
import { failureLimiter, tokenLimiter } from "@/server/door/limits";
import {
  IDEMPOTENCY_KEY,
  IDEMPOTENCY_TTL_MS,
  requestHash,
  storedIdempotencyKey,
  type IdeaBody,
  type IdempotencyType,
  type TaskBody,
} from "@/server/door/payload";

/**
 * «الباب» (docs/contracts/workspace-door.v1.md): what System 7 (or any Zaki system holding a token) may do through /api/v1.
 *
 * A token belongs to ONE company, holds named permissions and writes to ONE space. It acts in the name of the person who made it
 * (`createdBy`): every rule of the app that applies to that person applies to the token (`createTask`'s chain, the section grid's
 * «يضيف ويعدّل»), and the moment that person is not an ACTIVE member holding «integrations.manage», or no longer reaches the
 * space, the token answers 401 like any unknown token. All of it is read from the database on EVERY request.
 */

export interface DoorPrincipal {
  tokenId: string;
  tokenName: string;
  orgId: string;
  /** The person the token acts for. */
  issuerId: string;
  /** The one space it writes to. */
  workspaceId: string;
  permissions: string[];
  requestId: string;
}

const UNAUTHORIZED = () => new DoorError(401, "door.unauthorized", "The token is missing, unknown, revoked, expired or no longer allowed.", undefined, { "www-authenticate": 'Bearer realm="zaki-door"' });

/** The last use is written at most once a minute (a busy sender must not turn every read into a write). */
const TOUCH_EVERY_MS = 60_000;

/**
 * The whole front gate, in the order that leaks least:
 *  1. an address that keeps presenting refused tokens is answered 429 before anything is looked up;
 *  2. the token: shape, then the row by its public prefix, then a CONSTANT-TIME comparison of the hash (an unknown prefix is
 *     compared against a decoy so it costs the same); revoked / expired / issuer no longer allowed / space no longer reachable
 *     are ALL the same 401: the sender learns nothing about which;
 *  3. the company's switch «باب الربط» (off: 404 for everybody);
 *  4. the token's rate limit (429 + Retry-After);
 *  5. the permission the route needs (403).
 */
export async function authenticateDoor(req: Request, requestId: string, needed: DoorPermission): Promise<DoorPrincipal> {
  const ip = clientIp(req);
  const blocked = failureLimiter.check(ip);
  if (!blocked.ok) {
    throw new DoorError(429, "door.rate_limited", "Too many refused requests from this address.", undefined, { "retry-after": String(Math.max(1, blocked.retryAfterSec)) });
  }
  const refuse = (reason: string, tokenId?: string): never => {
    failureLimiter.hit(ip);
    log.warn("door.refused", { requestId, reason, tokenId });
    throw UNAUTHORIZED();
  };

  const token = bearerOf(req.headers.get("authorization"));
  if (!token) return refuse("no_bearer");
  const parsed = parseToken(token);
  if (!parsed) return refuse("malformed");

  const row = await db.apiToken.findUnique({
    where: { prefix: parsed.prefix },
    select: {
      id: true,
      name: true,
      organizationId: true,
      workspaceId: true,
      createdById: true,
      permissions: true,
      tokenHash: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
  // compared even when there is no row: the same work for "no such token" and "wrong secret"
  if (!tokenMatches(token, row?.tokenHash ?? null) || !row) return refuse("unknown_or_wrong");
  const now = new Date();
  if (row.revokedAt) return refuse("revoked", row.id);
  if (row.expiresAt && row.expiresAt <= now) return refuse("expired", row.id);

  // the person it acts for, read now: rank, status and capabilities are never remembered
  const issuer = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: row.organizationId, userId: row.createdById } },
    select: { role: true, status: true, capabilities: true, revokedCapabilities: true, primaryOwner: true },
  });
  if (!issuer || issuer.status !== "ACTIVE" || issuer.role === "GUEST" || !can(issuer, "integrations.manage")) {
    return refuse("issuer_inactive", row.id);
  }
  if (!(await accessibleWorkspaceIds(row.createdById)).includes(row.workspaceId)) return refuse("space_unreachable", row.id);

  if (!(await isFeatureOn(row.organizationId, "apiDoor"))) throw new DoorError(404, "door.not_found", "Not found.");

  const limited = tokenLimiter.check(`t:${row.id}`);
  if (!limited.ok) {
    throw new DoorError(429, "door.rate_limited", "Too many requests for this token.", undefined, { "retry-after": String(Math.max(1, limited.retryAfterSec)) });
  }
  tokenLimiter.hit(`t:${row.id}`);

  if (!permits(row.permissions, needed)) {
    throw new DoorError(403, "door.forbidden", `This token does not hold the permission ${needed}.`);
  }

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    // best effort: a failed bookkeeping write never refuses a request that was allowed
    await db.apiToken
      .updateMany({ where: { id: row.id, revokedAt: null }, data: { lastUsedAt: now } })
      .catch((err: unknown) => log.warn("door.touch_failed", { requestId, message: err instanceof Error ? err.message : String(err) }));
  }

  return {
    tokenId: row.id,
    tokenName: row.name,
    orgId: row.organizationId,
    issuerId: row.createdById,
    workspaceId: row.workspaceId,
    permissions: row.permissions,
    requestId,
  };
}

/** The `Idempotency-Key` header of a write: required, 8..128 of letters, digits and `. _ : -`. */
export function idempotencyKeyOf(req: Request): string {
  const key = req.headers.get("idempotency-key");
  if (!key) throw new DoorError(400, "door.idempotency_key_required", "Send an Idempotency-Key header with every write.");
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new DoorError(400, "door.idempotency_key_invalid", "Idempotency-Key must be 8 to 128 characters: letters, digits and . _ : -");
  }
  return key;
}

// ---------- idempotent writes ----------

type Tx = Prisma.TransactionClient;

interface Made {
  status: number;
  body: Prisma.InputJsonObject;
  resourceType: "idea" | "task";
  resourceId: string;
}

export interface DoorWrite {
  status: number;
  body: unknown;
  replayed: boolean;
}

function isUniqueViolation(err: unknown, field: string): boolean {
  if (typeof err !== "object" || err === null || (err as { code?: unknown }).code !== "P2002") return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}

/**
 * One write that happens once however often the sender retries it. The thing, its audit row and the record of the answer are born
 * in ONE transaction: there is never a thing without its record or a record without its thing. Two identical requests that arrive
 * together both try the record; the unique index lets one commit and the other rolls back whole and answers from the winner's
 * record. The same key with a DIFFERENT body is 409, never a silent second answer.
 */
async function idempotently(
  who: DoorPrincipal,
  type: IdempotencyType,
  clientKey: string,
  body: unknown,
  make: (tx: Tx) => Promise<Made>,
): Promise<DoorWrite> {
  const key = storedIdempotencyKey({ organizationId: who.orgId, tokenId: who.tokenId, type, key: clientKey });
  const hash = requestHash(type, body);

  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await db.idempotencyRecord.findUnique({ where: { key } });
    if (found) {
      if (found.expiresAt > new Date()) {
        if (found.requestHash !== hash) {
          throw new DoorError(409, "door.idempotency_conflict", "This Idempotency-Key was already used with a different request body.");
        }
        return { status: found.responseStatus, body: found.responseBody, replayed: true };
      }
      // an old answer (past its 48 hours): the key is free again
      await db.idempotencyRecord.deleteMany({ where: { id: found.id, expiresAt: { lte: new Date() } } });
    }
    try {
      const made = await db.$transaction(async (tx) => {
        const out = await make(tx);
        await tx.idempotencyRecord.create({
          data: {
            organizationId: who.orgId,
            tokenId: who.tokenId,
            key,
            requestHash: hash,
            responseStatus: out.status,
            responseBody: out.body,
            resourceType: out.resourceType,
            resourceId: out.resourceId,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
        return out;
      });
      // opportunistic housekeeping: this company's answers past their window (an indexed delete, never fatal)
      void db.idempotencyRecord.deleteMany({ where: { organizationId: who.orgId, expiresAt: { lte: new Date() } } }).catch(() => undefined);
      return { status: made.status, body: made.body, replayed: false };
    } catch (err) {
      if (isUniqueViolation(err, "key")) continue; // somebody else just wrote it: answer from their record
      throw err;
    }
  }
  throw new DoorError(409, "door.idempotency_conflict", "The request is being processed by another call: retry in a moment.");
}

// ---------- ideas ----------

export type DoorIdea = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  tags: string[];
  externalRef: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

const IDEA_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  tags: true,
  externalRef: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.IdeaSelect;

function ideaOut(row: Prisma.IdeaGetPayload<{ select: typeof IDEA_SELECT }>): DoorIdea {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function doorCreateIdea(who: DoorPrincipal, clientKey: string, input: IdeaBody): Promise<DoorWrite> {
  const out = await idempotently(who, "idea.create", clientKey, input, async (tx) => {
    const idea: IdeaDTO = await createIdea(
      who.orgId,
      { userId: who.issuerId, orgId: who.orgId },
      { title: input.title, description: input.description ?? null },
      who.workspaceId,
      { client: tx, extra: { source: who.tokenName, externalRef: input.externalRef ?? null, tags: input.tags ?? [], apiTokenId: who.tokenId } },
    );
    await tx.auditLog.create({
      data: {
        action: "door.idea.created",
        actorId: who.issuerId,
        orgId: who.orgId,
        target: idea.id,
        workspaceId: who.workspaceId,
        meta: { tokenId: who.tokenId, via: "api-door", externalRef: input.externalRef ?? null, requestId: who.requestId },
      },
    });
    const row = await tx.idea.findUniqueOrThrow({ where: { id: idea.id }, select: IDEA_SELECT });
    return { status: 201, body: { data: ideaOut(row) }, resourceType: "idea", resourceId: idea.id };
  });
  if (!out.replayed) await afterCommit(() => dispatchEvent(who.orgId, "idea.created", { ideaId: (out.body as { data: DoorIdea }).data.id, title: input.title }));
  return out;
}

export async function doorListIdeas(who: DoorPrincipal, opts: { limit: number; cursor?: string }): Promise<{ data: DoorIdea[]; nextCursor: string | null }> {
  const rows = await db.idea.findMany({
    where: { orgId: who.orgId, apiTokenId: who.tokenId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: IDEA_SELECT,
  });
  const page = rows.slice(0, opts.limit);
  return { data: page.map(ideaOut), nextCursor: rows.length > opts.limit ? (page[page.length - 1]?.id ?? null) : null };
}

// ---------- tasks ----------

export type DoorTask = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  boardId: string;
  /** `open` or `done`: whether the task sits in a finished column. */
  status: "open" | "done";
  column: { id: string; name: string };
  priority: string;
  dueDate: string | null;
  /** When it was finished (it sits in a finished column), else null. */
  finishedAt: string | null;
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
};

const TASK_SELECT = {
  id: true,
  number: true,
  title: true,
  description: true,
  boardId: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  externalRef: true,
  createdAt: true,
  updatedAt: true,
  column: { select: { id: true, name: true, done: true } },
} satisfies Prisma.TaskSelect;

function taskOut(row: Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>): DoorTask {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    boardId: row.boardId,
    status: row.column.done || row.completedAt ? "done" : "open",
    column: { id: row.column.id, name: row.column.name },
    priority: row.priority,
    dueDate: row.dueDate?.toISOString() ?? null,
    finishedAt: row.completedAt?.toISOString() ?? null,
    externalRef: row.externalRef,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function doorCreateTask(who: DoorPrincipal, clientKey: string, input: TaskBody): Promise<DoorWrite> {
  const actor = { userId: who.issuerId, orgId: who.orgId };
  // the same door every way of making a task passes (src/server/services/tasks.ts `createTask`): the section grid's «يضيف ويعدّل»
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  const dueDate = input.dueDate ? (parseDayText(input.dueDate) ? dueInstantForDay(input.dueDate, await orgTimeZone(who.orgId)) : new Date(input.dueDate)) : null;

  const out = await idempotently(who, "task.create", clientKey, input, async (tx) => {
    // the board must be one of THE TOKEN'S space: the sender names the board, never the space
    const board = await tx.board.findFirst({
      where: { id: input.boardId, project: { workspaceId: who.workspaceId, workspace: { organizationId: who.orgId } } },
      select: { id: true, projectId: true },
    });
    if (!board) throw new DoorError(404, "door.board_not_found", "That board does not exist in the space this token writes to.");
    const made = await createTaskInTx(tx, actor, {
      workspaceId: who.workspaceId,
      projectId: board.projectId,
      boardId: board.id,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      dueDate,
      door: { apiTokenId: who.tokenId, externalRef: input.externalRef ?? null },
    });
    await tx.auditLog.create({
      data: {
        action: "door.task.created",
        actorId: who.issuerId,
        orgId: who.orgId,
        target: made.id,
        workspaceId: who.workspaceId,
        meta: { tokenId: who.tokenId, via: "api-door", externalRef: input.externalRef ?? null, requestId: who.requestId },
      },
    });
    const row = await tx.task.findUniqueOrThrow({ where: { id: made.id }, select: TASK_SELECT });
    return { status: 201, body: { data: taskOut(row) }, resourceType: "task", resourceId: made.id };
  });
  if (!out.replayed) {
    const task = (out.body as { data: DoorTask }).data;
    await afterCommit(() => dispatchEvent(who.orgId, "task.created", { taskId: task.id, number: task.number, title: task.title }));
  }
  return out;
}

/** A task THIS token made: any other task (another token's, a person's, another company's) is the same 404. */
export async function doorTaskStatus(who: DoorPrincipal, taskId: string): Promise<DoorTask> {
  const row = await db.task.findFirst({ where: { id: taskId, orgId: who.orgId, apiTokenId: who.tokenId }, select: TASK_SELECT });
  if (!row) throw new DoorError(404, "door.not_found", "Not found.");
  return taskOut(row);
}

export async function doorListTasks(who: DoorPrincipal, opts: { limit: number; cursor?: string }): Promise<{ data: DoorTask[]; nextCursor: string | null }> {
  const rows = await db.task.findMany({
    where: { orgId: who.orgId, apiTokenId: who.tokenId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: TASK_SELECT,
  });
  const page = rows.slice(0, opts.limit);
  return { data: page.map(taskOut), nextCursor: rows.length > opts.limit ? (page[page.length - 1]?.id ?? null) : null };
}

export type DoorBoard = { id: string; name: string; project: string };

/**
 * The boards a sender may name in `POST /api/v1/tasks`: the open boards of the token's space that the person it acts for sees
 * (a team's project only when they are in the team), so the sender can find a `boardId` without the owner copying ids by hand.
 * Names of work containers, never people.
 */
export async function doorListBoards(who: DoorPrincipal): Promise<DoorBoard[]> {
  const projects = await db.project.findMany({
    where: { workspaceId: who.workspaceId, systemKey: null },
    orderBy: { createdAt: "asc" },
    select: { name: true, teamId: true, workspaceId: true, boards: { where: { archived: false }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } } },
  });
  const out: DoorBoard[] = [];
  for (const p of projects) {
    if (p.boards.length === 0 || !(await userSeesProject(who.issuerId, p))) continue;
    for (const b of p.boards) out.push({ id: b.id, name: b.name, project: p.name });
  }
  return out;
}

/** A notification of the owner's own n8n after the commit: a failure there never undoes or fails what the sender asked for. */
async function afterCommit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.warn("door.after_commit_failed", { message: err instanceof Error ? err.message : String(err) });
  }
}
