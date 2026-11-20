"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The look of every switch in the app (the owner's mockup, Telegram's): a 42x24 pill, muted when off and the accent when on, with an 18 px white knob that moves
 * toward the start edge in a right-to-left page. `Switch` and the whole-row `SwitchRow` (members/switch-row.tsx) both draw this one track, so they cannot drift apart.
 */
export function SwitchTrack({ checked, children, className }: { checked: boolean; children?: React.ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-switch-track=""
      className={cn("relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-full transition-colors duration-150", checked ? "bg-accent" : "bg-badge-muted", className)}
    >
      <span
        className={cn(
          "absolute start-[3px] top-[3px] grid size-[18px] place-items-center rounded-full bg-on-photo shadow-card transition-transform duration-150 motion-reduce:transition-none",
          checked && "ltr:translate-x-[18px] rtl:-translate-x-[18px]",
        )}
      >
        {children}
      </span>
    </span>
  );
}

/** A switch (D1): an on/off setting. The accent when on; the knob moves toward the start in a right-to-left page. */
export function Switch({ checked, onChange, label, disabled = false, className }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("inline-flex shrink-0 items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60", className)}
    >
      <SwitchTrack checked={checked} />
    </button>
  );
}
