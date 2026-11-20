"use client";

import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import { OrderText } from "@/components/chat/message/order-state-card";
import { splitMentions } from "@/lib/chat/conversation/mentions";
import { FormattedText } from "@/lib/chat/format/render";
import { ct } from "@/lib/chat/text";
import { ZakiEmojiText, isStickerOnly } from "@/components/chat/v2/bubble/zaki-emoji-text";

/**
 * C2.4 — the words of a message: the deleted line, or the body with the people it mentions highlighted and the order numbers in it as chips (a chip is
 * a button that asks for the state only when it is pressed, inside this conversation). The same rules as `message-item.tsx`.
 *
 * C3b.1 — and the body's formatting (`**bold**`, `__italic__`, `~~strike~~`, `code`, a code block, `||spoiler||`, quote lines, links): the body is parsed FIRST
 * (`src/lib/chat/format/parse.ts`), then every plain run of it goes through the same mention highlight and order chips as before, so a mention or an order number
 * inside a bold word still works and a marker never splits a name. `formatting` is the company's switch `chatFormatting` (absent: on): off, the body is drawn as
 * the plain text it is (markers and all), exactly as before C3b.
 */
export function BubbleBody({ message, mentionNames, conversationId, orderChips, formatting = true }: { message: MessageDto; mentionNames: readonly string[]; conversationId: string; orderChips: boolean; formatting?: boolean }) {
  if (message.deleted) return <p className="text-sm italic text-fg-muted">{ct("chatc.deleted")}</p>;
  const body = message.body;
  if (!body) return null;
  const bare = (text: string) => (orderChips ? <OrderText text={text} conversationId={conversationId} /> : text);
  // the owner's Zaki emojis (:zaki_smile:) become their pictures; a message of only those is a big sticker
  const sticker = isStickerOnly(body);
  const plain = (text: string): React.ReactNode => <ZakiEmojiText text={text} render={bare} sticker={sticker} />;
  const withMentions = (text: string): React.ReactNode =>
    mentionNames.length
      ? splitMentions(text, mentionNames).map((piece, i) =>
          piece.mention ? (
            <span key={i} data-mention className="rounded bg-accent/10 px-0.5 font-semibold text-accent">
              {piece.text}
            </span>
          ) : (
            <React.Fragment key={i}>{plain(piece.text)}</React.Fragment>
          ),
        )
      : plain(text);
  if (formatting) return <FormattedText body={body} renderText={withMentions} />;
  return <p className="whitespace-pre-wrap text-sm leading-relaxed">{withMentions(body)}</p>;
}
