import { db } from "@/server/db";
import { stripFormatting } from "@/lib/chat/format/parse";
import { pushNotification } from "@/server/notify";
import { isViewing } from "@/server/realtime/viewing";
import { canReadConversation, type ConversationFacts } from "@/server/policy/conversation";
import { hqSpaceId } from "@/server/chat/hq";

/**
 * Chat notifications: a message reaches the people of its audience that are NOT looking at the
 * app right now. Online people see the message live; a notification for them would be noise.
 * A DM notifies its other person once per unread thread (no stacking of the same conversation).
 */

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
  // the space the message is in (a DM from before spaces had them is «الشركة»'s): the bell of that space shows it
  const conv = await db.conversation.findUnique({ where: { id: opts.conversationId }, select: { spaceId: true, orgId: true } });
  const workspaceId = conv?.spaceId ?? (conv ? await hqSpaceId(conv.orgId) : null);
  const named = new Set(opts.mentionedIds ?? []);
  const everyone = new Set(opts.allIds ?? []);
  for (const userId of targets) {
    const addressed = named.has(userId) || everyone.has(userId);
    // held back only for a person who is LOOKING at the app (a visible tab); an open but hidden tab still gets the push (F0.5)
    if (!addressed && (await isViewing(userId))) continue;
    if (!addressed && opts.kind === "DM") {
      const unread = await db.notification.findFirst({
        where: { userId, readAt: null, type: "chat_message", linkUrl: { contains: opts.conversationId } },
        select: { id: true },
      });
      if (unread) continue;
    }
    await pushNotification({
      userId,
      type: "chat_message",
      title: named.has(userId) ? `${opts.title} ${MENTION_TITLE}` : everyone.has(userId) ? `${opts.title} ${MENTION_ALL_TITLE}` : opts.title,
      // C3b.1: the words, not the markers (`**bold**`, a link's `[label](address)`); a spoiler's words are not read out on a lock screen, even when the preview was cut inside the spoiler (`partial`)
      body: stripFormatting(opts.preview, { math: true, partial: true }),
      linkUrl: messageLink(opts.conversationId, opts.messageId),
      workspaceId,
    });
  }
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
    data: { body: stripFormatting(preview, { math: true, partial: true }) },
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
