import { db } from "@/server/db";
import { emitRealtime } from "@/server/realtime/emit";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * C1.1 / C1.8: the chat list's «last message» time moves with a message, in the SAME transaction that wrote it, and never backwards (a
 * message sent meanwhile is newer than this one; the write only lands when the column is empty or older). Every writer of a message
 * (send, forward, a system line) calls this one function.
 */
export async function moveLastMessageAt(tx: Pick<Tx, "conversation">, conversationId: string, at: Date): Promise<void> {
  await tx.conversation.updateMany({
    where: { id: conversationId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: at } }] },
    data: { lastMessageAt: at },
  });
}

/**
 * System messages: no body of their own — the client composes the Arabic sentence from the
 * `{k, p}` stored in `body` (ChatMessage has no meta column). Keys: join | leave | pin |
 * unpin | close | reopen | member_added | member_removed | forwarded.
 */
export function systemMessage(k: string, p: Record<string, string | number> = {}): string {
  return JSON.stringify({ k, p });
}

/**
 * Writes a system message row for the given conversation, and its `message.created` event in the
 * same transaction, so the line («انضم»، «ثبّت»، «أُغلق») appears live for everybody, like any message.
 */
export async function writeSystemMessage(
  tx: Tx,
  opts: { orgId: string; conversationId: string; authorId: string; k: string; p?: Record<string, string | number>; spaceId?: string | null },
): Promise<void> {
  const msg = await tx.chatMessage.create({
    data: {
      orgId: opts.orgId,
      conversationId: opts.conversationId,
      authorId: opts.authorId,
      body: systemMessage(opts.k, opts.p ?? {}),
      kind: "SYSTEM",
    },
    select: { id: true, createdAt: true },
  });
  // a system line is a line of the conversation: it counts for the list's time like any message (the data move counts it too)
  await moveLastMessageAt(tx, opts.conversationId, msg.createdAt);
  await emitRealtime(tx, opts.orgId, "message.created", {
    conversationId: opts.conversationId,
    messageId: msg.id,
    ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
  });
}
