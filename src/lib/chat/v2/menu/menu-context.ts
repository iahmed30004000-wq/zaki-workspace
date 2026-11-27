import type { AttachmentDto, ChatListDto, ChatRowDto, ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";
import { isGifAttachment } from "@/lib/chat/gifs";
import { chatRouteOf } from "@/lib/chat/v2/routes";
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

/**
 * C3a.3 — «الرسائل المحفوظة»: the saved chat is a private chat whose OTHER person is me (its row says `peerId` = my id; the server never makes any other chat like that).
 * Pure, so the list, the menu and the info panel know it the same way.
 */
export function isSavedRow(row: Pick<ChatRowDto, "kind" | "peerId">, userId: string | null | undefined): boolean {
  return row.kind === "DM" && !!userId && row.peerId === userId;
}

/**
 * The header of the saved chat, when the list's row is not in the cache to say so: a private chat with no other person (or with me as that person) that carries the saved
 * chat's title. The title keeps it apart from an old DM that lost the other person's row (it has no peer either, and no title).
 */
export function isSavedHeader(header: Pick<ConversationHeaderDto, "kind" | "peer" | "me" | "title">): boolean {
  return header.kind === "DM" && header.title === ct("chatsaved.title") && (!header.peer || (!!header.me.id && header.peer.id === header.me.id));
}

/** The list as the cache holds it, with the answer's `saved` (the company's switch for the saved chat; `ChatListDto` itself is another package's type). */
export type ListWithSaved = ChatListDto & { saved?: boolean };

/**
 * What the menu may offer about the saved chat, from the cached list (no fetch): «حوّل للمحفوظة» is offered when the list holds the saved row, or says the company's
 * switch is on (the chat is then made by the door on first use); it is not offered inside the saved chat itself. The server decides again.
 */
export function savedFlagsOf(list: Pick<ListWithSaved, "rows" | "saved"> | null | undefined, viewerId: string | null | undefined, pathname: string | null | undefined): { canSaved: boolean; inSaved: boolean; savedId: string | null } {
  if (!list || !viewerId) return { canSaved: false, inSaved: false, savedId: null };
  const row = list.rows.find((r) => isSavedRow(r, viewerId)) ?? null;
  const route = chatRouteOf(pathname);
  return { canSaved: !!row || list.saved === true, inSaved: !!row && route.kind === "conversation" && route.id === row.id, savedId: row?.id ?? null };
}

/** The dm door with `{ saved: true }`: the id of my saved chat (made on first use), or null when the door refuses (the switch is off, a guest) or fails. The ONE place that asks. */
export async function openSavedId(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("/api/chat/dm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ saved: true }) });
    if (!res.ok) return null;
    const { id } = (await res.json()) as { id?: unknown };
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * «حوّل للمحفوظة»: open (or make) my saved chat through the dm door, then forward the message into it through the forward door — both doors are today's; nothing is new
 * on the server but the door's `{ saved: true }`. True when the copy was made.
 */
export async function keepInSaved(messageId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const json = { "content-type": "application/json" };
    const id = await openSavedId(fetchImpl);
    if (!id) return false;
    const copied = await fetchImpl(`/api/chat/messages/${encodeURIComponent(messageId)}/forward`, { method: "POST", headers: json, body: JSON.stringify({ conversationId: id }) });
    return copied.ok;
  } catch {
    return false;
  }
}

/** The GIFs a message carries, as the chat can keep them: only files at our own attachment address. */
export const gifsOf = (message: Pick<MessageDto, "attachments">): AttachmentDto[] => message.attachments.filter((f) => isGifAttachment(f) && ours(f));

export function menuContextV2(message: MessageDto, facts: BubbleFacts, extras: { readerCount: number; askKind: boolean }): MessageMenuContext {
  return {
    ...messageMenuContext(message, facts),
    surface: "v2",
    messageId: message.id,
    ...(facts.meId ? { viewerId: facts.meId } : {}),
    canReadText: facts.canReadImages && message.attachments.some((f) => f.kind === "IMAGE" && OCR_MIMES.has(f.mime) && ours(f)),
    canTranscribe: facts.canTranscribe && message.kind === "VOICE" && message.attachments.some((f) => f.mime.startsWith("audio/") && ours(f)),
    readerCount: extras.readerCount,
    canAsk: extras.askKind,
    // C3b.2: «شيل المعاينة» is offered on a message that carries a card (the server sends none for a deleted message or while the switch is off)
    hasPreview: message.preview !== undefined,
    ...(facts.gifs === true && gifsOf(message).length > 0 ? { canSaveGif: true } : {}),
    // «الرد في محادثة أخرى», «تعديل صورة أو ملف» and the article's editor: each only where the header says so
    ...(facts.canReplyElsewhere ? { canReplyElsewhere: true } : {}),
    ...(facts.canEditMedia ? { canEditMedia: true, hasFiles: message.attachments.length > 0 } : {}),
    ...(facts.canEditArticle ? { canEditArticle: true } : {}),
  };
}
