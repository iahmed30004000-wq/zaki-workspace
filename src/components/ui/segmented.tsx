"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** A segmented control (D1): two to five exclusive choices in one row; one is selected (the accent); a radio group for the keyboard and for screen readers. */
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
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-[10px] bg-surface-2 p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn("min-h-9 rounded-[8px] px-3 text-sm font-medium transition-colors", on ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
