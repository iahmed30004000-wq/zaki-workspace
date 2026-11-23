import React from "react";
import Link from "next/link";
import type { SystemMeta } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";
import { AssistantProposals } from "@/components/chat/message/assistant-proposals";
import { FormattedText } from "@/lib/chat/format/render";

/**
 * «المساعد»'s answer, drawn as what it is: an AI line in the middle of the conversation, never as a person's bubble. It is a system
 * line in the data (`{k:"assistant", p:{text, err?, first?, read?}}`, src/server/services/chat-assistant.ts), so it follows the
 * conversation's own visibility.
 *
 * A local model (`p.local`) is named as such in the note; the ⚠️ stays either way.
 * C3b.1 / C3w.2: the answer is drawn WITH its formatting (bold, code, links: `FormattedText`, the same parser as a bubble) where the screen asks for it (`formatting`:
 * the new pane passes the company's `chatFormatting` switch from the header); the old screen asks nothing and draws plain text as before. The stored answer is already free of math markup.
 * ⚠️ + 🔧 stay visible with it: the FIRST answer of a conversation says in full that it read the recent messages of this conversation and
 *    that an external model processed redacted text; every later one carries the short reminder. A refusal (a guest in the
 *    conversation, no key, a limit) is a notice in the warning colour, not an answer.
 */
export function AssistantLine({ meta, time, createdAt, formatting = false }: { meta: SystemMeta; time: string; createdAt: string; /** `true` only where the screen can say the company's `chatFormatting` is on (the new pane does); the old screen has no switch to read, so its line stays as plain as it was */ formatting?: boolean }) {
  const p = meta.p ?? {};
  const text = typeof p["text"] === "string" ? p["text"] : "";
  const refusal = typeof p["err"] === "string";
  const first = p["first"] === 1;
  // proposals made by this answer (the owner's own conversation): ids of his `AiProposal` rows, drawn as cards below the text
  const props = typeof p["props"] === "string" ? p["props"] : "";
  const read = typeof p["read"] === "number" ? p["read"] : 0;
  // answered by a LOCAL model (the owner's own server): the note names it instead of «an external model»; `relaxed`: the filter was loosened
  const local = p["local"] === 1;
  const relaxed = p["relaxed"] === 1;
  const noteFirst = local ? (relaxed ? "chatai.local_relaxed_first" : "chatai.local_note_first") : "chatai.note_first";
  const noteShort = local ? (relaxed ? "chatai.local_relaxed_short" : "chatai.local_note_short") : "chatai.note_short";
  return (
    <div role="note" dir="rtl" data-assistant-line={refusal ? "refusal" : "answer"} className="my-3 flex justify-center px-3">
      {/* an opaque surface with the theme's own text colour: the words keep their contrast on every theme and over every wallpaper (a tinted see-through card faded on the dark ones) */}
      <div className={`w-full max-w-xl rounded-2xl border bg-surface-1 px-3 py-2 text-fg ${refusal ? "border-warn/60" : "border-info/40"}`}>
        <p className="mb-1 flex items-center gap-2 text-xs font-semibold">
          <span aria-hidden="true" className="text-info">✦</span>
          <span>{ct("chatai.label")}</span>
          <span className="rounded-full border border-info/40 bg-surface-2 px-2 py-0.5 text-fg">{ct("chatai.badge")}</span>
          <time dateTime={createdAt} dir="ltr" className="ms-auto font-normal tabular-nums text-fg-muted">{time}</time>
        </p>
        {formatting && !refusal ? <FormattedText body={text} className="whitespace-pre-wrap break-words text-sm leading-relaxed" /> : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>}
        {refusal && (p["err"] === "key_rejected" || p["err"] === "no_key") ? (
          <Link href="/owner/assistant/settings" data-assistant-fix="" className="mt-2 inline-block rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-accent underline-offset-2 hover:underline">
            {ct("chatai.fix_settings")}
          </Link>
        ) : null}
        {!refusal && props ? <AssistantProposals ids={props} /> : null}
        {!refusal && (
          <div className="mt-2 border-t border-border pt-1 text-xs text-fg-muted">
            {first ? (
              <>
                <p>{ct(noteFirst, { read })}</p>
                <p className="mt-0.5">{ct("chatai.fix_first")}</p>
              </>
            ) : (
              <p>{ct(noteShort)}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
