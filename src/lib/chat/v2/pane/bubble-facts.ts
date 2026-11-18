import type { ConversationHeaderDto } from "@/server/chat/dto";
import type { AutoRule } from "@/lib/tickets/auto-rules";
import type { MenuFacts } from "@/components/chat/message/message-item";

/**
 * C2.4 — what a bubble needs to know about the conversation and about me in it, read ONCE from the header (never from a rank): the same flags the old
 * screen passed to every `MessageItem`. The header is a cached object, so this is computed once per header and every bubble gets the same one (a bubble
 * that did not change does not draw again).
 */
export interface BubbleFacts extends MenuFacts {
  meId: string | undefined;
  canMakeWork: boolean;
  canRemind: boolean;
  canTranslate: boolean;
  canProblem: boolean;
  canMustRead: boolean;
  /** an order number in a message is a chip, asked for inside this conversation */
  canOrderState: boolean;
  /** the hint line for customer data: only in an open topic */
  orderHints: boolean;
  canTranscribe: boolean;
  canReadImages: boolean;
  problemRules: AutoRule[];
}

export function bubbleFactsOf(header: ConversationHeaderDto): BubbleFacts {
  const me = header.me;
  return {
    meId: me.id,
    conversationKind: header.kind,
    canPost: me.canPost,
    canModerate: me.canModerate,
    oversight: me.oversight,
    canMakeWork: Boolean(me.canMakeWork),
    canMakeTask: me.canMakeTask,
    canMakeTicket: me.canMakeTicket,
    canRemind: Boolean(me.canRemind),
    canTranslate: Boolean(me.canTranslate),
    canProblem: Boolean(me.problemKinds?.length),
    canMustRead: Boolean(me.canMustRead),
    canOrderState: Boolean(me.canOrderState),
    orderHints: Boolean(me.orderHints) && header.kind === "TOPIC" && !header.restricted && !header.teamId,
    canTranscribe: header.voiceTranscript === true,
    canReadImages: header.imageOcr === true,
    problemRules: me.problemRules ?? [],
  };
}
