import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { canReadConversation } from "@/server/policy/conversation";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { loadInternal } from "@/server/services/card-guards";
import { CARD_AUDIT_PREFIX } from "@/server/services/card-audit";
import type { LinkedTask, LinkedTopic, LinksView } from "@/lib/cards/page";

/**
 * What the card was turned into: the tasks made from it («حوّلها لمهمة») and the topic it was sent to («أرسل»). Both are
 * remembered as lines of the audit log, and each is shown only to a viewer who may open it: a task outside the viewer's
 * scope and a topic they may not read are simply not in the list.
 */

const LINK_LIMIT = 100;

export async function listLinks(actor: Actor, cardId: string): Promise<LinksView> {
  const { row } = await loadInternal(actor, cardId);
  const rows = await db.auditLog.findMany({
    where: { orgId: actor.orgId, target: row.id, action: { in: [`${CARD_AUDIT_PREFIX}task`, `${CARD_AUDIT_PREFIX}sent`] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LINK_LIMIT,
    select: { action: true, meta: true },
  });
  const taskIds: string[] = [];
  const sent: Array<{ conversationId: string; messageId: string | null }> = [];
  for (const r of rows) {
    const m = typeof r.meta === "object" && r.meta !== null ? (r.meta as Record<string, unknown>) : {};
    if (r.action.endsWith("task") && typeof m["taskId"] === "string") taskIds.push(m["taskId"]);
    if (r.action.endsWith("sent") && typeof m["conversationId"] === "string") {
      sent.push({ conversationId: m["conversationId"], messageId: typeof m["messageId"] === "string" ? m["messageId"] : null });
    }
  }

  // W1.6: the link is stored on the task (`Task.sourceCardId`). A task made before the column existed (or by the card's own «حوّلها لمهمة», which still writes
  // the log line) is found by the log and has its column filled here, so the next reader needs no log. A task of another company is never touched.
  if (taskIds.length) {
    await db.task.updateMany({ where: { id: { in: taskIds }, orgId: actor.orgId, sourceCardId: null }, data: { sourceCardId: row.id } });
  }
  let tasks: LinkedTask[] = [];
  {
    const scope = await loadWorkScope(actor.userId);
    const stored = await db.task.findMany({
      where: { orgId: actor.orgId, sourceCardId: row.id, id: { notIn: taskIds }, AND: [taskVisibleWhere(scope)] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LINK_LIMIT,
      select: { id: true },
    });
    taskIds.push(...stored.map((t) => t.id));
  }
  if (taskIds.length) {
    const scope = await loadWorkScope(actor.userId);
    const found = await db.task.findMany({
      where: { id: { in: taskIds }, orgId: actor.orgId, AND: [taskVisibleWhere(scope)] },
      select: { id: true, title: true, number: true, organization: { select: { keyPrefix: true } } },
    });
    const byId = new Map(found.map((t) => [t.id, t]));
    tasks = taskIds.flatMap((id) => {
      const t = byId.get(id);
      return t ? [{ id: t.id, title: t.title, key: `${t.organization.keyPrefix}-${t.number}` }] : [];
    });
  }

  const topics: LinkedTopic[] = [];
  const seen = new Set<string>();
  for (const s of sent) {
    const key = `${s.conversationId}:${s.messageId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!(await canReadConversation(actor.userId, s.conversationId))) continue;
    const topic = await db.conversation.findFirst({ where: { id: s.conversationId, orgId: actor.orgId }, select: { title: true, emoji: true } });
    if (!topic) continue;
    // a message that is gone is not linked to (the topic still is)
    const message = s.messageId ? await db.chatMessage.findFirst({ where: { id: s.messageId, conversationId: s.conversationId, deletedAt: null }, select: { id: true } }) : null;
    topics.push({ conversationId: s.conversationId, messageId: message?.id ?? null, title: topic.title ?? "", emoji: topic.emoji });
  }
  return { tasks, topics };
}

/**
 * The card a task was made from, as `actor` may read it: named when they may open the card (its internal page), else only «hidden». Null when the task came
 * from no card. The stored column first; a task made before it existed is found by the card's own log line.
 */
export async function cardSourceOf(
  actor: Actor,
  taskId: string,
  sourceCardId: string | null,
): Promise<{ kind: "card"; state: "visible"; id: string; title: string; href: string } | { kind: "card"; state: "hidden" } | null> {
  let cardId = sourceCardId;
  if (!cardId) {
    const line = await db.auditLog.findFirst({
      where: { orgId: actor.orgId, action: `${CARD_AUDIT_PREFIX}task`, meta: { path: ["taskId"], equals: taskId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { target: true },
    });
    cardId = line?.target ?? null;
  }
  if (!cardId) return null;
  try {
    const { row } = await loadInternal(actor, cardId);
    return { kind: "card", state: "visible", id: row.id, title: row.title, href: `/cards/${row.id}` };
  } catch {
    return { kind: "card", state: "hidden" };
  }
}
