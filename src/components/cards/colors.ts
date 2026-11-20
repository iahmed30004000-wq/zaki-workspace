import type { CardColor } from "@/lib/cards/shared";

/**
 * A card's colour is a theme token name; these are the class names it becomes. Written out in full (never built from
 * a string) so Tailwind sees every class, and only tokens: a theme restyles every card, and no hex value appears.
 */
export const COLOR_STYLE: Record<CardColor, { card: string; dot: string }> = {
  none: { card: "border-transparent bg-surface-1", dot: "bg-surface-2" },
  accent: { card: "border-accent/40 bg-accent/10", dot: "bg-accent" },
  ok: { card: "border-ok/40 bg-ok/10", dot: "bg-ok" },
  warn: { card: "border-warn/40 bg-warn/10", dot: "bg-warn" },
  danger: { card: "border-danger/40 bg-danger/10", dot: "bg-danger" },
  info: { card: "border-info/40 bg-info/10", dot: "bg-info" },
  "cat-1": { card: "border-cat-1/40 bg-cat-1/10", dot: "bg-cat-1" },
  "cat-2": { card: "border-cat-2/40 bg-cat-2/10", dot: "bg-cat-2" },
  "cat-3": { card: "border-cat-3/40 bg-cat-3/10", dot: "bg-cat-3" },
  "cat-4": { card: "border-cat-4/40 bg-cat-4/10", dot: "bg-cat-4" },
  "cat-5": { card: "border-cat-5/40 bg-cat-5/10", dot: "bg-cat-5" },
  "cat-6": { card: "border-cat-6/40 bg-cat-6/10", dot: "bg-cat-6" },
};
