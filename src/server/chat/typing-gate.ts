import { db } from "@/server/db";

/**
 * C1.8 — the typing route's policy facts, remembered for 30 s.
 *
 * `POST /api/rt/typing` fires about every 3 s while somebody types, and each ping used to cost ~12 database calls (the conversation, the
 * policy's two loads, the member row, the person again). What the route needs about (person, conversation) changes rarely: «may this person
 * read it» and «have they a row of their own in it». Those two facts are remembered per (person, conversation) for 30 s.
 *
 * What the memory must never do — each line is pinned by `tests/db/chat-typing-gate.test.ts`:
 *  - A refusal is NEVER remembered. Only a person who could read is stored, so somebody who cannot read is asked every time and can
 *    never send typing from this memory; a person who gains access is not kept waiting.
 *  - An entry is one person's and one conversation's, in one company: it is looked up by all three, never by the conversation alone.
 *  - A person who loses access keeps typing for at most `TYPING_FACTS_TTL_MS`; a caller that revokes (a removal, a role change) calls
 *    `forgetTypingFacts` to end it at once.
 *  - The OWNER is never remembered: what his reading is (silent oversight, or a joined member who may emit) is asked again on every
 *    ping, so «he joined» and «he left» take effect on the next one.
 *  - Who RECEIVES the frame is not decided here at all: the hub's fan-out asks the policy for every recipient (`broadcastTyping`).
 */

export const TYPING_FACTS_TTL_MS = 30_000;
/** A hard cap on entries (a person has a handful of open conversations): past it the expired ones go, then the oldest. */
const MAX_ENTRIES = 5_000;

export interface TypingFacts {
  orgId: string;
  /** the person has a row of their own in the conversation (a member, not only a reader of an open topic) */
  member: boolean;
}

interface Entry extends TypingFacts {
  until: number;
}

const remembered = new Map<string, Entry>();
const keyOf = (userId: string, conversationId: string): string => `${userId}|${conversationId}`;

/** Forget what is remembered about one person in one conversation (or in every conversation, when none is named). */
export function forgetTypingFacts(userId: string, conversationId?: string): void {
  if (conversationId) {
    remembered.delete(keyOf(userId, conversationId));
    return;
  }
  for (const key of remembered.keys()) if (key.startsWith(`${userId}|`)) remembered.delete(key);
}

export function resetTypingGateForTests(): void {
  remembered.clear();
}

function trim(now: number): void {
  if (remembered.size < MAX_ENTRIES) return;
  for (const [key, entry] of remembered) if (entry.until <= now) remembered.delete(key);
  // still full: the oldest go (a Map iterates in insertion order)
  for (const key of remembered.keys()) {
    if (remembered.size < MAX_ENTRIES) break;
    remembered.delete(key);
  }
}

/**
 * The facts for a typing ping, or `null` when the person may not read the conversation (the route answers 404: the conversation is
 * invisible to them, not forbidden). `isOwner`: never read from nor written to the memory.
 */
export async function typingFacts(
  actor: { userId: string; orgId: string; isOwner: boolean },
  conversationId: string,
  now: number = Date.now(),
): Promise<TypingFacts | null> {
  const key = keyOf(actor.userId, conversationId);
  if (!actor.isOwner) {
    const hit = remembered.get(key);
    if (hit && hit.until > now && hit.orgId === actor.orgId) return { orgId: hit.orgId, member: hit.member };
    if (hit) remembered.delete(key);
  }

  const conversation = await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true, orgId: true } });
  if (!conversation || conversation.orgId !== actor.orgId) return null;
  // visibility through the policy seam: a person who cannot READ the conversation is nobody here (posting is not required: a read-only
  // announcements member still sees «يكتب الآن…»)
  const { canReadConversation } = await import("@/server/realtime/policy-gate");
  if (!(await canReadConversation(actor.userId, conversation.id))) return null;
  const row = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: conversation.id, userId: actor.userId } },
    select: { id: true },
  });
  const facts: TypingFacts = { orgId: conversation.orgId, member: row !== null };
  if (!actor.isOwner) {
    trim(now);
    remembered.set(key, { ...facts, until: now + TYPING_FACTS_TTL_MS });
  }
  return facts;
}
