import Link from "next/link";
import { ArtSlot } from "@/components/theme/art-slot";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-[14px] bg-surface-1", className)}>{children}</div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("border-b border-border px-4 py-3", className)}>{children}</div>;
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

export function Badge({
  children,
  color,
  className,
}: {
  children: React.ReactNode;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-fg-muted",
        className,
      )}
    >
      {color ? <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} /> : null}
      {children}
    </span>
  );
}

/**
 * What a list says when it has nothing in it — and what to do about it: no dead ends, every empty page says
 * the next step (`action`).
 *
 * An empty list is one of the four places the decoration layer may be drawn (nothing is being measured here;
 * the moment a row appears the row is what is on screen). The layer sits behind the words (`ThemeDecor
 * kind="empty"`); `art` adds the owner's drawing above the title once its file exists in `public/brand/art/`
 * (it removes itself while the file is missing, so nothing is ever broken).
 */
export function EmptyState({
  title,
  hint,
  children,
  art,
  action,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
  /** The slot of the owner's artwork, e.g. "empty-tasks" (`ART_SLOTS` in src/lib/themes/decor.ts). A name that is not an agreed slot is ignored. */
  art?: string;
  /** The next step, as a button link. */
  action?: { label: string; href: string };
}) {
  return (
    <div className="relative isolate flex flex-col items-center justify-center overflow-hidden rounded-[14px] bg-surface-1 px-4 py-7 text-center">
      <ThemeDecor kind="empty" />
      {/* The words are positioned too: a positioned layer paints over a static one, whatever the order of the markup. */}
      <div className="relative z-10 flex flex-col items-center gap-2">
        {art ? <ArtSlot slot={art} className="mb-1 max-h-36 w-auto rounded-2xl" /> : null}
        <p className="text-sm font-semibold text-fg">{title}</p>
        {hint ? <p className="text-[13px] text-fg-muted">{hint}</p> : null}
        {children}
        {action ? (
          <Link
            href={action.href}
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
          >
            {action.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
