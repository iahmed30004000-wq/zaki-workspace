import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { assertFeatureOn } from "@/server/services/features";
import { loadWorkScope, projectVisibleWhere, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";

/**
 * «نتفرّج سوا» — «حوّل»: THE COMMENT REMEMBERS WHAT IT BECAME (the owner's plan: a comment of a session becomes a task, an
 * idea or a project, and still shows it).
 *
 * The idea, the task and the project are made by their own doors (their rules, notifications and log); this file only
 *  - lets a door tie what it makes to a comment (`assertWatchComment`: the comment is of a session the person may read), and
 *  - tells a session's screen which comments became what (`conversionsOf`), showing only what that person may see.
 *
 * A task keeps `Task.sourceMessageId` (the «اعمل منها مهمة» column); an idea and a project have the same column
 * (migration 20261111100000_watch_convert_links).
 */

export type ConversionKind = "task" | "idea" | "project";
export interface Conversion {
  kind: ConversionKind;
  id: string;
}

/**
 * The comment a door may tie a new idea or project to: of a watch session's talk, readable by the person (the owner
 * silently, like everything), never a deleted or system line, never by a guest, and only while «حوّل» is on.
 */
export async function assertWatchComment(ctx: OrgAccessContext, messageId: string): Promise<{ id: string }> {
  await assertFeatureOn(ctx.orgId, "watchConvert");
  const msg = await db.chatMessage.findFirst({
    where: { id: messageId, orgId: ctx.orgId },
    select: { id: true, kind: true, deletedAt: true, conversationId: true },
  });
  if (!msg) throw new NotFoundError("chat.e.not_found");
  const [facts, org] = await Promise.all([loadConversationFacts(ctx.userId, msg.conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
  if (!facts || !canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (org?.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  if (msg.deletedAt || msg.kind === "SYSTEM") throw new ForbiddenError("chat.work_not_from_this");
  const session = await db.watchSession.findFirst({ where: { conversationId: msg.conversationId, orgId: ctx.orgId }, select: { id: true } });
  if (!session) throw new ForbiddenError("chat.work_not_from_this");
  return { id: msg.id };
}

/**
 * Which comments of a session became tasks, ideas or projects, as the person may see them: a task or a project of a
 * place (or a team) they are not in is not listed, and an idea only when it is of one of their spaces. Nothing is
 * listed while «حوّل» is off. The caller already passed the session's own guard (`watchDetail`).
 */
export async function conversionsOf(ctx: OrgAccessContext, conversationId: string): Promise<Record<string, Conversion[]>> {
  const out: Record<string, Conversion[]> = {};
  try {
    await assertFeatureOn(ctx.orgId, "watchConvert");
  } catch {
    return out;
  }
  const messages = await db.chatMessage.findMany({ where: { conversationId, videoAtSec: { not: null } }, select: { id: true }, take: 500, orderBy: { createdAt: "desc" } });
  if (!messages.length) return out;
  const ids = messages.map((m) => m.id);
  const scope = await loadWorkScope(ctx.userId);
  const spaces = scopeSpaceIds(scope);
  const [tasks, ideas, projects] = await Promise.all([
    db.task.findMany({ where: { sourceMessageId: { in: ids }, archived: false, AND: [taskVisibleWhere(scope)] }, select: { id: true, sourceMessageId: true }, orderBy: { createdAt: "asc" } }),
    db.idea.findMany({ where: { sourceMessageId: { in: ids }, orgId: ctx.orgId, workspaceId: { in: spaces } }, select: { id: true, sourceMessageId: true }, orderBy: { createdAt: "asc" } }),
    db.project.findMany({ where: { sourceMessageId: { in: ids }, AND: [projectVisibleWhere(scope)] }, select: { id: true, sourceMessageId: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const put = (kind: ConversionKind, rows: { id: string; sourceMessageId: string | null }[]) => {
    for (const r of rows) if (r.sourceMessageId) (out[r.sourceMessageId] ??= []).push({ kind, id: r.id });
  };
  put("task", tasks);
  put("idea", ideas);
  put("project", projects);
  return out;
}
