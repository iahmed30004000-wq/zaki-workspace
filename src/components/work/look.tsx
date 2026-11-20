import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The look of «الشغل» (the owner's Telegram-like mock-up): the pieces every work screen draws the same way, written once so «مهامي», a project's list, the requests
 * inbox and the tickets desk cannot drift apart. Theme tokens and logical properties only (the render tests forbid a palette colour and a physical side).
 *
 *  - `WORK_LIST` — the white rounded card a group of rows sits in (`.list`); rows inside it are divided by a hairline, the last one has none.
 *  - `GROUP_HEADING` — «متأخرة · 1»: the bold quiet line above a group (`.grp`).
 *  - `WORK_SELECT` / `WORK_SEARCH` — a quiet field on the `surface-2` ground, no outline (`.search`, a select beside the segmented controls).
 *  - `Pill` — a filter chip (`.chip`): pressed is the soft accent (the same as the current tab), not a second kind of blue.
 *  - `STATE_CHIP` — a state as a soft chip (`.chip.ok / .wr / .dg / .ac`).
 */
export const WORK_LIST = "overflow-hidden rounded-2xl bg-surface-1";
export const GROUP_HEADING = "flex items-center gap-2 px-1 pb-1.5 pt-3.5 text-[13px] font-bold text-fg-muted";
export const WORK_SELECT =
  "min-h-9 rounded-[10px] border-0 bg-surface-2 px-2.5 text-[13.5px] font-semibold text-fg-muted transition-colors hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
export const WORK_SEARCH =
  "min-h-9 w-44 rounded-full border-0 bg-surface-2 px-3.5 text-[13.5px] text-fg placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent md:w-52";

export type StateTone = "neutral" | "accent" | "ok" | "warn" | "danger";
export const STATE_CHIP: Record<StateTone, string> = {
  neutral: "bg-surface-2 text-fg-muted",
  accent: "bg-accent/10 text-accent",
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
  danger: "bg-danger/10 text-danger",
};

/** The tone of a work stage (the mock-up: التنفيذ is the accent, المراجعة a warning, الإنجاز the green one). */
export const STAGE_TONE: Record<string, StateTone> = { TODO: "neutral", DOING: "accent", REVIEW: "warn", DONE: "ok" };

/** A project's status as a soft chip: active is the accent, done is green, on hold is a warning, at risk is red. */
export const PROJECT_TONE: Record<string, StateTone> = { ACTIVE: "accent", COMPLETED: "ok", ON_HOLD: "warn", AT_RISK: "danger" };

/** A small state word as a chip (a stage, «بانتظار جواب», «متأخرة»). */
export function StateChip({ tone = "neutral", className, children }: { tone?: StateTone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold", STATE_CHIP[tone], className)}>{children}</span>;
}

/** What a work list says when it is empty (`.emp`): two quiet lines, no frame; the next step is the hint. */
export function QuietEmpty({ title, hint, className }: { title: string; hint?: string; className?: string }) {
  return (
    <div className={cn("px-4 py-14 text-center text-fg-muted", className)}>
      <p className="text-[15px]">{title}</p>
      {hint ? <p className="mt-1 text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

/** A filter chip: a toggle (`aria-pressed`). */
export function Pill({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        pressed ? "bg-accent/10 text-accent" : "bg-surface-2 text-fg-muted hover:bg-surface-2/70 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
