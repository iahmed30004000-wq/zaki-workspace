import type { AttachmentDto, ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { messageMenuContext } from "@/components/chat/message/message-item";
import type { MessageMenuContext } from "@/components/chat/message/message-menu-registry";
import type { BubbleFacts } from "@/lib/chat/v2/pane/bubble-facts";

/**
 * C2.6 — what the registry is asked for ONE message on the new screen. It is `messageMenuContext` (the very function the old bubble uses, so the old
 * fields can never drift) plus the new screen's own flags: `surface: "v2"` (which opts in to the items only this screen can run and to Telegram's order),
 * whether the message holds a picture or a voice note the header's switches cover, how many people read up to it, and whether «اسألي مشرفتك» is on offer.
 *
 * The server decides every action again; these flags only decide what is drawn.
 */
const OCR_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** Only our own attachment address is ever drawn as a file (a message cannot point the page at a remote one); the buttons exist only under such a file. */
const ours = (file: AttachmentDto) => file.url.startsWith("/api/chat/attachments/");

/** «اسألي مشرفتك» is the «🎫 مشكلة» door with this kind (`سؤال عن منتج`): the company's kinds must have it. */
export const ASK_KIND_KEY = "product_question";

export function askKindOf(kinds: ConversationHeaderDto["me"]["problemKinds"]): boolean {
  return !!kinds?.some((k) => k.key === ASK_KIND_KEY);
}

export function menuContextV2(message: MessageDto, facts: BubbleFacts, extras: { readerCount: number; askKind: boolean }): MessageMenuContext {
  return {
    ...messageMenuContext(message, facts),
    surface: "v2",
    canReadText: facts.canReadImages && message.attachments.some((f) => f.kind === "IMAGE" && OCR_MIMES.has(f.mime) && ours(f)),
    canTranscribe: facts.canTranscribe && message.kind === "VOICE" && message.attachments.some((f) => f.mime.startsWith("audio/") && ours(f)),
    readerCount: extras.readerCount,
    canAsk: extras.askKind,
  };
}
