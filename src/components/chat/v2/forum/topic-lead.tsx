import React from "react";
import type { RowLead } from "@/components/chat/v2/list/row-lead";
import { topicColourOf, topicGlyphOf } from "@/lib/chat/v2/topic-icon";
import { cn } from "@/lib/utils";

/**
 * The forum's rows on a phone with Telegram's look: a topic's picture is a speech bubble in the topic's own colour, with its emoji (or the first letter of
 * its name) on it. A computer keeps the row's usual picture: both are drawn and the width chooses, so the server's markup is right at once.
 */
export const topicLead: RowLead = (row, tall, usual) => {
  if (row.kind !== "TOPIC") return usual;
  return (
    <>
      <span aria-hidden="true" data-topic-icon={row.id} className={cn("grid shrink-0 place-items-center rounded-full rounded-es-md font-semibold text-on-photo md:hidden", topicColourOf(row.id), tall ? "size-12 text-xl" : "size-11 text-lg", tall && "mx-1")}>
        {topicGlyphOf(row)}
      </span>
      {React.cloneElement(usual, { className: cn((usual.props as { className?: string }).className, "max-md:hidden") })}
    </>
  );
};
