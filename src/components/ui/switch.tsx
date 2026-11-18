"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

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
      className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60", checked ? "border-accent bg-accent" : "border-border bg-surface-2", className)}
    >
      <span className={cn("inline-block size-5 rounded-full bg-surface shadow transition-transform", checked ? "-translate-x-6" : "-translate-x-1")} />
    </button>
  );
}
