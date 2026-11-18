"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Clock, LayoutGrid, Layers, Plus } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { goHref } from "@/lib/space-link";
import { parseAddress, type ForeignSpace } from "@/lib/nav/shell-v2";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { WorkspaceCreateModal } from "@/components/create-forms";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** GET /api/workspaces: the spaces the person may open, per organization, and whether they may open a new one there. */
export interface OrgsResponse {
  /** The space the person is in (src/server/services/current-space.ts). */
  currentSpaceId?: string | null;
  organizations: {
    id: string;
    name: string;
    keyPrefix: string;
    role: string;
    /** The `spaces.create` capability in this organization (the server decides, the menu follows). */
    canCreateSpaces: boolean;
    /** `holdsProjects`: false for «الشركة» (HQ), where no project is opened. */
    workspaces: { id: string; name: string; slug: string; holdsProjects?: boolean; emoji?: string | null; unread?: number; overdue?: number }[];
  }[];
  /**
   * N1.3 — only while the company's switch `navV2` is on, and only when the page asked about is ONE thing (a task, a project, …) of another space of
   * the person's: the banner's line. `path` is the page it answers for.
   */
  foreign?: ForeignSpace | null;
}

/** The space the person is in, as the server read it (src/server/services/current-space.ts). */
export interface ShellSpace {
  id: string;
  name: string;
  emoji: string | null;
}

/** The cache key the old shell used too: creating a space (create-forms.tsx) refreshes it. */
export const ORGS_QUERY_KEY = ["orgs"] as const;

/**
 * The one request behind every space number and the banner: `/api/workspaces`. When the page on screen is ONE thing of one space (a task, a
 * project…) its address rides along (`?path=`), so the same answer says whether it belongs to another space (N1.3). Everybody who asks for the
 * spaces uses THIS function (the shell, the switchers, «جديد»): one query key, one request.
 */
export function fetchSpaces(): Promise<OrgsResponse> {
  const here = typeof window === "undefined" ? null : window.location.pathname + window.location.search;
  const asked = here && parseAddress(here) ? `?path=${encodeURIComponent(here)}` : "";
  return apiGet<OrgsResponse>(`/api/workspaces${asked}`);
}

/** The options of the spaces query, for a component that wants them behind its own condition (`enabled`). */
export const SPACES_QUERY = { queryKey: ORGS_QUERY_KEY, queryFn: fetchSpaces, retry: false } as const;

/**
 * The spaces and the one the person is in, kept fresh every minute (the numbers beside the other spaces move while the person works).
 *
 * `sync` makes THIS reader read again after every navigation (a page of another space's task is answered for the new address, and the shell's
 * layout is not drawn again on the way). Exactly ONE reader per page asks for it — the shell's `useCurrentSpace` — because two readers each
 * refetching on a navigation made two requests (F1): the switchers, «جديد» and the banner read the same query without it.
 */
export function useSpaces(sync = false) {
  const pathname = usePathname();
  const query = useQuery({ ...SPACES_QUERY, refetchInterval: 60_000 });
  const { refetch } = query;
  const first = useRef(true);
  useEffect(() => {
    if (!sync) return;
    if (first.current) {
      first.current = false;
      return;
    }
    void refetch();
  }, [sync, pathname, refetch]);
  return query;
}

/** The space the person is in: what the server said for this page, then what it says after each navigation. */
export function useCurrentSpace(initial: ShellSpace | null): ShellSpace | null {
  const { data } = useSpaces(true);
  const id = data?.currentSpaceId;
  if (!id) return initial;
  const found = data.organizations.flatMap((o) => o.workspaces).find((w) => w.id === id);
  return found ? { id: found.id, name: found.name, emoji: found.emoji ?? null } : initial;
}

/**
 * N1.3 — what waits in a space, as two small pills: the unread messages and the overdue tasks (like the unread number beside each account of a
 * messaging app). A zero draws nothing. The pills are decoration; the words for a screen reader are the same numbers with the space's name.
 */
export function CountPills({ name, unread = 0, overdue = 0 }: { name: string; unread?: number; overdue?: number }) {
  const { t } = useI18n();
  return (
    <>
      {unread > 0 ? (
        <>
          <span aria-hidden="true" data-count="unread" className="min-w-5 shrink-0 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-5 text-accent-fg">
            {fmtNumber(unread)}
          </span>
          <span className="sr-only">{t("navv2.space.unread", { name, n: fmtNumber(unread) })}</span>
        </>
      ) : null}
      {overdue > 0 ? (
        <>
          <span aria-hidden="true" data-count="overdue" className="inline-flex min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-full bg-danger px-1.5 text-xs font-bold leading-5 text-danger-fg">
            <Clock aria-hidden="true" className="size-3" />
            {fmtNumber(overdue)}
          </span>
          <span className="sr-only">{t("navv2.space.overdue", { name, n: fmtNumber(overdue) })}</span>
        </>
      ) : null}
    </>
  );
}

/**
 * N1.3 — the spaces as a list that is always open (the phone's drawer header, under «me»): each row enters the space (`/go`) and wears its unread and
 * overdue counts, the one the person is in included, with a check. «كل المساحات» for the owner and the admins. Reads the shell's one query.
 */
export function SpaceList({ current = null, canOverview = false, isGuest = false, onNavigate }: { current?: ShellSpace | null; canOverview?: boolean; isGuest?: boolean; onNavigate?: () => void }) {
  const { t } = useI18n();
  const query = useSpaces();
  const spaces = (query.data?.organizations ?? []).flatMap((org) => org.workspaces);
  return (
    <div data-shell="space-list">
      <ul className="space-y-0.5">
        {spaces.map((space) => {
          const here = space.id === current?.id;
          return (
            <li key={space.id}>
              <a
                href={goHref(space.id)}
                onClick={onNavigate}
                aria-current={here ? "true" : undefined}
                className={cn("flex h-11 items-center gap-2 rounded-xl px-2 text-sm transition-colors hover:bg-surface-2", here ? "bg-accent-2/10 font-semibold text-fg" : "text-fg-muted hover:text-fg")}
              >
                <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center text-base leading-none">
                  {space.emoji ?? ""}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <bdi>{space.name}</bdi>
                </span>
                <CountPills name={space.name} unread={space.unread ?? 0} overdue={space.overdue ?? 0} />
                {here ? <Check aria-hidden="true" className="size-4 shrink-0 text-accent" /> : null}
              </a>
            </li>
          );
        })}
      </ul>
      {canOverview && !isGuest && spaces.length > 0 ? (
        <Link href="/spaces" onClick={onNavigate} className="mt-1 flex h-11 items-center gap-2 rounded-xl px-2 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
          <LayoutGrid aria-hidden="true" className="size-4 text-muted" />
          {t("shell.spaces.all")}
        </Link>
      ) : null}
      {spaces.length === 0 && !query.isLoading ? (
        query.isError ? (
          <div className="space-y-1 px-2 py-2">
            <p className="text-sm text-muted">{t("shell.spaces.error")}</p>
            <button type="button" onClick={() => query.refetch()} className="min-h-11 rounded-lg px-2 text-sm font-medium text-accent transition-colors hover:bg-surface-2">
              {t("shell.spaces.retry")}
            </button>
          </div>
        ) : (
          <p className="px-2 py-2 text-sm text-muted">{t("shell.spaces.empty")}</p>
        )
      ) : null}
    </div>
  );
}

/**
 * Where the switcher sits: `sidebar` the computer's side menu (a full-width button and «+» beside it),
 * `rail` the side menu folded to icons, `strip` the end of «الشغل»'s tab strip on a phone.
 */
export type SpaceSwitcherVariant = "sidebar" | "rail" | "strip";

/**
 * THE SPACE YOU ARE IN, and the way into another one — like switching accounts in a messaging app (the owner's
 * decision, 2026-10-25: a space is like a separate site). The button says the current space's name; the menu
 * lists every space of the person's with what is waiting there, and entering one (`/go`) opens its «اليوم».
 * «كل المساحات» (the overview of every space) is the owner's and the admins'; «مساحة عمل جديدة» is for whoever
 * may open one (`spaces.create`, never a guest). The new space is the existing WorkspaceCreateModal flow.
 *
 * From the menu, the dialog opens only once the menu has closed and handed focus back to its button,
 * so the dialog remembers that button and gives focus back to it when it closes.
 *
 * `defaultOpen` and `portal={false}` are for server-render tests.
 */
export function SpaceSwitcher({
  variant,
  isGuest = false,
  current = null,
  canOverview = false,
  showCounts = false,
  defaultOpen,
  portal = true,
}: {
  variant: SpaceSwitcherVariant;
  isGuest?: boolean;
  /** The space the person is in (null: they are in none). */
  current?: ShellSpace | null;
  /** The owner and the admins: «كل المساحات». */
  canOverview?: boolean;
  /** N1.3, the new shell: every row wears its unread and overdue counts, the current space's included. */
  showCounts?: boolean;
  defaultOpen?: boolean;
  portal?: boolean;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const createAfterClose = useRef(false);
  const orgsQuery = useSpaces();

  const organizations = orgsQuery.data?.organizations ?? [];
  const spaces = organizations.flatMap((org) => org.workspaces);
  const canCreate = !isGuest && organizations.some((org) => org.canCreateSpaces);
  const label = current ? t("shell.spaces.current", { name: current.name }) : t("shell.spaces.open");
  // something waits in another space: a dot on the button (the numbers are in the menu)
  const waitingElsewhere = spaces.some((s) => s.id !== current?.id && ((s.unread ?? 0) > 0 || (showCounts && (s.overdue ?? 0) > 0)));
  const dot = waitingElsewhere ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" /> : null;

  const trigger =
    variant === "sidebar" ? (
      <button
        type="button"
        className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-fg transition-colors hover:bg-surface-2"
      >
        <Layers aria-hidden="true" className="size-4 shrink-0 text-muted" />
        {/* the space's own name is written above it, in the menu's head (sidebar.tsx) */}
        <span className="min-w-0 flex-1 truncate text-start font-semibold">{t("shell.spaces.mine")}</span>
        {dot}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted" />
      </button>
    ) : variant === "rail" ? (
      <button
        type="button"
        aria-label={label}
        title={label}
        className="relative grid size-11 place-items-center rounded-xl border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {current?.emoji ? <span aria-hidden="true" className="text-lg leading-none">{current.emoji}</span> : <Layers aria-hidden="true" className="size-5" />}
        {dot ? <span className="absolute end-1 top-1">{dot}</span> : null}
      </button>
    ) : (
      <button
        type="button"
        aria-label={label}
        title={label}
        className="flex h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {current?.emoji ? <span aria-hidden="true" className="text-base leading-none">{current.emoji}</span> : <Layers aria-hidden="true" className="size-5" />}
        {dot}
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
    );

  return (
    <>
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent
          portal={portal}
          align={variant === "strip" ? "end" : "start"}
          className="w-72"
          onCloseAutoFocus={() => {
            if (!createAfterClose.current) return;
            createAfterClose.current = false;
            // after Radix has given focus back to the switcher (it does so right after this handler)
            window.setTimeout(() => setCreating(true), 0);
          }}
        >
          <DropdownMenuLabel>{t("top.workspaces")}</DropdownMenuLabel>
          {spaces.map((space) => {
            const here = space.id === current?.id;
            // the new shell (N1.3) shows both numbers of every space, the one the person is in included
            const waiting = here && !showCounts ? 0 : (space.unread ?? 0);
            return (
              <DropdownMenuItem key={space.id} asChild>
                <a
                  href={goHref(space.id)}
                  aria-current={here ? "true" : undefined}
                  aria-label={!showCounts && waiting > 0 ? t("shell.spaces.waiting", { name: space.name, n: fmtNumber(waiting) }) : undefined}
                  className={cn(here && "font-semibold text-fg")}
                >
                  <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center text-sm leading-none">
                    {space.emoji ?? ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate"><bdi>{space.name}</bdi></span>
                  {showCounts ? (
                    <CountPills name={space.name} unread={space.unread ?? 0} overdue={space.overdue ?? 0} />
                  ) : waiting > 0 ? (
                    <span aria-hidden="true" className="min-w-5 shrink-0 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-5 text-accent-fg">
                      {fmtNumber(waiting)}
                    </span>
                  ) : null}
                  {here ? <Check aria-hidden="true" className="size-4 shrink-0 text-accent" /> : null}
                </a>
              </DropdownMenuItem>
            );
          })}
          {canOverview && !isGuest && spaces.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/spaces">
                  <LayoutGrid aria-hidden="true" className="size-4 text-muted" />
                  {t("shell.spaces.all")}
                </Link>
              </DropdownMenuItem>
            </>
          ) : null}
          {spaces.length === 0 && !orgsQuery.isLoading ? (
            orgsQuery.isError ? (
              // the list failed to arrive: say so, and offer the way back — not a silent empty menu
              <div className="space-y-1 px-3 py-2">
                <p className="text-sm text-muted">{t("shell.spaces.error")}</p>
                <button
                  type="button"
                  onClick={() => orgsQuery.refetch()}
                  className="min-h-11 rounded-lg px-2 text-sm font-medium text-accent transition-colors hover:bg-surface-2"
                >
                  {t("shell.spaces.retry")}
                </button>
              </div>
            ) : (
              <p className="px-3 py-2 text-sm text-muted">{t("shell.spaces.empty")}</p>
            )
          ) : null}
          {canCreate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  createAfterClose.current = true;
                }}
              >
                <Plus aria-hidden="true" className="size-4 text-muted" />
                {t("ws.new")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {canCreate && variant === "sidebar" ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label={t("ws.new")}
          title={t("ws.new")}
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      ) : null}

      {canCreate ? (
        <WorkspaceCreateModal
          open={creating}
          onClose={() => setCreating(false)}
          organizations={organizations.map((org) => ({ id: org.id, name: org.name, canAdmin: org.canCreateSpaces }))}
        />
      ) : null}
    </>
  );
}
