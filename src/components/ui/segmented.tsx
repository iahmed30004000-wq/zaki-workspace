"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The option the arrow key lands on (null = the key is not ours). Up and down always go back and forward; left and right follow the reading direction, so in a
 * right-to-left page the left arrow goes FORWARD.
 */
export function nextSegment(count: number, index: number, key: string, rtl: boolean): number | null {
  if (count <= 0) return null;
  const forward = key === "ArrowDown" || (key === (rtl ? "ArrowLeft" : "ArrowRight"));
  const back = key === "ArrowUp" || (key === (rtl ? "ArrowRight" : "ArrowLeft"));
  if (forward) return (index + 1) % count;
  if (back) return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** A segmented control (D1): two to five exclusive choices in one row; one is selected (the accent); a radio group for the keyboard (one tab stop, arrows inside) and for screen readers. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: React.ReactNode }>;
  onChange: (value: T) => void;
  /** the group's accessible name */
  label: string;
  className?: string;
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-[10px] bg-surface-2 p-0.5", className)}
      onKeyDown={(e) => {
        const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
        const to = nextSegment(options.length, at, e.key, rtl);
        if (to === null) return;
        e.preventDefault();
        onChange(options[to]!.value);
        refs.current[to]?.focus();
      }}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-9 rounded-[8px] px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              on ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
