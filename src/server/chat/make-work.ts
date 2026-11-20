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
import { assertFeatureOn } from "@/server/services/features";
import { resolveTimeZone, zonedParts } from "@/lib/zoned-time";

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

/** C3b.5: what a task made from a selection loads once for many messages — the person's facts in the company, and each conversation's facts. */
export interface SourceFacts {
  org?: Awaited<ReturnType<typeof loadOrgFacts>>;
  conversations: Map<string, Awaited<ReturnType<typeof loadConversationFacts>>>;
}

export async function sourceOf(ctx: OrgAccessContext, messageId: string, held?: SourceFacts) {
  const msg = await db.chatMessage.findFirst({
    where: { id: messageId, orgId: ctx.orgId },
    select: { id: true, body: true, kind: true, createdAt: true, deletedAt: true, conversationId: true, videoAtSec: true, mentions: true, authorId: true, attachments: { select: { kind: true } }, author: { select: { name: true } } },
  });
  if (!msg) throw new NotFoundError("chat.e.not_found");
  const [facts, org] = held
    ? [
        held.conversations.has(msg.conversationId) ? held.conversations.get(msg.conversationId)! : await loadConversationFacts(ctx.userId, msg.conversationId),
        held.org !== undefined ? held.org : await loadOrgFacts(ctx.userId, ctx.orgId),
      ]
    : await Promise.all([loadConversationFacts(ctx.userId, msg.conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
  if (held) {
    held.conversations.set(msg.conversationId, facts);
    held.org = org;
  }
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
  return `${msg.body.trim()}${await linkBack(msg)}`.slice(0, 4000);
}

/** The line that leads back to the message (and to the same moment of a watching session's video): always the END of a description. */
async function linkBack(msg: { id: string; conversationId: string; videoAtSec: number | null; author: { name: string } }): Promise<string> {
  const from = interpolate(AR["chat.work.from"] ?? "{name}", { name: msg.author.name });
  const watch = msg.videoAtSec !== null ? await db.watchSession.findUnique({ where: { conversationId: msg.conversationId }, select: { id: true } }) : null;
  const moment = watch ? `\n🎬 ${momentLink(watch.id, msg.videoAtSec!)}` : "";
  return `\n\n${from}: /chat/${msg.conversationId}?m=${msg.id}${moment}`;
}

/** The most messages one task can be made from (the screen's selection cap). */
export const SELECTION_TASK_MAX = 100;
const DESCRIPTION_MAX = 4000;

/**
 * C3b.5 — the description of ONE task made from a selection: each message quoted with its author and time (the company's time zone, Western digits), in the
 * conversation's order, then the link back to the FIRST message. A message too long for the room left is cut with «…» and the quotes after it are dropped; the
 * link is never the part that is cut.
 */
export async function describeSelection(
  msgs: { id: string; body: string; conversationId: string; videoAtSec: number | null; createdAt: Date; author: { name: string } }[],
  timeZone: string,
): Promise<string> {
  const tail = await linkBack(msgs[0]!);
  const pad = (n: number) => String(n).padStart(2, "0");
  let room = DESCRIPTION_MAX - tail.length;
  const quotes: string[] = [];
  for (const m of msgs) {
    const p = zonedParts(m.createdAt, timeZone);
    const time = `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
    const head = interpolate(AR["chatsel.quote.line"] ?? "{name} {time}", { name: m.author.name, time });
    const quote = `${head}\n${m.body.trim() || (AR["chatsel.quote.empty"] ?? "")}`;
    const need = quote.length + (quotes.length ? 2 : 0);
    if (need <= room) {
      quotes.push(quote);
      room -= need;
      continue;
    }
    // what is left of the room goes to the start of this quote; nothing after it fits
    const keep = room - (quotes.length ? 2 : 0) - 1;
    if (keep > head.length + 1) quotes.push(`${quote.slice(0, keep)}…`);
    break;
  }
  return `${quotes.join("\n\n")}${tail}`;
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
    /** Absent (a service caller) or `WORK_INBOX_REF` (what the dialog sends: the route still wants both ids): the space's «صندوق المهام». */
    projectId?: string;
    boardId?: string;
    title?: string;
    assigneeId?: string | null;
    priority?: TaskPriority;
    /** «مين بيشوفها؟»: from a private conversation the default is «المعنيين بس»; SPACE needs `confirmPublic`. */
    visibility?: TaskVisibility;
    confirmPublic?: boolean;
    /**
     * C3b.5 («حدّد» then «اعمل مهمة»): more messages of the selection. The task is ONE: its source is the earliest message of them all, its title comes from the first words
     * and the description quotes every message with author and time. Every message goes through `sourceOf` (readable, not deleted, not a system line, not a guest) and ONE
     * private source makes the whole task private — the visibility is decided over the lot, never by the first row. The company's switch `chatMultiSelect` is checked first.
     */
    alsoMessageIds?: string[];
  },
): Promise<{ taskId: string }> {
  const extra = [...new Set(input.alsoMessageIds ?? [])].filter((id) => id !== messageId);
  if (input.alsoMessageIds?.length) await assertFeatureOn(ctx.orgId, "chatMultiSelect");
  if (extra.length + 1 > SELECTION_TASK_MAX) throw new ValidationError([{ path: "alsoMessageIds", message: "chatsel.full" }]);
  // the person's facts and each conversation's are read once for the whole selection
  const held: SourceFacts = { conversations: new Map() };
  const all = [await sourceOf(ctx, messageId, held)];
  for (const id of extra) all.push(await sourceOf(ctx, id, held));
  all.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  const msg = all[0]!;
  const privateSource = all.some((m) => m.privateSource);
  assertConfirmed(privateSource, input.visibility === "SPACE", input.confirmPublic);
  let visibility: TaskVisibility | undefined = privateSource ? (input.visibility ?? "PARTICIPANTS") : input.visibility;
  let owner = actor;
  let where: { workspaceId: string; projectId: string; boardId: string; columnId?: string } = { workspaceId: input.workspaceId, projectId: input.projectId ?? "", boardId: input.boardId ?? "" };
  if (!input.projectId || input.projectId === WORK_INBOX_REF) {
    const space = await inboxSpaceFor({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole }, input.workspaceId);
    if (!space) throw new ForbiddenError("instant.no_space");
    // «الشركة» holds no project: the inbox is the first standard space's, and the person's rights are checked there
    if (space.id !== input.workspaceId) owner = await requireWorkspace(space.id, ["ADMIN", "MEMBER"]);
    const target = await inboxTarget(ctx, space.id);
    // a task somebody holds, in the inbox everybody of the space opens, is «المعنيين بس» unless the person said otherwise (as a quick task is)
    if (!visibility && input.assigneeId) visibility = "PARTICIPANTS";
    // «للتنفيذ», not the backlog
    where = { workspaceId: space.id, projectId: target.projectId, boardId: target.boardId, columnId: target.columnId };
  }
  const task = await createTask(owner, {
    ...(visibility ? { visibility } : {}),
    ...where,
    // from a selection the title is the first words of the first message that has any (a voice note has none)
    title: (input.title?.trim() || titleFrom((all.find((m) => m.body.trim()) ?? msg).body) || (all.length > 1 ? (AR["chatsel.task.title"] ?? "") : "")).slice(0, 280),
    description: all.length > 1 ? await describeSelection(all, await timeZoneOf(ctx.orgId)) : await describe(msg),
    priority: input.priority,
    assigneeId: input.assigneeId ?? null,
  });
  await db.task.update({ where: { id: task.id }, data: { sourceMessageId: msg.id } });
  return { taskId: task.id };
}

async function timeZoneOf(orgId: string): Promise<string> {
  return resolveTimeZone((await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }))?.timezone);
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
