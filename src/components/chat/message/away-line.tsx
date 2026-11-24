import React from "react";
import type { SystemMeta } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";

/**
 * «رد تلقائي»: the away line of a person who works outside these hours (src/server/chat/away.ts), drawn in the middle of the conversation as a labelled note — never as a bubble in
 * their name, so nobody mistakes it for something they typed. The words are the person's own, shown as plain text.
 */
export function AwayLine({ meta, time, createdAt }: { meta: SystemMeta; time: string; createdAt: string }) {
  const text = typeof meta.p?.["text"] === "string" ? meta.p["text"] : "";
  if (!text) return null;
  return (
    <div role="note" dir="rtl" data-away-line className="my-3 flex justify-center px-3">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface-1 px-3 py-2 text-fg">
        <p className="mb-1 flex items-center gap-2 text-xs font-semibold">
          <span aria-hidden="true">🌙</span>
          <span>{ct("workhours.label")}</span>
          <time dateTime={createdAt} dir="ltr" className="ms-auto font-normal tabular-nums text-fg-muted">
            {time}
          </time>
        </p>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
