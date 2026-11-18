import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A row of a list (D1: working screens are full-width lists with thin dividers, not cards). A leading picture, a title with an optional second line, a
 * trailing slot (a time, a badge); the selected row uses the `selected-row` tokens. Pass `href`-like behaviour through `as`/`onClick`; the row itself is a plain
 * element so a link or a button can wrap it.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  selected = false,
  className,
  ...rest
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <div
      {...rest}
      data-selected={selected ? "true" : undefined}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 border-b border-border px-3 py-2 text-start transition-colors",
        selected ? "bg-selected-row text-selected-row-fg" : "hover:bg-surface-2",
        className,
      )}
    >
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-[1.45]">{title}</span>
        {subtitle ? <span className="block truncate text-[13px] leading-[1.45] text-fg-muted">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-xs text-fg-muted tabular-nums">{trailing}</span> : null}
    </div>
  );
}
