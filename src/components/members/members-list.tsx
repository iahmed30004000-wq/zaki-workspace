"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import {
  STATUS_KEYS,
  arabicPlural,
  filterMembers,
  sortMembers,
  statusCounts,
  type ContractMember,
  type StatusFilter,
} from "@/lib/members-ui";
import { cn } from "@/lib/utils";
import { MemberCard } from "./member-card";

export interface ListFilter {
  query: string;
  status: StatusFilter;
}

const FILTERS: readonly StatusFilter[] = ["ALL", "ACTIVE", "SUSPENDED", "OFFBOARDED"];

/**
 * The people, as cards, with a search box and a status filter (الكل / فعّال / موقوف / مُخرَج).
 * Presentational: the data, the clock and what happens on a tap come from the caller.
 */
export function MembersList({
  members,
  actorId,
  now,
  filter,
  onFilterChange,
  onOpen,
  loading = false,
  errorMessage = null,
  onRetry,
}: {
  members: readonly ContractMember[];
  actorId: string;
  now: number;
  filter: ListFilter;
  onFilterChange: (next: ListFilter) => void;
  onOpen: (id: string) => void;
  loading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const counts = statusCounts(members);
  const visible = sortMembers(filterMembers(members, filter.query, filter.status));

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input
          type="search"
          value={filter.query}
          onChange={(e) => onFilterChange({ ...filter, query: e.target.value })}
          aria-label={t("members.search_label")}
          placeholder={t("members.search_ph")}
          autoComplete="off"
          className="h-11 rounded-full border-transparent bg-surface-2 ps-9"
        />
      </div>

      <div role="group" aria-label={t("members.filter_label")} className="flex flex-wrap gap-2">
        {FILTERS.map((status) => {
          const active = filter.status === status;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange({ ...filter, status })}
              className={cn(
                "inline-flex h-11 items-center gap-2 rounded-full px-3 text-[13.5px] font-semibold transition-colors sm:px-4",
                active ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted hover:text-fg",
              )}
            >
              {status === "ALL" ? t("members.filter_all") : t(STATUS_KEYS[status])}
              <span className={cn("text-xs tabular-nums", active ? "text-accent-fg/80" : "text-muted")}>{counts[status]}</span>
            </button>
          );
        })}
      </div>

      <p aria-live="polite" className="min-h-4 text-xs text-muted">
        {loading || errorMessage || visible.length === 0
          ? null
          : t(`members.count.${arabicPlural(visible.length)}`, { n: visible.length })}
      </p>

      {loading ? (
        <div role="status" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <span className="sr-only">{t("common.loading")}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden="true" className="h-28 animate-pulse rounded-[14px] bg-surface-2" />
          ))}
        </div>
      ) : errorMessage ? (
        <div role="alert" className="space-y-3 rounded-[14px] bg-surface-1 p-5 text-center">
          <p className="text-sm font-medium text-fg">{t("members.load_failed")}</p>
          <p className="text-xs text-fg-muted">{errorMessage}</p>
          {onRetry ? (
            <Button type="button" variant="secondary" onClick={onRetry} className="h-11">
              {t("common.retry")}
            </Button>
          ) : null}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-[14px] bg-surface-1 px-4 py-7 text-center text-sm text-fg-muted">
          {members.length === 0 ? t("members.empty") : t("members.no_match")}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visible.map((member) => (
            <MemberCard key={member.id} member={member} isSelf={member.id === actorId} now={now} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}
