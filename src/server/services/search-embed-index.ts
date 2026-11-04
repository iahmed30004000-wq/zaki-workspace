import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { featureOn } from "@/lib/features";
import { conversationHasGuest } from "@/server/services/chat-assistant";
import { isFeatureOn } from "@/server/services/features";
import { embedServer, embedTexts, messageText, taskText, textHash, EmbedError, MIN_MESSAGE_CHARS, type EmbedServer } from "@/server/services/search-embeddings";

/**
 * «بحث بالمعنى» — WHAT GETS A VECTOR, and when.
 *
 * What may be indexed follows what the chat assistant may read (src/server/services/chat-assistant.ts), never more:
 *   a message   a text line of a TOPIC (never a direct chat, a group or the assistant's own conversation), not deleted, not a system
 *               line, a voice note or a poll, at least 12 characters, in a conversation that NO guest can reach (`conversationHasGuest`:
 *               a doubt is a skip).
 *   a task      not archived, in a space with no guest in it (a space guest, or a person the company ranks as a guest).
 * The text that leaves is filtered and cut (search-embeddings.ts); only its hash is kept here, with the vector.
 *
 * WHEN  a message or task is created or edited (`queueSync`: after the commit, never awaited, never throws, so the sender never waits and
 *       a down service never fails a send) — and a gradual backfill by the job runner (`runSearchEmbedBackfill`: the newest 2000 items of
 *       each company, a small batch per tick, newest first). Both go through `syncItems`, which is idempotent: an item whose text has not
 *       changed is not sent again, an item that stopped being indexable (deleted, shortened, a guest arrived) loses its vector.
 * NEVER while the switch `semanticSearch` is off or no service is set up: nothing is sent, nothing is written, no query is made.
 */

/** The window of items the backfill keeps indexed per company: the newest messages and the newest tasks, 2000 in all. */
export const BACKFILL_MESSAGES = 1500;
export const BACKFILL_TASKS = 500;
/** Items embedded per company per tick of the job runner (every 30 seconds). */
export const BACKFILL_BATCH = 32;
/** The conversations and spaces looked at per company when the eligible ones are listed. */
const ELIGIBLE_CONVERSATIONS = 400;
const ELIGIBLE_SPACES = 200;
const ELIGIBLE_TTL_MS = 10 * 60_000;
/** A company with nothing left to index is looked at again after this long. */
const IDLE_MS = 5 * 60_000;

export type ItemKind = "message" | "task";

export interface SyncResult {
  embedded: number;
  removed: number;
  /** Already indexed with the same text and model, or not indexable and with no vector to remove. */
  skipped: number;
  failed: number;
}

const emptyResult = (): SyncResult => ({ embedded: 0, removed: 0, skipped: 0, failed: 0 });

// ───────────────────────────────────────── who may be near a model ─────────────────────────────────────────

/** Does a guest sit in this space: a row of the space as «ضيف», or a member the company ranks as a guest? */
export async function spaceHasGuest(workspaceId: string, orgId: string): Promise<boolean> {
  const rows = await db.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, role: true } });
  if (rows.some((r) => r.role === "GUEST")) return true;
  if (rows.length === 0) return false;
  const guests = await db.organizationMember.count({ where: { organizationId: orgId, userId: { in: rows.map((r) => r.userId) }, role: "GUEST", status: "ACTIVE" } });
  return guests > 0;
}

/** A topic that is not a guest's to reach, judged by the chat assistant's own function. */
async function topicIndexable(conv: { kind: string; spaceId: string | null; restricted: boolean; dmKey: string | null; orgId: string }, conversationId: string, orgId: string): Promise<boolean> {
  if (conv.orgId !== orgId || conv.kind !== "TOPIC" || conv.dmKey !== null) return false;
  return !(await conversationHasGuest({ kind: "TOPIC", spaceId: conv.spaceId, restricted: conv.restricted }, conversationId, orgId));
}

// ───────────────────────────────────────── syncing a few items ─────────────────────────────────────────

interface Pending {
  id: string;
  text: string;
  hash: string;
  conversationId: string | null;
  workspaceId: string | null;
}

async function removeRows(kind: ItemKind, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return (await db.searchEmbedding.deleteMany({ where: { kind, refId: { in: ids } } })).count;
}

/**
 * Makes the vectors of these items match the items: embeds what is indexable and changed, drops the vector of what is not indexable any more.
 * The switch is read here (a caller may have held the answer for a while). Never throws for a service that is down: it counts the failure.
 */
export async function syncItems(orgId: string, kind: ItemKind, ids: readonly string[], options: { server?: EmbedServer | null } = {}): Promise<SyncResult> {
  const result = emptyResult();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;
  const server = options.server === undefined ? embedServer() : options.server;
  if (!server || !(await isFeatureOn(orgId, "semanticSearch"))) return result;

  const existing = new Map(
    (await db.searchEmbedding.findMany({ where: { kind, refId: { in: unique }, orgId }, select: { refId: true, textHash: true, model: true } })).map((r) => [r.refId, r]),
  );
  const okOf = new Map<string, boolean>();
  const pending: Pending[] = [];
  const drop: string[] = [];

  if (kind === "message") {
    const rows = await db.chatMessage.findMany({
      where: { id: { in: unique }, orgId },
      select: {
        id: true,
        body: true,
        kind: true,
        deletedAt: true,
        conversationId: true,
        conversation: { select: { orgId: true, kind: true, spaceId: true, restricted: true, dmKey: true } },
      },
    });
    const found = new Set(rows.map((r) => r.id));
    drop.push(...unique.filter((id) => !found.has(id)));
    for (const m of rows) {
      let text: string | null = null;
      if (m.kind === "TEXT" && !m.deletedAt && m.body.trim().length >= MIN_MESSAGE_CHARS) {
        let ok = okOf.get(m.conversationId);
        if (ok === undefined) {
          ok = await topicIndexable(m.conversation, m.conversationId, orgId);
          okOf.set(m.conversationId, ok);
        }
        if (ok) text = messageText(m.body);
      }
      if (text === null) {
        drop.push(m.id);
        continue;
      }
      pending.push({ id: m.id, text, hash: textHash(text, server.model), conversationId: m.conversationId, workspaceId: null });
    }
  } else {
    const rows = await db.task.findMany({ where: { id: { in: unique }, orgId }, select: { id: true, title: true, description: true, archived: true, workspaceId: true } });
    const found = new Set(rows.map((r) => r.id));
    drop.push(...unique.filter((id) => !found.has(id)));
    for (const t of rows) {
      let text: string | null = null;
      if (!t.archived) {
        let ok = okOf.get(t.workspaceId);
        if (ok === undefined) {
          ok = !(await spaceHasGuest(t.workspaceId, orgId));
          okOf.set(t.workspaceId, ok);
        }
        if (ok) text = taskText(t.title, t.description);
      }
      if (text === null) {
        drop.push(t.id);
        continue;
      }
      pending.push({ id: t.id, text, hash: textHash(text, server.model), conversationId: null, workspaceId: t.workspaceId });
    }
  }

  result.removed = await removeRows(kind, drop);
  result.skipped += drop.length - result.removed;

  const changed = pending.filter((p) => {
    const row = existing.get(p.id);
    const same = row !== undefined && row.textHash === p.hash && row.model === server.model;
    if (same) result.skipped += 1;
    return !same;
  });
  if (changed.length === 0) return result;

  let vectors: number[][];
  try {
    vectors = await embedTexts(server, changed.map((p) => p.text), { purpose: "index" });
  } catch (err) {
    // names and counts only: never the text, the address or the service's answer
    log.warn("search.embed_failed", { kind, count: changed.length, reason: err instanceof EmbedError ? err.key : "unknown" });
    result.failed = changed.length;
    return result;
  }
  for (const [i, p] of changed.entries()) {
    const data = { orgId, kind, refId: p.id, conversationId: p.conversationId, workspaceId: p.workspaceId, vector: vectors[i] as number[], model: server.model, textHash: p.hash, createdAt: new Date() };
    try {
      await db.searchEmbedding.upsert({ where: { kind_refId: { kind, refId: p.id } }, create: data, update: data });
      result.embedded += 1;
    } catch (err) {
      // the conversation or the space went away while the service was thinking: its vectors went with it
      log.warn("search.embed_store_failed", { kind, reason: err instanceof Error ? err.name : "unknown" });
      result.failed += 1;
    }
  }
  return result;
}

// ───────────────────────────────────────── the hook: after a message or a task is written ─────────────────────────────────────────

const inFlight = new Set<Promise<unknown>>();

/**
 * After the commit of a message or task (created, edited, deleted): bring its vector up to date in the background. Costs nothing when the
 * company has no service (one environment read), never waits for the service, never throws.
 */
export function queueSync(orgId: string, kind: ItemKind, id: string): void {
  if (embedServer() === null) return;
  const run = syncItems(orgId, kind, [id])
    .catch((err: unknown) => log.warn("search.sync_failed", { kind, reason: err instanceof Error ? err.name : "unknown" }))
    .finally(() => inFlight.delete(run));
  inFlight.add(run);
}

/** Tests: waits until the background syncs started so far have finished. */
export async function settleSyncsForTests(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

// ───────────────────────────────────────── the backfill ─────────────────────────────────────────

interface Eligible {
  at: number;
  conversations: string[];
  spaces: string[];
}
const eligibleCache = new Map<string, Eligible>();
const idleUntil = new Map<string, number>();

export function clearBackfillStateForTests(): void {
  eligibleCache.clear();
  idleUntil.clear();
}

/** The company's topics no guest can reach and spaces with no guest in them (kept ten minutes: the guest check is several queries each). */
async function eligibleOf(orgId: string, now: number): Promise<Eligible> {
  const cached = eligibleCache.get(orgId);
  if (cached && now - cached.at < ELIGIBLE_TTL_MS) return cached;
  const topics = await db.conversation.findMany({
    where: { orgId, kind: "TOPIC", dmKey: null },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: ELIGIBLE_CONVERSATIONS,
    select: { id: true, orgId: true, kind: true, spaceId: true, restricted: true, dmKey: true },
  });
  const conversations: string[] = [];
  for (const t of topics) if (await topicIndexable(t, t.id, orgId)) conversations.push(t.id);
  const spaceRows = await db.workspace.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: ELIGIBLE_SPACES, select: { id: true } });
  const spaces: string[] = [];
  for (const s of spaceRows) if (!(await spaceHasGuest(s.id, orgId))) spaces.push(s.id);
  const fresh = { at: now, conversations, spaces };
  eligibleCache.set(orgId, fresh);
  return fresh;
}

/** Ids of the newest messages (inside the window) with no vector of this model yet, newest first. */
async function missingMessages(orgId: string, conversations: string[], model: string, limit: number): Promise<string[]> {
  if (conversations.length === 0) return [];
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT m."id" FROM "ChatMessage" m
    WHERE m."id" IN (
      SELECT w."id" FROM "ChatMessage" w
      WHERE w."orgId" = ${orgId} AND w."conversationId" IN (${Prisma.join(conversations)})
        AND w."kind" = 'TEXT' AND w."deletedAt" IS NULL AND length(btrim(w."body")) >= ${MIN_MESSAGE_CHARS}
      ORDER BY w."createdAt" DESC, w."id" DESC LIMIT ${BACKFILL_MESSAGES})
    AND NOT EXISTS (SELECT 1 FROM "SearchEmbedding" e WHERE e."kind" = 'message' AND e."refId" = m."id" AND e."model" = ${model})
    ORDER BY m."createdAt" DESC, m."id" DESC LIMIT ${limit}`);
  return rows.map((r) => r.id);
}

async function missingTasks(orgId: string, spaces: string[], model: string, limit: number): Promise<string[]> {
  if (spaces.length === 0) return [];
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT t."id" FROM "Task" t
    WHERE t."id" IN (
      SELECT w."id" FROM "Task" w
      WHERE w."orgId" = ${orgId} AND w."workspaceId" IN (${Prisma.join(spaces)}) AND w."archived" = FALSE
      ORDER BY w."createdAt" DESC, w."id" DESC LIMIT ${BACKFILL_TASKS})
    AND NOT EXISTS (SELECT 1 FROM "SearchEmbedding" e WHERE e."kind" = 'task' AND e."refId" = t."id" AND e."model" = ${model})
    ORDER BY t."createdAt" DESC, t."id" DESC LIMIT ${limit}`);
  return rows.map((r) => r.id);
}

export interface BackfillRun {
  companies: number;
  embedded: number;
  failed: number;
}

/**
 * One tick for one company: up to `BACKFILL_BATCH` of the newest items with no vector yet. Idempotent: a second run over the same items finds
 * nothing missing and sends nothing. A company with nothing left is left alone for five minutes.
 */
export async function backfillOrg(orgId: string, nowMs: number = Date.now(), server: EmbedServer | null = embedServer()): Promise<{ embedded: number; failed: number }> {
  if (!server) return { embedded: 0, failed: 0 };
  if ((idleUntil.get(orgId) ?? 0) > nowMs) return { embedded: 0, failed: 0 };
  const eligible = await eligibleOf(orgId, nowMs);
  const messageIds = await missingMessages(orgId, eligible.conversations, server.model, BACKFILL_BATCH);
  const taskIds = await missingTasks(orgId, eligible.spaces, server.model, Math.max(0, BACKFILL_BATCH - messageIds.length));
  if (messageIds.length + taskIds.length === 0) {
    idleUntil.set(orgId, nowMs + IDLE_MS);
    return { embedded: 0, failed: 0 };
  }
  const a = await syncItems(orgId, "message", messageIds, { server });
  const b = await syncItems(orgId, "task", taskIds, { server });
  // a service that is down is not hammered every 30 seconds
  if (a.failed + b.failed > 0 && a.embedded + b.embedded === 0) idleUntil.set(orgId, nowMs + IDLE_MS);
  return { embedded: a.embedded + b.embedded, failed: a.failed + b.failed };
}

/** The job: every company that turned «بحث بالمعنى» on gets one batch. Does nothing at all (no query) while no service is set up. */
export async function runSearchEmbedBackfill(now: Date = new Date()): Promise<BackfillRun | null> {
  const server = embedServer();
  if (!server) return null;
  const orgs = await db.organization.findMany({ select: { id: true, settings: true } });
  const run: BackfillRun = { companies: 0, embedded: 0, failed: 0 };
  for (const org of orgs) {
    if (!featureOn(org.settings, "semanticSearch")) continue;
    const done = await backfillOrg(org.id, now.getTime(), server);
    run.companies += 1;
    run.embedded += done.embedded;
    run.failed += done.failed;
  }
  return run;
}
