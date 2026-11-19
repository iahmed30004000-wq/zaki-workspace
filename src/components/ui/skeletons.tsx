import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/**
 * F1.6 — the loading skeletons of the places: one frame, a handful of shapes, each drawn from the ONE `Skeleton` block (D1's primitive) and the theme
 * tokens, so every theme reskins them. A place's `loading.tsx` is one line: `return <ListSkeleton place="files" />`.
 *
 * - **Shaped like the page.** The frame wears the SAME outer classes as the page it stands for (`PLACE_FRAMES`; a test reads the page's source and fails when
 *   the two drift apart), so the width, the padding and the gap do not jump when the page arrives. Inside it: a header, a toolbar, rows, boxed sections, cards,
 *   a table, a day, a player, a document — whichever the page is made of.
 * - **Calm.** The blocks pulse softly; they hold still under `prefers-reduced-motion` (the `Skeleton` itself) and in «وضع التوفير» (the shell marks <html> with
 *   `data-decor-economy`; `STILL` reads it). Nothing here animates by itself otherwise.
 * - **Silent to a screen reader except for one line.** The frame is a polite, busy status that says «جارٍ التحميل…»; every drawing is `aria-hidden`.
 * - **Only logical properties** (start/end, ms/me, ps/pe), no colour but the tokens, no Latin text, and no words at all besides the status line.
 * - **Server only, and pure.** No hook, no provider, no clock, no random number, no data: the same markup every time, so nothing can mismatch and a loading
 *   file never waits for the database. It does NOT ask who is looking, so it promises nobody anything.
 *
 * A place whose page is about to change in a later step (my work, projects and boards, the requests, the owner's and the settings screens, the calendar and
 * the list) is not here: that step shapes its own skeleton. `src/app/(app)/loading.tsx` (the whole app, with the tip) and `chat/loading.tsx` are C2.1's.
 */

/** The outer classes of each place's page. Two places may share one (the two desks); a test pins each to the page's own source. */
export const PLACE_FRAMES = {
  files: "mx-auto max-w-5xl space-y-4 p-4",
  documents: "mx-auto max-w-5xl space-y-3 p-4",
  knowledge: "mx-auto max-w-3xl space-y-4 p-4",
  tickets: "mx-auto max-w-4xl space-y-6 p-4 md:p-6",
  departments: "mx-auto max-w-5xl space-y-4 p-4",
  goals: "mx-auto max-w-4xl space-y-4 p-4 md:p-6",
  ideas: "mx-auto max-w-3xl space-y-4 p-4 md:p-6",
  campaigns: "mx-auto max-w-4xl space-y-6 p-4 md:p-6",
  crm: "space-y-4",
  production: "mx-auto max-w-4xl space-y-4 p-4 md:p-6",
  watch: "mx-auto max-w-6xl gap-4 p-0 md:p-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start",
  time: "mx-auto w-full max-w-5xl space-y-4 px-4 py-4 md:px-6 md:py-6",
  checkins: "mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:px-6 md:py-6",
  cards: "mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6",
  archive: "mx-auto max-w-5xl space-y-5 p-4 sm:p-6",
} as const;

export type PlaceName = keyof typeof PLACE_FRAMES;
type Shape = "list" | "sections" | "grid" | "document" | "table" | "schedule" | "room";

/** «وضع التوفير»: the shell marks <html data-decor-economy>; a block under it holds still. (Reduced motion is the Skeleton's own `motion-reduce:`.) */
const STILL = "[[data-decor-economy]_&]:animate-none";

/** The widths a run of lines takes in turn: a ragged edge, the same every time (never a random number). */
const WIDTHS = ["w-3/5", "w-2/5", "w-4/5", "w-1/2", "w-3/4", "w-2/3"] as const;
const widthAt = (index: number): string => WIDTHS[index % WIDTHS.length] as string;

const times = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

function Block({ className }: { className?: string }): React.JSX.Element {
  return <Skeleton className={cn(STILL, className)} />;
}

/** The frame: a polite, busy status with the one line a screen reader gets; everything inside is decoration. */
function Frame({ place, shape, children }: { place: PlaceName; shape: Shape; children: React.ReactNode }): React.JSX.Element {
  const { t } = getServerT();
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-skeleton-shape={shape} className={PLACE_FRAMES[place]}>
      {children}
      {/* LAST, not first: the page's `space-y-*` puts its gap before every child but the first, and the status line is out of the flow (sr-only is absolute),
          so as the first child it would push the first block down by a gap the page does not have. */}
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}

/** A title, a line under it, and (when the page has one) the button at the end. */
function Header({ action = true }: { action?: boolean }): React.JSX.Element {
  return (
    <div aria-hidden="true" data-skeleton-part="header" className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <Block className="h-6 w-40 max-w-full" />
        <Block className="h-4 w-64 max-w-full" />
      </div>
      {action ? <Block className="h-9 w-24 shrink-0 rounded-lg" /> : null}
    </div>
  );
}

/** The strip of filters, periods or tabs above a list. */
function Toolbar(): React.JSX.Element {
  return (
    <div aria-hidden="true" data-skeleton-part="toolbar" className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <Block className="h-7 w-16 rounded-md" />
        <Block className="h-7 w-16 rounded-md" />
        <Block className="h-7 w-16 rounded-md" />
      </div>
      <Block className="h-7 w-24 rounded-md" />
    </div>
  );
}

/** A row of a list: a picture, two lines, a chip at the end. */
function Row({ index }: { index: number }): React.JSX.Element {
  return (
    <div aria-hidden="true" data-skeleton-part="row" className="flex min-h-14 w-full items-center gap-3 border-b border-border px-3 py-2">
      <Block className="size-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Block className={cn("h-4 max-w-full", widthAt(index))} />
        <Block className={cn("h-3 max-w-full", widthAt(index + 2))} />
      </div>
      <Block className="h-5 w-14 shrink-0 rounded-full" />
    </div>
  );
}

function Rows({ count }: { count: number }): React.JSX.Element {
  return (
    <div aria-hidden="true">
      {times(count).map((i) => (
        <Row key={i} index={i} />
      ))}
    </div>
  );
}

/**
 * Header, (the page's form,) (a toolbar,) rows: files, goals, ideas, check-ins, the archive. Three independent choices: `action` (the header's button),
 * `composer` (the page's form, a title and a box, before the list) and `toolbar` (the strip of filters or periods).
 */
export function ListSkeleton({
  place,
  action = true,
  composer = false,
  toolbar = true,
  rows = 8,
}: {
  place: PlaceName;
  action?: boolean;
  composer?: boolean;
  toolbar?: boolean;
  rows?: number;
}): React.JSX.Element {
  return (
    <Frame place={place} shape="list">
      <Header action={action} />
      {composer ? (
        <div aria-hidden="true" data-skeleton-part="composer" className="space-y-2 rounded-xl border border-border bg-surface p-4">
          <Block className="h-10 w-full rounded-lg" />
          <Block className="h-16 w-full rounded-lg" />
          <div className="flex justify-end">
            <Block className="h-9 w-24 rounded-lg" />
          </div>
        </div>
      ) : null}
      {toolbar ? <Toolbar /> : null}
      <Rows count={rows} />
    </Frame>
  );
}

/** A heading and boxed lists, one after the other: the tickets and the campaigns desks. */
export function SectionsSkeleton({ place, sections = 2, rows = 3 }: { place: PlaceName; sections?: number; rows?: number }): React.JSX.Element {
  return (
    <Frame place={place} shape="sections">
      <div aria-hidden="true" data-skeleton-part="header" className="flex items-center gap-3">
        <Block className="h-7 w-40 min-w-0 max-w-full flex-1" />
        <Block className="h-9 w-28 shrink-0 rounded-lg" />
      </div>
      {times(sections).map((s) => (
        <div key={s} aria-hidden="true" data-skeleton-part="section" className="space-y-2 rounded-xl border border-border bg-surface-1 p-4">
          <Block className="h-4 w-32 max-w-full" />
          <div className="divide-y divide-border">
            {times(rows).map((i) => (
              <div key={i} className="flex min-h-11 items-center gap-2 py-2">
                <Block className="h-4 w-16 shrink-0" />
                <Block className={cn("h-4 min-w-0 max-w-full flex-1", widthAt(i + s))} />
                <Block className="h-5 w-16 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </Frame>
  );
}

/** A header and a grid of cards, two across from the small breakpoint: the departments. */
export function GridSkeleton({ place, cards = 6 }: { place: PlaceName; cards?: number }): React.JSX.Element {
  return (
    <Frame place={place} shape="grid">
      <Header />
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2">
        {times(cards).map((i) => (
          <div key={i} data-skeleton-part="card" className="space-y-3 rounded-xl border border-border bg-surface-1 p-4">
            <div className="flex items-center gap-3">
              <Block className="size-10 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Block className={cn("h-4 max-w-full", widthAt(i))} />
                <Block className="h-3 w-1/3 max-w-full" />
              </div>
            </div>
            <Block className="h-3 w-full" />
            <Block className={cn("h-3 max-w-full", widthAt(i + 3))} />
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** A title, a toolbar and lines of text: a document, a knowledge sheet, a card's page. */
export function DocumentSkeleton({ place, lines = 8 }: { place: PlaceName; lines?: number }): React.JSX.Element {
  return (
    <Frame place={place} shape="document">
      <div aria-hidden="true" data-skeleton-part="title" className="space-y-2">
        <Block className="h-8 w-2/3 max-w-full" />
        <Block className="h-4 w-48 max-w-full" />
      </div>
      <div aria-hidden="true" data-skeleton-part="toolbar" className="flex items-center gap-2">
        <Block className="h-8 w-20 rounded-md" />
        <Block className="h-8 w-20 rounded-md" />
        <Block className="h-8 w-20 rounded-md" />
      </div>
      <div aria-hidden="true" className="space-y-3 rounded-xl border border-border bg-surface-1 p-4">
        {times(lines).map((i) => (
          <div key={i} data-skeleton-part="line">
            <Block className={cn("h-4 max-w-full", i % 4 === 3 ? "w-1/2" : "w-full")} />
          </div>
        ))}
      </div>
    </Frame>
  );
}

/**
 * What leads a table, then a head row and rows of cells. `lead="tabs"` is the customers' screen (two tabs and a button, no title of its own);
 * `lead="filters"` is the time report (a title, a subtitle and a bar of labelled fields).
 */
export function TableSkeleton({
  place,
  lead = "tabs",
  rows = 8,
  columns = 4,
}: {
  place: PlaceName;
  lead?: "tabs" | "filters";
  rows?: number;
  columns?: number;
}): React.JSX.Element {
  return (
    <Frame place={place} shape="table">
      {lead === "tabs" ? (
        <div aria-hidden="true" data-skeleton-part="tabs" className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg border border-border bg-surface-1 p-1">
            <Block className="h-8 w-24 rounded-md" />
            <Block className="h-8 w-24 rounded-md" />
          </div>
          <Block className="h-9 w-28 rounded-lg" />
        </div>
      ) : (
        <>
          <Header action={false} />
          <div aria-hidden="true" data-skeleton-part="filters" className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-1 p-3">
            {times(4).map((i) => (
              <div key={i} className="space-y-1">
                <Block className="h-3 w-12" />
                <Block className="h-9 w-32 rounded-lg" />
              </div>
            ))}
            <Block className="h-9 w-20 rounded-lg" />
          </div>
        </>
      )}
      <div aria-hidden="true" className="overflow-hidden rounded-xl border border-border bg-surface-1">
        <div data-skeleton-part="table-head" className="flex items-center gap-3 border-b border-border bg-surface-2 px-3 py-2">
          {times(columns).map((c) => (
            <Block key={c} className="h-3 min-w-0 flex-1" />
          ))}
        </div>
        {times(rows).map((r) => (
          <div key={r} data-skeleton-part="row" className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2">
            {times(columns).map((c) => (
              <Block key={c} className={cn("h-4 min-w-0 max-w-full flex-1", c === 0 ? widthAt(r) : "w-full")} />
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** A header, a bar with the day and its two arrows, and the items of that day: the production schedule. */
export function ScheduleSkeleton({ place, items = 5 }: { place: PlaceName; items?: number }): React.JSX.Element {
  return (
    <Frame place={place} shape="schedule">
      <Header />
      <div aria-hidden="true" data-skeleton-part="day-bar" className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2">
        <Block className="size-8 rounded-lg" />
        <div className="space-y-2">
          <Block className="mx-auto h-4 w-32" />
          <Block className="mx-auto h-3 w-20" />
        </div>
        <Block className="size-8 rounded-lg" />
      </div>
      <div aria-hidden="true" className="space-y-2">
        {times(items).map((i) => (
          <div key={i} data-skeleton-part="row" className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
            <Block className="size-6 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Block className={cn("h-4 max-w-full", widthAt(i))} />
              <Block className="h-3 w-1/4 max-w-full" />
            </div>
            <Block className="h-5 w-14 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** The player (16:9) with its title under it, and the column beside it from the large breakpoint: the watch room. */
export function RoomSkeleton({ place, comments = 4 }: { place: PlaceName; comments?: number }): React.JSX.Element {
  return (
    <Frame place={place} shape="room">
      <div aria-hidden="true" data-skeleton-part="stage" className="min-w-0 space-y-3">
        <Block className="aspect-video w-full rounded-none md:rounded-xl" />
        <div className="space-y-2 px-4 md:px-0">
          <Block className="h-6 w-2/3 max-w-full" />
          <Block className="h-4 w-1/3 max-w-full" />
        </div>
      </div>
      <div aria-hidden="true" data-skeleton-part="side" className="mt-4 space-y-3 px-4 md:px-0 lg:mt-0">
        {times(comments).map((i) => (
          <div key={i} className="flex items-start gap-2">
            <Block className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Block className="h-3 w-1/3 max-w-full" />
              <Block className={cn("h-4 max-w-full", widthAt(i))} />
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}
