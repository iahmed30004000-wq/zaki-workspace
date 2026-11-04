import { db } from "@/server/db";
import { log } from "@/server/log";
import { FixedWindowLimiter } from "@/server/rate-limit";
import type { Actor } from "@/server/policy/actor";
import { canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { snippetOf } from "@/server/chat/search";
import type { MessageHitDto } from "@/server/chat/dto";
import { conversationHasGuest } from "@/server/services/chat-assistant";
import { isFeatureOn } from "@/server/services/features";
import { spaceHasGuest } from "@/server/services/search-embed-index";
import { embedServer, embedTexts, queryText, rankBySimilarity } from "@/server/services/search-embeddings";
import { taskVisibleWhere, type WorkScope } from "@/server/services/team-scope";

/**
 * «بحث بالمعنى» — THE QUESTION. A search for «علب التغليف» also finds «الكراتين», marked as «بمعنى قريب» and always AFTER the hits the words found.
 *
 * Who sees what is NOT decided here by the vectors. The order of steps is the rule:
 *   1. the candidate set is cut by SQL to what the person's place allows (their organisation, the tasks of the spaces they may open, the
 *      messages of the topics of the space they are in) and to at most `MAX_CANDIDATES` vectors, never a scan of everything;
 *   2. cosine ranks those candidates in memory (src/server/services/search-embeddings.ts); a vector never leaves the server;
 *   3. only the best few ids go back to the SAME access rules the word search uses (`taskVisibleWhere`, `canRead`, and again «no guest
 *      reaches it»), and the row is read from the database as it is NOW: a deleted message, an archived task or a topic the person cannot open
 *      is dropped there, whatever its vector said. The owner's silent oversight is exactly what `canRead` says, no more.
 * A guest or a partner never asks the service (nothing of theirs is sent) and gets the word search only.
 *
 * Everything here fails quietly into «the word search alone»: the switch off, no service, a down service, a slow one, a flood of questions.
 */

export const MAX_CANDIDATES = 5000;
/** The ranked ids that go back through the access rules, and how many of each kind survive. */
const POOL = 40;
export const SEMANTIC_TASKS = 5;
export const SEMANTIC_MESSAGES = 5;

/** A question is sent to the service at most this often per person (the box asks on every few letters). */
const askLimiter = new FixedWindowLimiter({ limit: 40, windowMs: 60_000 });
export function resetSemanticLimiterForTests(userId: string): void {
  askLimiter.reset(`semantic.${userId}`);
}

export interface SemanticTaskHit {
  id: string;
  number: number;
  title: string;
  priority: string;
  organization: { keyPrefix: string };
  project: { id: string; name: string };
}

export interface SemanticInput {
  actor: Actor;
  /** The text typed. */
  q: string;
  /** The space the person is in (messages are searched only there), or null. */
  place: { spaceId: string; isHq: boolean } | null;
  /** The work scope of the person narrowed to that space, and the spaces whose tasks they may search. */
  scope: WorkScope;
  taskSpaces: string[];
}

/** The same question again within a few minutes costs no second call. */
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 200;
const queryCache = new Map<string, { at: number; vector: number[] }>();

async function questionVector(orgId: string, model: string, text: string, run: () => Promise<number[]>): Promise<number[]> {
  const key = `${orgId}|${model}|${text}`;
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.vector;
  const vector = await run();
  if (queryCache.size >= CACHE_MAX) queryCache.delete(queryCache.keys().next().value as string);
  queryCache.set(key, { at: Date.now(), vector });
  return vector;
}
export function clearQuestionCacheForTests(): void {
  queryCache.clear();
}

const NONE = { tasks: [] as SemanticTaskHit[], messages: [] as MessageHitDto[] };

/** The hits by meaning for this person, or nothing. Never throws. */
export async function semanticHits(input: SemanticInput): Promise<{ tasks: SemanticTaskHit[]; messages: MessageHitDto[] }> {
  try {
    return await run(input);
  } catch (err) {
    log.warn("search.semantic_failed", { reason: err instanceof Error ? err.name : "unknown" });
    return NONE;
  }
}

async function run({ actor, q, place, scope, taskSpaces }: SemanticInput): Promise<{ tasks: SemanticTaskHit[]; messages: MessageHitDto[] }> {
  if (actor.isExternal) return NONE;
  const server = embedServer();
  if (!server) return NONE;
  if (!(await isFeatureOn(actor.orgId, "semanticSearch"))) return NONE;
  const text = queryText(q);
  if (text === null) return NONE;
  // a person who is a guest in any space, even one the company ranks higher, is never near the service
  if ((await db.workspaceMember.count({ where: { userId: actor.userId, role: "GUEST" } })) > 0) return NONE;
  if (!askLimiter.check(`semantic.${actor.userId}`).ok) return NONE;
  askLimiter.hit(`semantic.${actor.userId}`);

  const vector = await questionVector(actor.orgId, server.model, text, async () => {
    const [v] = await embedTexts(server, [text], { purpose: "query" });
    if (!v) throw new Error("no vector");
    return v;
  });

  const half = Math.floor(MAX_CANDIDATES / 2);
  const [taskRows, messageRows] = await Promise.all([
    taskSpaces.length === 0
      ? []
      : db.searchEmbedding.findMany({
          where: { orgId: actor.orgId, kind: "task", model: server.model, workspaceId: { in: taskSpaces } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: half,
          select: { refId: true, vector: true },
        }),
    !place
      ? []
      : db.searchEmbedding.findMany({
          where: { orgId: actor.orgId, kind: "message", model: server.model, conversation: { orgId: actor.orgId, spaceId: place.spaceId } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: half,
          select: { refId: true, vector: true },
        }),
  ]);
  const options = { minScore: server.minScore, limit: POOL };
  const taskRank = rankBySimilarity(vector, taskRows.map((r) => ({ id: r.refId, vector: r.vector })), options);
  const messageRank = rankBySimilarity(vector, messageRows.map((r) => ({ id: r.refId, vector: r.vector })), options);

  const [tasks, messages] = await Promise.all([
    verifiedTasks(actor, scope, taskSpaces, taskRank.map((r) => r.id)),
    place ? verifiedMessages(actor, place, q, messageRank.map((r) => r.id)) : [],
  ]);
  return { tasks, messages };
}

/** The ranked task ids, back through the word search's own rules, in rank order. */
async function verifiedTasks(actor: Actor, scope: WorkScope, taskSpaces: string[], ids: string[]): Promise<SemanticTaskHit[]> {
  if (ids.length === 0 || taskSpaces.length === 0) return [];
  const rows = await db.task.findMany({
    where: { orgId: actor.orgId, workspaceId: { in: taskSpaces }, AND: [taskVisibleWhere(scope)], archived: false, id: { in: ids } },
    select: { id: true, number: true, title: true, priority: true, workspaceId: true, organization: { select: { keyPrefix: true } }, project: { select: { id: true, name: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const guest = new Map<string, boolean>();
  const out: SemanticTaskHit[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) continue;
    let has = guest.get(t.workspaceId);
    if (has === undefined) {
      has = await spaceHasGuest(t.workspaceId, actor.orgId);
      guest.set(t.workspaceId, has);
    }
    if (has) continue;
    const { workspaceId: _space, ...hit } = t;
    out.push(hit);
    if (out.length >= SEMANTIC_TASKS) break;
  }
  return out;
}

/** The ranked message ids of the space, each only if the person can open its topic (the word search's rule) and no guest can reach it. */
async function verifiedMessages(actor: Actor, place: { spaceId: string }, q: string, ids: string[]): Promise<MessageHitDto[]> {
  if (ids.length === 0) return [];
  const rows = await db.chatMessage.findMany({
    where: { orgId: actor.orgId, id: { in: ids }, deletedAt: null, kind: "TEXT", conversation: { orgId: actor.orgId, kind: "TOPIC", dmKey: null, spaceId: place.spaceId } },
    select: { id: true, body: true, createdAt: true, conversationId: true, author: { select: { name: true } }, conversation: { select: { title: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const org = await loadOrgFacts(actor.userId, actor.orgId);
  const open = new Map<string, boolean>();
  const out: MessageHitDto[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) continue;
    let ok = open.get(m.conversationId);
    if (ok === undefined) {
      const facts = await loadConversationFacts(actor.userId, m.conversationId);
      ok = !!facts && canRead(facts, org) && !(await conversationHasGuest(facts, m.conversationId, actor.orgId));
      open.set(m.conversationId, ok);
    }
    if (!ok) continue;
    out.push({ id: m.id, conversationId: m.conversationId, conversationTitle: m.conversation.title ?? "", authorName: m.author.name, at: m.createdAt.toISOString(), snippet: snippetOf(m.body, q, 90), semantic: true });
    if (out.length >= SEMANTIC_MESSAGES) break;
  }
  return out;
}
