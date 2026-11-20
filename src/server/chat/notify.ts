import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { stripFormatting } from "@/lib/chat/format/parse";
import { pushNotification } from "@/server/notify";
import { isViewing } from "@/server/realtime/viewing";
import { canReadConversation, type ConversationFacts } from "@/server/policy/conversation";
import { hqSpaceId } from "@/server/chat/hq";
import { notifyOn, notifyTypeOf, PREVIEW_OFF_TEXT, pushBodyFor, readChatPrefs, type ChatPrefs } from "@/lib/chat/prefs";
import { customerDataHint } from "@/lib/chat/customer-data-hint";
import { pushChatNote } from "@/server/push-chat";

/**
 * Chat notifications: a message reaches the people of its audience that are NOT looking at the
 * app right now. Online people see the message live; a notification for them would be noise.
 * A DM's BELL keeps one row per unread thread (no stacking of the same conversation), but its PUSH goes out for every message (M1a): a phone whose app is
 * closed shows each one, grouped by conversation by the service worker (`public/sw.js`, `tag` = the conversation's id), not only the first of the run.
 *
 * M1a: what a push SAYS is the sender's name (the title) and the words with their markers stripped. A message shaped like a customer's data (the order template,
 * or a phone number: `customerDataHint`) reaches the push as «رسالة جديدة» only, like «بدون معاينة»: a push crosses the browser vendor's push service and shows
 * on a lock screen. The bell and the chat keep the words (nothing in the chat is hidden or changed).
 *
 * C4.1: each person's own choices (`User.chatPrefs.notifications`) are read here. A message is one of five kinds FOR a person (private · topic · mention · reply
 * to me · call: `notifyTypeOf`); a kind they switched off notifies them of nothing (no bell row, no push), and a kind whose preview they switched off sends the
 * push as «رسالة جديدة» only (the bell keeps the words). A person who never chose anything is told exactly as before.
 *
 * C3w.1: a person who muted THIS conversation for themselves (`ConversationMember.mutedUntil` in the future, C3a.1 «كتم الإشعارات») is told of nothing in it: no bell row, no push.
 * That includes a mention and «@الكل» (the spec of C3a.1 names no exception, and a mute that rings is not a mute); the mention still counts in the list and among the person's unread
 * mentions, which come from the message rows. `preview` is the WHOLE body: the markers are stripped first and the words cut after (see `previewText`).
 */

/** How many characters of a message the bell and the push carry. */
export const PREVIEW_CHARS = 140;

/** The words of a body for a bell or a push: the markers stripped from the WHOLE body (a spoiler is masked, a link keeps its label), then cut. */
export function previewText(body: string): string {
  return stripFormatting(body, { math: true, partial: true }).slice(0, PREVIEW_CHARS);
}

export async function notifyMessageToAudience(opts: {
  conversationId: string;
  authorId: string;
  audienceIds: string[]; // the audience WITHOUT the author
  kind: "DM" | "GROUP" | "TOPIC";
  title: string; // the conversation title (or the DM peer's name)
  preview: string; // the body preview (attachments -> an Arabic «أرسل مرفقًا»)
  messageId: string; // in the link, so an edit or a delete can reach the preview again
  /** the people named with «@»: they are told even while they look at the app (a mention is addressed to them) */
  mentionedIds?: string[];
  /** reached by «@الكل»: told even while online, as «ذكر الجميع» */
  allIds?: string[];
  /** C3c.2 «ابعت بدون صوت»: the sender chose silence: no bell row, no push for anybody (a mention included); unread counts do not come from here */
  silent?: boolean;
}): Promise<void> {
  if (opts.silent === true) return;
  const targets = new Set(opts.audienceIds);
  // «كتم الإشعارات» (C3a.1): the people who muted this conversation for themselves are not told, a mention included
  for (const userId of await mutedAmong(opts.conversationId, targets)) targets.delete(userId);
  if (targets.size === 0) return;
  // the space the message is in (a DM from before spaces had them is «الشركة»'s): the bell of that space shows it
  const conv = await db.conversation.findUnique({ where: { id: opts.conversationId }, select: { spaceId: true, orgId: true } });
  const workspaceId = conv?.spaceId ?? (conv ? await hqSpaceId(conv.orgId) : null);
  const named = new Set(opts.mentionedIds ?? []);
  const everyone = new Set(opts.allIds ?? []);
  const plain = previewText(opts.preview);
  // M1a: a customer's data never rides a push (the preview of the chat itself is untouched)
  const customerData = customerDataHint(opts.preview) !== null;
  const prefs = await prefsOf(targets);
  // who the message answers (a reply to MY message is its own kind): read only when somebody here has chosen something and the chat is not a private one
  const repliedTo = prefs.size > 0 && opts.kind !== "DM" ? await replyAuthorOf(opts.messageId) : null;
  for (const userId of targets) {
    const addressed = named.has(userId) || everyone.has(userId);
    const chosen = prefs.get(userId);
    const type = notifyTypeOf({ kind: opts.kind, mentioned: addressed, replied: repliedTo === userId });
    // the person switched this kind off: nothing for them, not even the bell
    if (chosen && !notifyOn(chosen, type)) continue;
    // held back only for a person who is LOOKING at the app (a visible tab); an open but hidden tab still gets the push (F0.5)
    if (!addressed && (await isViewing(userId))) continue;
    const title = named.has(userId) ? `${opts.title} ${MENTION_TITLE}` : everyone.has(userId) ? `${opts.title} ${MENTION_ALL_TITLE}` : opts.title;
    // C4.1: preview off = the push carries «رسالة جديدة», never the words (the bell keeps its body); M1a: the same for a customer's data
    const spoken = customerData ? PREVIEW_OFF_TEXT : plain;
    if (!addressed && opts.kind === "DM") {
      const unread = await db.notification.findFirst({
        where: { userId, readAt: null, type: "chat_message", linkUrl: { contains: opts.conversationId } },
        select: { id: true },
      });
      if (unread) {
        // M1a: the bell already has this chat's row, so no second one — but the phone is told of THIS message too
        pushChatNote([userId], { title, body: chosen ? pushBodyFor(chosen, type, spoken) : spoken, linkUrl: messageLink(opts.conversationId, opts.messageId), conversationId: opts.conversationId, workspaceId });
        continue;
      }
    }
    await pushNotification({
      userId,
      type: "chat_message",
      title,
      // C3b.1: the words, not the markers (`**bold**`, a link's `[label](address)`); a spoiler's words are not read out on a lock screen
      body: plain,
      ...(chosen ? { pushBody: pushBodyFor(chosen, type, spoken) } : customerData ? { pushBody: PREVIEW_OFF_TEXT } : {}),
      linkUrl: messageLink(opts.conversationId, opts.messageId),
      workspaceId,
    });
  }
}

/** The people among `userIds` whose own mute of this conversation has not ended yet. One read. */
async function mutedAmong(conversationId: string, userIds: Iterable<string>): Promise<string[]> {
  const ids = [...userIds];
  if (ids.length === 0) return [];
  try {
    const rows = await db.conversationMember.findMany({ where: { conversationId, userId: { in: ids }, mutedUntil: { gt: new Date() } }, select: { userId: true } });
    return rows.map((r) => r.userId);
  } catch (err) {
    // a failed read of the mutes never stops a notification (as for the choices below): everybody is told, as before this step
    log.warn("notify.mutes_failed", { message: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** The prefs of the people who HAVE chosen something about notifications (the others are not in the map: they are told as before). One read for the whole audience. */
async function prefsOf(userIds: Iterable<string>): Promise<Map<string, ChatPrefs>> {
  const ids = [...userIds];
  const out = new Map<string, ChatPrefs>();
  if (ids.length === 0) return out;
  try {
    const rows = await db.user.findMany({ where: { id: { in: ids }, NOT: { chatPrefs: { equals: Prisma.DbNull } } }, select: { id: true, chatPrefs: true } });
    for (const row of rows) {
      const prefs = readChatPrefs(row.chatPrefs);
      if (prefs.notifications && Object.keys(prefs.notifications).length > 0) out.set(row.id, prefs);
    }
  } catch (err) {
    // a failed read of the choices never stops a notification: everybody is told, as before this step
    log.warn("notify.prefs_failed", { message: err instanceof Error ? err.message : String(err) });
    out.clear();
  }
  return out;
}

/** The author of the message this one replies to (null: it is no reply). */
async function replyAuthorOf(messageId: string): Promise<string | null> {
  const row = await db.chatMessage.findUnique({ where: { id: messageId }, select: { replyTo: { select: { authorId: true } } } });
  return row?.replyTo?.authorId ?? null;
}

/** What follows the author's name in the bell when the message is addressed to the person. */
export const MENTION_TITLE = "ذكرك";
export const MENTION_ALL_TITLE = "ذكر الجميع";

/**
 * Everybody a topic reaches, for «@الكل»: an open topic reaches its space, a restricted one its own rows. The
 * OWNER has a place here only through a row of his own, so reading as the owner leaves no trace. The caller
 * still passes the list through `readersAmong` (the policy decides who may read).
 */
export async function topicAudienceIds(facts: ConversationFacts, conversationId: string): Promise<string[]> {
  const rows = await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
  const ids = new Set(rows.map((r) => r.userId));
  if (!facts.restricted && facts.spaceId) {
    const space = await db.workspaceMember.findMany({ where: { workspaceId: facts.spaceId }, select: { userId: true } });
    for (const r of space) ids.add(r.userId);
  }
  return [...ids];
}

/** The link a chat notification carries: the conversation, and the message it was about. */
export function messageLink(conversationId: string, messageId: string): string {
  return `/chat/${conversationId}?m=${messageId}`;
}

/** The text shown in place of a deleted message's preview (the bell never keeps it). */
export const DELETED_PREVIEW = "حُذفت الرسالة";

/**
 * An edited or deleted message: every notification that still carries its old preview gets the new
 * one (the edited text, or «حُذفت الرسالة»). Runs inside the edit/delete transaction.
 */
export async function rewriteMessagePreviews(
  tx: Pick<typeof db, "notification">,
  conversationId: string,
  messageId: string,
  preview: string,
): Promise<void> {
  await tx.notification.updateMany({
    where: { type: { in: ["chat_message", "must_read", "must_read_late"] }, linkUrl: messageLink(conversationId, messageId) },
    data: { body: previewText(preview) },
  });
}

/**
 * Who a new message may notify (spec, 12-PHASE3-TASKS §32): in a DM its other person; in a topic
 * (or a legacy group) only the people @mentioned and the author of the message replied to — the rest
 * of a topic is Phase 5. The author is never notified of their own message.
 * These are CANDIDATES: `readersAmong` keeps only the people who may read the conversation now.
 */
export function notifyCandidates(
  facts: ConversationFacts,
  authorId: string,
  mentionIds: string[],
  replyAuthorId: string | null,
): string[] {
  const ids = facts.kind === "DM" ? facts.memberIds : [...mentionIds, ...(replyAuthorId ? [replyAuthorId] : [])];
  return [...new Set(ids)].filter((id) => id !== authorId);
}

/**
 * The people among `ids` who may read the conversation right now, by the policy (their rank in the
 * conversation's own company, their space row, the topic's restriction). A ConversationMember row
 * alone proves nothing: one left behind by a removal must not keep receiving the messages.
 */
export async function readersAmong(conversationId: string, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) if (await canReadConversation(id, conversationId)) out.push(id);
  return out;
}
