import React from "react";
import type { SystemMeta } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";

/**
 * «المساعد»'s answer, drawn as what it is: an AI line in the middle of the conversation, never as a person's bubble. It is a system
 * line in the data (`{k:"assistant", p:{text, err?, first?, read?}}`, src/server/services/chat-assistant.ts), so it follows the
 * conversation's own visibility.
 *
 * ⚠️ + 🔧 stay visible with it: the FIRST answer of a conversation says in full that it read the recent messages of this conversation and
 *    that an external model processed redacted text; every later one carries the short reminder. A refusal (a guest in the
 *    conversation, no key, a limit) is a notice in the warning colour, not an answer.
 */
export function AssistantLine({ meta, time, createdAt }: { meta: SystemMeta; time: string; createdAt: string }) {
  const p = meta.p ?? {};
  const text = typeof p["text"] === "string" ? p["text"] : "";
  const refusal = typeof p["err"] === "string";
  const first = p["first"] === 1;
  const read = typeof p["read"] === "number" ? p["read"] : 0;
  return (
    <div role="note" dir="rtl" data-assistant-line={refusal ? "refusal" : "answer"} className="my-3 flex justify-center px-3">
      <div className={`w-full max-w-xl rounded-2xl border px-3 py-2 ${refusal ? "border-warn/40 bg-warn/10" : "border-info/30 bg-info/10"}`}>
        <p className="mb-1 flex items-center gap-2 text-xs font-semibold">
          <span aria-hidden="true" className="text-info">✦</span>
          <span>{ct("chatai.label")}</span>
          <span className="rounded-full bg-info/15 px-2 py-0.5 text-info">{ct("chatai.badge")}</span>
          <time dateTime={createdAt} dir="ltr" className="ms-auto font-normal tabular-nums text-fg-muted">{time}</time>
        </p>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
        {!refusal && (
          <div className="mt-2 border-t border-border pt-1 text-xs text-fg-muted">
            {first ? (
              <>
                <p>{ct("chatai.note_first", { read })}</p>
                <p className="mt-0.5">{ct("chatai.fix_first")}</p>
              </>
            ) : (
              <p>{ct("chatai.note_short")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
