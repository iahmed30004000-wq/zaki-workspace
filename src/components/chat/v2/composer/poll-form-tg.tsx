"use client";

import React from "react";
import { CirclePlus, Clock, Eye, ListChecks, LoaderCircle, Menu, X, type LucideIcon } from "lucide-react";
import { SwitchTrack } from "@/components/ui/switch";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";
import { dragTargetIndex, moveOption, pollRoomKey, pollRoomLeft, POLL_CLOSE_CHOICES, POLL_MIN_OPTIONS, POLL_OPTION_MAX, POLL_QUESTION_MAX, type PollDraft } from "@/lib/chat/poll-client";

/**
 * «استطلاع» on a phone with Telegram's look: «سؤال», «الخيارات» (a handle to drag each one, «إضافة خيار…», how many more fit) and «الإعدادات», a row with a
 * switch for each choice the poll really has: whether the voters' names show (the opposite of «تصويت سري»), more than one answer, and a duration. Nothing the
 * server cannot store is drawn (no description, no adding by others, no shuffle, no right answer). It is drawn in the attach sheet, at half height or as the
 * full page. No `<form>`: it sits in a portal inside the composer's own form, whose submit it must never reach.
 */
const CARD = "mx-2 rounded-2xl bg-surface-1";
const HEADING = "px-4 pt-3 text-sm font-bold text-accent";
/** The duration a person gets when they turn the switch on: a day. */
const DEFAULT_DURATION = 1440;

/** «إنشاء»: dim until the draft can be sent. It stands in the question's card at half height and in the bar of the full page. */
export function PollCreateButton({ disabled, busy, onCreate }: { disabled: boolean; busy: boolean; onCreate: () => void }) {
  return (
    <button type="button" data-poll-create="" disabled={disabled || busy} onClick={onCreate} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg transition-opacity disabled:opacity-40">
      {busy ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" /> : null}
      {ct("tgsheets.poll.create")}
    </button>
  );
}

function SwitchLine({ id, icon: Icon, tile, title, hint, checked, onChange }: { id: string; icon: LucideIcon; tile: string; title: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} data-poll-switch={id} onClick={() => onChange(!checked)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start">
      <span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-on-photo", tile)}>
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-5 text-fg">{title}</span>
        <span className="block text-xs leading-5 text-fg-muted">{hint}</span>
      </span>
      <SwitchTrack checked={checked} />
    </button>
  );
}

export function TgPollForm({ draft, onChange, error, action }: { draft: PollDraft; onChange: (patch: Partial<PollDraft>) => void; error: string; /** «إنشاء» at the end of the question's heading (half height); the full page has it in its bar */ action?: React.ReactNode }) {
  const inputs = React.useRef<(HTMLInputElement | null)[]>([]);
  const [focusAt, setFocusAt] = React.useState<number | null>(null);
  const [dragging, setDragging] = React.useState<number | null>(null);
  const drag = React.useRef<{ pointer: number; from: number; at: number; y: number; row: number } | null>(null);
  const options = React.useRef(draft.options);
  options.current = draft.options;
  React.useEffect(() => {
    if (focusAt === null) return;
    inputs.current[focusAt]?.focus();
    setFocusAt(null);
  }, [focusAt]);
  const left = pollRoomLeft(draft);
  const addOption = () => {
    if (left === 0) return;
    onChange({ options: [...draft.options, ""] });
    setFocusAt(draft.options.length);
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointer: event.pointerId, from: index, at: index, y: event.clientY, row: event.currentTarget.closest("li")?.offsetHeight ?? 48 };
    setDragging(index);
  };
  const moveDrag = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    const target = dragTargetIndex(d.from, event.clientY - d.y, d.row, options.current.length);
    if (target === d.at) return;
    onChange({ options: moveOption(options.current, d.at, target) });
    d.at = target;
    setDragging(target);
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(null);
  };
  /** The handle by the keyboard: the arrows move the option, and the focus goes with it. */
  const onHandleKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const target = index + step;
    if (step === 0 || target < 0 || target >= draft.options.length) return;
    event.preventDefault();
    onChange({ options: moveOption(draft.options, index, target) });
    const list = event.currentTarget.closest("ul");
    requestAnimationFrame(() => list?.querySelector<HTMLButtonElement>(`[data-poll-handle="${target}"]`)?.focus());
  };

  return (
    <div data-poll-form="" className="flex flex-col gap-3 pb-4 text-fg">
      <section className={CARD}>
        <div className="flex items-center justify-between gap-2 px-4 pt-2">
          <label htmlFor="tg-poll-question" className="text-sm font-bold text-accent">
            {ct("tgsheets.poll.question")}
          </label>
          {action}
        </div>
        <textarea id="tg-poll-question" rows={1} maxLength={POLL_QUESTION_MAX} value={draft.question} placeholder={ct("tgsheets.poll.question_placeholder")} onChange={(e) => onChange({ question: e.currentTarget.value })} className="block max-h-32 min-h-12 w-full resize-none bg-transparent px-4 py-3 text-base outline-none placeholder:text-fg-muted" />
      </section>

      <section>
        <div className={CARD}>
          <h3 className={HEADING}>{ct("tgsheets.poll.options")}</h3>
          <ul>
            {draft.options.map((text, index) => (
              <li key={index} data-poll-row={index} data-dragging={dragging === index ? "" : undefined} className="tg-poll-row flex min-h-12 items-center gap-1 border-b border-border/60 px-2">
                <button
                  type="button"
                  data-poll-handle={index}
                  aria-label={ct("tgsheets.poll.handle", { n: index + 1 })}
                  onPointerDown={(e) => startDrag(e, index)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => onHandleKey(e, index)}
                  className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-full text-fg-muted"
                >
                  <Menu aria-hidden="true" className="size-5" />
                </button>
                <label htmlFor={`tg-poll-option-${index}`} className="sr-only">
                  {ct("chatc.poll.option", { n: index + 1 })}
                </label>
                <input
                  id={`tg-poll-option-${index}`}
                  ref={(el) => {
                    inputs.current[index] = el;
                  }}
                  maxLength={POLL_OPTION_MAX}
                  value={text}
                  placeholder={ct("tgsheets.poll.option")}
                  enterKeyHint="next"
                  onChange={(e) => onChange({ options: draft.options.map((o, i) => (i === index ? e.currentTarget.value : o)) })}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    if (index < draft.options.length - 1) setFocusAt(index + 1);
                    else if (text.trim()) addOption();
                  }}
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fg-muted"
                />
                {draft.options.length > POLL_MIN_OPTIONS ? (
                  <button type="button" data-poll-remove={index} aria-label={ct("chatc.poll.remove_option", { n: index + 1 })} onClick={() => onChange({ options: draft.options.filter((_, i) => i !== index) })} className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted">
                    <X aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {left > 0 ? (
            <button type="button" data-poll-add="" onClick={addOption} className="flex min-h-12 w-full items-center gap-3 px-4 text-start text-[15px] text-accent">
              <CirclePlus aria-hidden="true" className="size-6 shrink-0" />
              {ct("tgsheets.poll.add")}
            </button>
          ) : null}
        </div>
        <p data-poll-room="" role="status" className="px-6 pt-1.5 text-xs text-fg-muted">
          {ct(pollRoomKey(left), { n: left })}
        </p>
      </section>

      <section className={CARD}>
        <h3 className={HEADING}>{ct("tgsheets.poll.settings")}</h3>
        <SwitchLine id="voters" icon={Eye} tile="bg-cat-6" title={ct("tgsheets.poll.voters")} hint={ct("tgsheets.poll.voters_hint")} checked={!draft.anonymous} onChange={(on) => onChange({ anonymous: !on })} />
        <SwitchLine id="multiple" icon={ListChecks} tile="bg-cat-4" title={ct("tgsheets.poll.multiple")} hint={ct("tgsheets.poll.multiple_hint")} checked={draft.multiple} onChange={(on) => onChange({ multiple: on })} />
        <SwitchLine id="duration" icon={Clock} tile="bg-cat-2" title={ct("tgsheets.poll.duration")} hint={ct("tgsheets.poll.duration_hint")} checked={draft.closesInMinutes > 0} onChange={(on) => onChange({ closesInMinutes: on ? DEFAULT_DURATION : 0 })} />
        {draft.closesInMinutes > 0 ? (
          <div role="radiogroup" aria-label={ct("chatc.poll.closes")} className="tg-rows-in flex flex-wrap gap-2 px-4 pb-3 pt-1">
            {POLL_CLOSE_CHOICES.filter((m) => m > 0).map((minutes) => (
              <button key={minutes} type="button" role="radio" aria-checked={draft.closesInMinutes === minutes} data-poll-closes={minutes} onClick={() => onChange({ closesInMinutes: minutes })} className="min-h-9 rounded-full border border-border px-3 text-[13px] aria-checked:border-accent aria-checked:bg-accent/10 aria-checked:font-semibold aria-checked:text-accent">
                {ct(`chatc.poll.closes.${minutes}`)}
              </button>
            ))}
          </div>
        ) : null}
      </section>
      {error ? (
        <p role="alert" className="px-6 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
