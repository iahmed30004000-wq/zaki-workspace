import type { ConversationHeaderDto } from "@/server/chat/dto";
import type { AutoRule } from "@/lib/tickets/auto-rules";
import type { MenuFacts } from "@/components/chat/message/message-item";
import { isSavedHeader } from "@/lib/chat/v2/menu/menu-context";

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
  /** «الصوت زي تيليجرام»: the speed button on every voice note (the header says `false` to switch it off; absent: on) */
  voiceTg: boolean;
  canReadImages: boolean;
  /** C3b.2: the company's switch `linkPreviews`; off, a card the cache still holds is not drawn */
  linkPreviews: boolean;
  /** C3b.1: the company's switch `chatFormatting` (the header says `false` to switch it off; absent: on): off, a body is drawn as typed, markers and all */
  formatting: boolean;
  /** C3b.3: the company's switch `chatAlbums` (absent: on): off, a message's pictures are one box each, not a mosaic */
  albums: boolean;
  /** «الصور المتحركة» (`chatGifs`; absent: off): a GIF obeys «play by itself», and the menu offers to keep it */
  gifs?: boolean;
  /** C3a.3: this is the person's saved chat (a private chat with nobody else in it): its messages have the single ✓ and no typing */
  saved: boolean;
  problemRules: AutoRule[];
}

const NO_RULES: AutoRule[] = [];

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
    voiceTg: header.voiceTelegram !== false,
    canReadImages: header.imageOcr === true,
    linkPreviews: header.linkPreviews === true,
    formatting: header.chatFormatting !== false,
    albums: header.chatAlbums !== false,
    gifs: header.gifs === true,
    saved: isSavedHeader(header),
    problemRules: me.problemRules ?? NO_RULES,
  };
}

/**
 * Are these the same facts? A header is a new object whenever anything in it changes (a pin, the title, the member count), and the facts it carries rarely
 * do: the screen keeps the OLD object while this says yes, so a bubble (and the menu given to it) is not drawn again for a change it does not read.
 */
export function sameFacts(a: BubbleFacts, b: BubbleFacts): boolean {
  return (Object.keys(a) as (keyof BubbleFacts)[]).every((key) => (key === "problemRules" ? a.problemRules === b.problemRules || JSON.stringify(a.problemRules) === JSON.stringify(b.problemRules) : a[key] === b[key]));
}
