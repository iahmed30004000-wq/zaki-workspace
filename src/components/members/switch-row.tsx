"use client";

import { useId, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { SwitchTrack } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * One on/off switch with a title and a one-line explanation. The whole row is the control (a real
 * `role="switch"` button, at least 56px tall), so a thumb finds it easily; the knob slides toward the
 * reading direction's end (it mirrors in right-to-left).
 */
export function SwitchRow({
  checked,
  onChange,
  title,
  hint,
  disabled = false,
  busy = false,
  waiting = false,
  tag,
  note,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  hint?: string;
  /** The switch cannot be used at all (locked): a real disabled control. */
  disabled?: boolean;
  /** This switch is being saved right now: shows a spinner in the knob. */
  busy?: boolean;
  /** Another switch is being saved: this one waits, but keeps the keyboard focus it may have. */
  waiting?: boolean;
  /** A small label under the title (for example "حسب الرتبة"). */
  tag?: ReactNode;
  /** An extra line under the explanation (for example a warning with its fix). */
  note?: ReactNode;
}) {
  const id = useId();
  const titleId = `${id}-t`;
  const hintId = `${id}-h`;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={titleId}
      aria-describedby={hint ? hintId : undefined}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => {
        if (!waiting && !busy) onChange(!checked);
      }}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-start transition-colors",
        disabled ? "cursor-not-allowed opacity-60" : "hover:bg-surface-2",
        waiting && "opacity-70",
      )}
    >
      <span className="min-w-0 flex-1 space-y-0.5">
        <span id={titleId} className="block text-sm font-medium text-fg">
          {title}
        </span>
        {hint ? (
          <span id={hintId} className="block text-xs leading-5 text-fg-muted">
            {hint}
          </span>
        ) : null}
        {tag ? <span className="block text-xs">{tag}</span> : null}
        {note ? <span className="block text-xs leading-5">{note}</span> : null}
      </span>
      <SwitchTrack checked={checked}>{busy ? <Loader2 className="size-3 animate-spin text-muted" /> : null}</SwitchTrack>
    </button>
  );
}
