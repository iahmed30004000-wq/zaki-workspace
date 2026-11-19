import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, requireWorkspace, ValidationError, type OrgAccessContext } from "@/server/auth";
import type { TaskVisibility } from "@/server/services/team-scope";
import { canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { createTask, type ActorContext } from "@/server/services/tasks";
import { createTicket } from "@/server/services/tickets";
import { inboxSpaceFor, inboxTarget } from "@/server/services/instant-work";
import type { TaskPriority } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { momentLink } from "@/lib/watch/convert";
import { WORK_INBOX_REF } from "@/lib/today";

/**
 * A CHAT MESSAGE BECOMES WORK (the owner's ask, 2026-10-25): «اعمل منها مهمة» / «اعمل منها تذكرة». The task or the
 * ticket is made through its own service (every rule of a task — the project's team, an active assignee — and of a
 * ticket applies the same), carries the message's text with a link back to it, and keeps the message it came from
 * (`sourceMessageId`), so the message shows what it became.
 *
 * Only a message one may read, never a deleted message or a system line, never by a guest.
 *
 * «صندوق المهام» (W1.2, switch `workInbox`): a task made with no project chosen — none given, or `WORK_INBOX_REF` — lands in the
 * space's inbox, in «للتنفيذ» (in «الشركة», which holds no project, in the person's first standard space: D-N3). That only changes WHERE the
 * task lands: the privacy of the source (P0.3) is decided before, exactly as for any project.
 */

export async function sourceOf(ctx: OrgAccessContext, messageId: string) {
  const msg = await db.chatMessage.findFirst({
    where: { id: messageId, orgId: ctx.orgId },
    select: { id: true, body: true, kind: true, deletedAt: true, conversationId: true, videoAtSec: true, mentions: true, authorId: true, attachments: { select: { kind: true } }, author: { select: { name: true } } },
  });
  if (!msg) throw new NotFoundError("chat.e.not_found");
  const [facts, org] = await Promise.all([loadConversationFacts(ctx.userId, msg.conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
  if (!facts || !canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (org?.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  if (msg.deletedAt || msg.kind === "SYSTEM") throw new ForbiddenError("chat.work_not_from_this");
  // a DM, a group, a restricted topic or a team's topic is somebody's private talk: what is made from it is private
  // unless the person says, and confirms, that it is for everybody (P0.3). The server decides; the dialog only explains.
  return { ...msg, privateSource: facts.kind !== "TOPIC" || facts.restricted || !!facts.teamId };
}

/** The rule above, in one place: private sources need an explicit, confirmed «للمساحة كلها». */
export function assertConfirmed(privateSource: boolean, wantsPublic: boolean, confirmPublic: boolean | undefined): void {
  if (privateSource && wantsPublic && confirmPublic !== true) {
    throw new ValidationError([{ path: "confirmPublic", message: "work.confirm_public_required" }]);
  }
}

/**
 * The message's text, then where it came from (a link that opens the conversation at it); a comment of a «نتفرّج سوا»
 * session also links to the same moment of its video.
 */
export async function describe(msg: { id: string; body: string; conversationId: string; videoAtSec: number | null; author: { name: string } }): Promise<string> {
  const from = interpolate(AR["chat.work.from"] ?? "{name}", { name: msg.author.name });
  const watch = msg.videoAtSec !== null ? await db.watchSession.findUnique({ where: { conversationId: msg.conversationId }, select: { id: true } }) : null;
  const moment = watch ? `\n🎬 ${momentLink(watch.id, msg.videoAtSec!)}` : "";
  return `${msg.body.trim()}\n\n${from}: /chat/${msg.conversationId}?m=${msg.id}${moment}`.slice(0, 4000);
}

/** A short title from the message: its first line, cut at a word. */
export function titleFrom(body: string, max = 120): string {
  const line = body.trim().split("\n")[0]!.trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

export async function messageToTask(
  ctx: OrgAccessContext,
  actor: ActorContext,
  messageId: string,
  input: {
    workspaceId: string;
    /** Absent (or `WORK_INBOX_REF`): the space's «صندوق المهام». */
    projectId?: string;
    boardId?: string;
    title?: string;
    assigneeId?: string | null;
    priority?: TaskPriority;
    /** «مين بيشوفها؟»: from a private conversation the default is «المعنيين بس»; SPACE needs `confirmPublic`. */
    visibility?: TaskVisibility;
    confirmPublic?: boolean;
  },
): Promise<{ taskId: string }> {
  const msg = await sourceOf(ctx, messageId);
  assertConfirmed(msg.privateSource, input.visibility === "SPACE", input.confirmPublic);
  const visibility: TaskVisibility | undefined = msg.privateSource ? (input.visibility ?? "PARTICIPANTS") : input.visibility;
  let owner = actor;
  let where: { workspaceId: string; projectId: string; boardId: string; columnId?: string } = { workspaceId: input.workspaceId, projectId: input.projectId ?? "", boardId: input.boardId ?? "" };
  if (!input.projectId || input.projectId === WORK_INBOX_REF) {
    const space = await inboxSpaceFor({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole }, input.workspaceId);
    if (!space) throw new ForbiddenError("instant.no_space");
    // «الشركة» holds no project: the inbox is the first standard space's, and the person's rights are checked there
    if (space.id !== input.workspaceId) owner = await requireWorkspace(space.id, ["ADMIN", "MEMBER"]);
    const target = await inboxTarget(ctx, space.id);
    // «للتنفيذ», not the backlog
    where = { workspaceId: space.id, projectId: target.projectId, boardId: target.boardId, columnId: target.columnId };
  }
  const task = await createTask(owner, {
    ...(visibility ? { visibility } : {}),
    ...where,
    title: (input.title?.trim() || titleFrom(msg.body)).slice(0, 280),
    description: await describe(msg),
    priority: input.priority,
    assigneeId: input.assigneeId ?? null,
  });
  await db.task.update({ where: { id: task.id }, data: { sourceMessageId: msg.id } });
  return { taskId: task.id };
}

export async function messageToTicket(
  ctx: OrgAccessContext,
  messageId: string,
  input: { departmentId: string; title?: string; priority?: "URGENT" | "HIGH" | "NORMAL" | "LOW"; confirmPublic?: boolean },
): Promise<{ ticketId: string }> {
  const msg = await sourceOf(ctx, messageId);
  // a ticket is read by its department: from a private conversation that is «for others» and must be confirmed
  assertConfirmed(msg.privateSource, true, input.confirmPublic);
  const title = (input.title?.trim() || titleFrom(msg.body, 190)).slice(0, 200);
  const ticket = await createTicket(ctx, input.departmentId, {
    title: title.length >= 3 ? title : `${title}…`.padEnd(3, "…"),
    description: await describe(msg),
    priority: input.priority ?? "NORMAL",
  });
  await db.ticket.update({ where: { id: ticket.id }, data: { sourceMessageId: msg.id } });
  return { ticketId: ticket.id };
}
