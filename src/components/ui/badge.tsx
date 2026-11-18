import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A small label or a counter (D1). Status colours only for status (ok, warn, danger, info); the accent is for what is NEW for the person (an unread count); `muted`
 * (the `badge-muted` token) is a count in a conversation they muted. Numbers are tabular.
 */
export type BadgeTone = "neutral" | "accent" | "muted" | "ok" | "warn" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-fg-muted",
  accent: "bg-accent text-accent-fg",
  muted: "bg-badge-muted text-surface-1",
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
};

export function Badge({ tone = "neutral", className, children, ...rest }: { tone?: BadgeTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} data-badge={tone} className={cn("inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold leading-5 tabular-nums", TONES[tone], className)}>
      {children}
    </span>
  );
}

export const BADGE_TONES = Object.keys(TONES) as BadgeTone[];
