import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import { DoorError } from "@/server/door/http";
import { canModerate, canPost, canRead, loadConversationFacts, loadOrgFacts, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { TOPIC_KEY } from "@/server/door/message-payload";

/**
 * A message that an APP posts into a topic as a CARD (I1.1): the orders system's events (I1.1a) and `POST /api/v2/messages` (I1.1b) both end here, so
 * there is ONE way a card of an outside sender is written.
 *
 *  - kind `CARD`, `card` = what the sender's card says (texts only), `viaApp` = the name of the sender («عبر <اسم المفتاح>»), `body` = the same card as plain words (what
 *    the chat shows until its screen draws the card). The author is a PERSON (the one who made the token, or who connected the integration).
 *  - The row, the topic's last-message time and the live event are written in the CALLER's transaction, with the record of the idempotent answer or the delivery.
 *  - It is not `sendMessage`: that path counts the author's 30 sends a minute (the sender's person would be limited as a human, and a human would be limited by the
 *    sender), takes no kind of card but the two of the composer, and refuses «لازم ينقرأ» on a card. The door has its own limits (src/server/door/limits.ts).
 */
export interface AppCardInput {
  orgId: string;
  conversationId: string;
  spaceId: string | null;
  authorId: string;
  body: string;
  card: Record<string, unknown>;
  viaApp: string;
  mustRead?: boolean;
}

export async function storeAppCard(tx: Prisma.TransactionClient, input: AppCardInput): Promise<{ id: string; createdAt: Date }> {
  const msg = await tx.chatMessage.create({
    data: {
      orgId: input.orgId,
      conversationId: input.conversationId,
      authorId: input.authorId,
      body: input.body.slice(0, 4000),
      kind: "CARD",
      card: input.card as Prisma.InputJsonValue,
      viaApp: input.viaApp.slice(0, 80),
      ...(input.mustRead ? { ackRequired: true, ackMeta: { markedAt: new Date().toISOString() } } : {}),
    },
    select: { id: true, createdAt: true },
  });
  await tx.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
  await tx.conversation.updateMany({
    where: { id: input.conversationId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: msg.createdAt } }] },
    data: { lastMessageAt: msg.createdAt },
  });
  await emitRealtime(tx, input.orgId, "message.created", { conversationId: input.conversationId, messageId: msg.id, ...(input.spaceId ? { spaceId: input.spaceId } : {}) });
  return msg;
}

export type AuthorTopic = { ok: true; id: string; spaceId: string | null } | { ok: false; reason: "topic_gone" | "author_forbidden" };

/**
 * May a CARD be written into this topic in the name of this PERSON (the author of an app's cards: the one who connected the integration)? Checked when the rule is saved
 * AND again just before every card is stored, because the topic and the person change after a rule is saved. `topic_gone`: no live topic of the company (missing, another
 * company's, a DM, archived or closed); `author_forbidden`: the person may not read it or may not post in it (the ordinary `canRead` and `canPost` rules, the silent
 * oversight holder included: he posts only where he joined).
 */
export async function topicForAuthor(orgId: string, authorId: string, conversationId: string): Promise<AuthorTopic> {
  const topic = await db.conversation.findFirst({ where: { id: conversationId, orgId, kind: "TOPIC", archivedAt: null, closedAt: null }, select: { id: true, spaceId: true } });
  if (!topic) return { ok: false, reason: "topic_gone" };
  const [facts, org] = await Promise.all([loadConversationFacts(authorId, topic.id), loadOrgFacts(authorId, orgId)]);
  if (!facts || !org || facts.orgId !== orgId || !canRead(facts, org) || !canPost(facts, org, { ownerJoined: facts.viewerIsMember })) return { ok: false, reason: "author_forbidden" };
  return { ok: true, id: topic.id, spaceId: topic.spaceId };
}

export interface DoorTopic {
  id: string;
  spaceId: string;
  facts: ConversationFacts;
  org: OrgFacts;
}

/**
 * The topic a token's `topicKey` names: ONLY a topic of the token's own company and space (another space's topic with the same key, another company's, a DM and a
 * key nobody set are all the same «not found»). Then the policy decides for the PERSON the token acts for: they must read the topic; a topic that is closed or
 * archived takes nothing; otherwise the ordinary `canPost` rule applies, with NO exception for anyone: the silent oversight holder (the owner) posts only where he
 * JOINED the topic, so a token of his that names a topic he has not joined is refused 403 `door.forbidden`.
 */
export async function resolveDoorTopic(who: { orgId: string; workspaceId: string; issuerId: string }, topicKey: string): Promise<DoorTopic> {
  const topic = await db.conversation.findFirst({
    where: { orgId: who.orgId, spaceId: who.workspaceId, kind: "TOPIC", doorKey: topicKey },
    select: { id: true, spaceId: true, archivedAt: true },
  });
  if (!topic || !topic.spaceId) throw new DoorError(404, "door.topic_not_found", "No topic of the space this token writes to has that topicKey.");
  const [facts, org] = await Promise.all([loadConversationFacts(who.issuerId, topic.id), loadOrgFacts(who.issuerId, who.orgId)]);
  if (!facts || !org || facts.orgId !== who.orgId || !canRead(facts, org)) throw new DoorError(404, "door.topic_not_found", "No topic of the space this token writes to has that topicKey.");
  if (topic.archivedAt || facts.closedAt) throw new DoorError(409, "door.topic_closed", "The topic is closed or archived.");
  if (!canPost(facts, org, { ownerJoined: facts.viewerIsMember })) throw new DoorError(403, "door.forbidden", "The person this token acts for may not post in that topic.");
  return { id: topic.id, spaceId: topic.spaceId, facts, org };
}

/**
 * A topic gets (or loses) its door name: the name another system writes in `topicKey`. Allowed to whoever moderates the topic (its space's managers and the
 * owner); the name is unique inside the space (the index of the migration), a repeat is refused, `null` takes the topic out of the door.
 */
export async function setTopicDoorKey(actor: { userId: string; orgId: string }, conversationId: string, doorKey: string | null): Promise<{ doorKey: string | null }> {
  if (doorKey !== null && !TOPIC_KEY.test(doorKey)) throw new ValidationError([{ path: "doorKey", message: "door.field.topic_key" }]);
  const conv = await db.conversation.findFirst({ where: { id: conversationId, orgId: actor.orgId, kind: "TOPIC" }, select: { id: true, spaceId: true } });
  if (!conv || !conv.spaceId) throw new NotFoundError("chat.e.not_found");
  const [facts, org] = await Promise.all([loadConversationFacts(actor.userId, conv.id), loadOrgFacts(actor.userId, actor.orgId)]);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  if (doorKey !== null) {
    const taken = await db.conversation.findFirst({ where: { spaceId: conv.spaceId, doorKey, id: { not: conv.id } }, select: { id: true } });
    if (taken) throw new ValidationError([{ path: "doorKey", message: "door.field.topic_key_taken" }]);
  }
  await db.conversation.update({ where: { id: conv.id }, data: { doorKey } });
  return { doorKey };
}
