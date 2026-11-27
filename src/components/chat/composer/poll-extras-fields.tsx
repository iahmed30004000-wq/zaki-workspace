"use client";

import React from "react";
import { ct } from "@/lib/chat/text";
import { POLL_EXPLANATION_MAX, quizPatch, type PollDraft } from "@/lib/chat/poll-client";

/**
 * «خيارات إضافية للاستطلاع» (the switch `chatPollExtras`), shared by the dialog and the phone's form so both offer the same: «اختبار» (with the right answer and the
 * line shown after answering), «يقدر غيري يضيف خيار», «النتائج بتظهر بعد الإغلاق», «بدون تغيير التصويت», «ترتيب عشوائي». The server checks every one again.
 * No `<form>` here: both places sit inside the composer's own.
 */
function Choice({ id, title, hint, checked, onChange }: { id: string; title: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-start gap-2 py-1 text-sm">
      <input type="checkbox" data-poll-extra={id} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} className="mt-1 size-4 shrink-0" />
      <span className="min-w-0">
        <span className="block">{title}</span>
        <span className="block text-xs text-fg-muted">{hint}</span>
      </span>
    </label>
  );
}

export function PollExtrasFields({ draft, onChange }: { draft: PollDraft; onChange: (patch: Partial<PollDraft>) => void }) {
  const quiz = draft.quiz === true;
  const answers = draft.options.map((text, index) => ({ text: text.trim(), index })).filter((o) => o.text);
  return (
    <div data-poll-extras="" className="flex flex-col">
      <Choice id="quiz" title={ct("tgx.poll.quiz")} hint={ct("tgx.poll.quiz_hint")} checked={quiz} onChange={(on) => onChange(quizPatch(on))} />
      {quiz ? (
        <div className="mb-2 flex flex-col gap-1 ps-6">
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium">{ct("tgx.poll.right_answer")}</legend>
            {answers.length === 0 ? <p className="text-xs text-fg-muted">{ct("tgx.poll.right_answer_empty")}</p> : null}
            {answers.map((o) => (
              <label key={o.index} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name="poll-correct" data-poll-correct={o.index} checked={draft.correct === o.index} onChange={() => onChange({ correct: o.index })} className="size-4 shrink-0" />
                <span dir="auto" className="min-w-0 [overflow-wrap:anywhere]">
                  {o.text}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{ct("tgx.poll.explanation")}</span>
            <textarea rows={2} dir="auto" data-poll-explanation-input="" maxLength={POLL_EXPLANATION_MAX} value={draft.explanation ?? ""} onChange={(e) => onChange({ explanation: e.currentTarget.value })} placeholder={ct("tgx.poll.explanation_placeholder")} className="w-full resize-none rounded-lg border border-muted bg-surface px-3 py-2 text-base md:text-sm" />
          </label>
        </div>
      ) : (
        <>
          <Choice id="open" title={ct("tgx.poll.open_options")} hint={ct("tgx.poll.open_options_hint")} checked={draft.openOptions === true} onChange={(on) => onChange({ openOptions: on })} />
          <Choice id="norevote" title={ct("tgx.poll.no_revote")} hint={ct("tgx.poll.no_revote_hint")} checked={draft.noRevote === true} onChange={(on) => onChange({ noRevote: on })} />
        </>
      )}
      <Choice id="hide" title={ct("tgx.poll.hide_results")} hint={ct("tgx.poll.hide_results_hint")} checked={draft.hideResults === true} onChange={(on) => onChange({ hideResults: on })} />
      <Choice id="shuffle" title={ct("tgx.poll.shuffle")} hint={ct("tgx.poll.shuffle_hint")} checked={draft.shuffle === true} onChange={(on) => onChange({ shuffle: on })} />
    </div>
  );
}
