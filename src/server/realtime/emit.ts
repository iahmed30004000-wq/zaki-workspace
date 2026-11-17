import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Every kind of event, in ONE list: the type below and the listener's check of a stored row both come from it, so a
 * new kind cannot be written here and then turned into `conversation.changed` on its way to the browsers.
 */
export const REALTIME_KINDS = [
  "message.created",
  "message.edited",
  "message.deleted",
  "message.reacted",
  "message.pinned",
  // somebody voted on a poll, withdrew a vote, or a poll was closed (ids only: never WHO voted)
  "poll.voted",
  "conversation.read",
  "conversation.delivered",
  "conversation.changed",
  "membership.changed",
  // somebody drew on a conversation's whiteboard (its readers fetch and merge)
  "whiteboard.changed",
  // a call of a conversation started or ended (its readers refresh the «in a call» bar)
  "call.changed",
  // somebody is ringing this ONE person (`targetUserId`) into a call
  "call.ring",
  // the remote of a «نتفرّج سوا» session was pressed or handed over (its people fetch the new state)
  "watch.changed",
  // a ticket made from a message of this conversation changed state or hands (ids only: its chip under the message refreshes)
  "ticket.changed",
] as const;

export type RealtimeKind = (typeof REALTIME_KINDS)[number];

/** Is this stored kind one the clients know? (an unknown one travels as `conversation.changed`) */
export function isRealtimeKind(kind: string): kind is RealtimeKind {
  return (REALTIME_KINDS as readonly string[]).includes(kind);
}

export type RealtimeIds = {
  conversationId?: string;
  messageId?: string;
  spaceId?: string;
  /** WHO the event is about (the reader, the person who joined): it goes to everybody allowed to see it. */
  userId?: string;
  /** The call the event is about (call.changed, call.ring). */
  callId?: string;
  /** The ONE person the event is for, when it is for one person only (a mute in a space). */
  targetUserId?: string;
};

export type RealtimeClient = Prisma.TransactionClient | PrismaClient;

/**
 * Writes one `RealtimeEvent` row: the ids only, never message content. The realtime
 * layer notifies readers through the Postgres trigger on this table (migration
 * `20261024092000_chat_realtime_trigger`).
 */
export async function emitRealtime(
  client: RealtimeClient,
  orgId: string,
  kind: RealtimeKind,
  ids: RealtimeIds,
): Promise<void> {
  await client.realtimeEvent.create({
    data: { orgId, kind, ids: ids as Prisma.InputJsonValue },
  });
}
