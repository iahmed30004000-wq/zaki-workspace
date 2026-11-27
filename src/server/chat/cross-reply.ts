import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canRead, hasOversight, loadConversationFacts, loadOrgFacts, type OrgFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { hiddenIdsAmong } from "@/server/chat/hidden-messages";
import { crossSnapshotOf, type CrossSnapshot } from "@/lib/chat/cross-reply";

/**
 * «الرد في محادثة أخرى» — a reply, in one conversation, to a message of ANOTHER one.
 *
 * THE PRIVACY RULE, in one place:
 *  1. SENDING. The sender must READ the source (`canRead`, the policy's own rule) and may POST in the target (`canPost`, the ordinary send's own check). A source that is
 *     not theirs to read, not of their company, or that they hid for themselves is «not found», the same words as an id that does not exist. A deleted message and a system
 *     line cannot be answered. Whoever holds silent oversight and is not a member of the source joins it first (like a reaction or a vote): nothing leaves a conversation
 *     somebody only reads in silence.
 *  2. WHAT TRAVELS. A snapshot taken by the SERVER at send time from the source row (`crossSnapshotOf`): the writer's name and a short piece of the words, markers
 *     stripped and spoilers masked, plus the kind («صورة»). Never the source conversation's name or id, never a file name or a file; nothing the browser sends is stored.
 *  3. READING IT. Everybody who reads the target reads that snapshot (that is what the sender chose to carry); a GUEST gets the words without the writer's name. The
 *     source's id never travels. A viewer who may read the source (not a guest, not a message they hid) is told `jump: true`, and the jump door decides it all again.
 *  4. WHEN THE SOURCE GOES. Deleted (or its row gone): the words stop being sent to everybody, like the quote of an ordinary reply, and the replies are told live. An
 *     EDIT of the source does not change a quote already carried. The company's switch off: no quote is sent at all (the stored one comes back with the switch).
 *  5. ELSEWHERE. The snapshot is no part of the message's words: search, the bell, the push, the chat list, a forward, a task made from the reply, the assistant and a
 *     bot's webhook never see it.
 */

const NOT_FOUND = "chat.e.cross_not_found";

export interface ResolvedCrossReply {
  sourceId: string;
  snapshot: CrossSnapshot;
}

/** Rule 1 and 2. The target's own rule (may I post there) has been checked by the caller, `sendMessage`, before this is asked. */
export async function resolveCrossReply(ctx: OrgAccessContext, targetConversationId: string, sourceMessageId: string): Promise<ResolvedCrossReply> {
  await assertFeatureOn(ctx.orgId, "chatReplyElsewhere");
  const source = await db.chatMessage.findUnique({
    where: { id: sourceMessageId },
    select: { id: true, orgId: true, conversationId: true, kind: true, body: true, deletedAt: true, author: { select: { name: true } }, attachments: { orderBy: { position: "asc" }, select: { kind: true } } },
  });
  if (!source || source.orgId !== ctx.orgId) throw new NotFoundError(NOT_FOUND);
  const [facts, org] = await Promise.all([loadConversationFacts(ctx.userId, source.conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
  // readable first: nothing about a message a person may not read is theirs to learn (a guest reads topics only, as everywhere)
  if (!facts || !org || facts.orgId !== ctx.orgId || !canRead(facts, org) || (org.role === "GUEST" && facts.kind !== "TOPIC")) throw new NotFoundError(NOT_FOUND);
  if ((await hiddenIdsAmong(ctx.userId, [source.id])).size > 0) throw new NotFoundError(NOT_FOUND);
  if (hasOversight(org) && !facts.viewerIsMember) throw new ForbiddenError("chat.e.join_first");
  if (source.conversationId === targetConversationId) throw new ValidationError([{ path: "crossReply", message: "chat.e.cross_same" }]);
  if (source.kind === "SYSTEM") throw new ForbiddenError("chat.e.system_immutable");
  if (source.deletedAt) throw new ForbiddenError("chat.e.deleted");
  return { sourceId: source.id, snapshot: crossSnapshotOf({ kind: source.kind, body: source.body, authorName: source.author.name, attachments: source.attachments }) };
}

type CrossRow = { id: string; crossReply?: unknown; crossReplyToId?: string | null; crossReplyTo?: { deletedAt: Date | null; conversationId: string; orgId: string } | null };

/**
 * Rule 3: what a presenter needs for ONE viewer and a page of rows — `{}` when no row quotes another conversation (no query is made) or the switch is off (the presenter
 * then sends no quote at all), else the ids of the replies whose SOURCE this viewer may read. One verdict per source conversation.
 */
export async function crossViewerOf(userId: string, orgId: string, org: OrgFacts, rows: readonly CrossRow[]): Promise<{ crossReply?: { jumpable: ReadonlySet<string> } }> {
  const quoting = rows.filter((r) => r.crossReply !== null && r.crossReply !== undefined);
  if (quoting.length === 0 || !(await isFeatureOn(orgId, "chatReplyElsewhere"))) return {};
  const jumpable = new Set<string>();
  // like the «محوّلة من» header: a guest is never offered the way to a source
  const live = org.role === "GUEST" ? [] : quoting.filter((r) => r.crossReplyToId && r.crossReplyTo && !r.crossReplyTo.deletedAt && r.crossReplyTo.orgId === orgId);
  if (live.length > 0) {
    const conversations = [...new Set(live.map((r) => r.crossReplyTo!.conversationId))];
    const readable = new Set<string>();
    await Promise.all(
      conversations.map(async (id) => {
        const facts = await loadConversationFacts(userId, id);
        if (facts && facts.orgId === orgId && canRead(facts, org)) readable.add(id);
      }),
    );
    const hidden = await hiddenIdsAmong(userId, live.map((r) => r.crossReplyToId!));
    for (const r of live) if (readable.has(r.crossReplyTo!.conversationId) && !hidden.has(r.crossReplyToId!)) jumpable.add(r.id);
  }
  return { crossReply: { jumpable } };
}

/**
 * The tap on the quote: where the source is, ONLY for somebody who reads both the reply and the source (never a guest, never a deleted one). Every other case is the same
 * «not found», so the door never says which of the two it was.
 */
export async function crossReplySourceOf(ctx: OrgAccessContext, replyId: string): Promise<{ conversationId: string; messageId: string }> {
  await assertFeatureOn(ctx.orgId, "chatReplyElsewhere");
  const notFound = () => new NotFoundError("chat.e.not_found");
  const reply = await db.chatMessage.findUnique({ where: { id: replyId }, select: { orgId: true, conversationId: true, crossReplyToId: true, deletedAt: true } });
  if (!reply || reply.orgId !== ctx.orgId || !reply.crossReplyToId || reply.deletedAt) throw notFound();
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!org || org.role === "GUEST") throw notFound();
  const reads = async (conversationId: string) => {
    const facts = await loadConversationFacts(ctx.userId, conversationId);
    return !!facts && facts.orgId === ctx.orgId && canRead(facts, org);
  };
  if (!(await reads(reply.conversationId))) throw notFound();
  const source = await db.chatMessage.findUnique({ where: { id: reply.crossReplyToId }, select: { id: true, orgId: true, conversationId: true, deletedAt: true } });
  if (!source || source.orgId !== ctx.orgId || source.deletedAt || !(await reads(source.conversationId))) throw notFound();
  if ((await hiddenIdsAmong(ctx.userId, [source.id])).size > 0) throw notFound();
  return { conversationId: source.conversationId, messageId: source.id };
}

/** Rule 4, live: the replies that quote these messages (about to be deleted) are asked for again by whoever reads them. Ids only. Call it BEFORE the rows go. */
export async function touchCrossReplies(tx: Prisma.TransactionClient, orgId: string, sources: Prisma.ChatMessageWhereInput): Promise<void> {
  const replies = await tx.chatMessage.findMany({
    where: { orgId, deletedAt: null, crossReplyTo: { is: sources } },
    select: { id: true, conversationId: true, conversation: { select: { spaceId: true } } },
    take: 500,
  });
  for (const r of replies) {
    await emitRealtime(tx, orgId, "message.enriched", { conversationId: r.conversationId, messageId: r.id, ...(r.conversation.spaceId ? { spaceId: r.conversation.spaceId } : {}) });
  }
}
