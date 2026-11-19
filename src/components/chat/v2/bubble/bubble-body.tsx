"use client";

import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import { OrderText } from "@/components/chat/message/order-state-card";
import { splitMentions } from "@/lib/chat/conversation/mentions";
import { ct } from "@/lib/chat/text";

/**
 * C2.4 — the words of a message: the deleted line, or the body with the people it mentions highlighted and the order numbers in it as chips (a chip is
 * a button that asks for the state only when it is pressed, inside this conversation). The same rules as `message-item.tsx`.
 */
export function BubbleBody({ message, mentionNames, conversationId, orderChips }: { message: MessageDto; mentionNames: readonly string[]; conversationId: string; orderChips: boolean }) {
  if (message.deleted) return <p className="text-sm italic text-fg-muted">{ct("chatc.deleted")}</p>;
  const body = message.body;
  if (!body) return null;
  const plain = (text: string) => (orderChips ? <OrderText text={text} conversationId={conversationId} /> : text);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {mentionNames.length
        ? splitMentions(body, mentionNames).map((piece, i) =>
            piece.mention ? (
              <span key={i} data-mention className="rounded bg-accent/10 px-0.5 font-semibold text-accent">
                {piece.text}
              </span>
            ) : (
              <React.Fragment key={i}>{plain(piece.text)}</React.Fragment>
            ),
          )
        : plain(body)}
    </p>
  );
}
