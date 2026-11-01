"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Columns3, LayoutGrid, List, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ApiError, apiGet, apiPatch, apiPost, apiDelete } from "@/lib/api-client";
import { browserStorage, draftKey, saveDraft } from "@/lib/cards/draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { CARD_COLORS, CARD_KINDS, type CardItem, type SpaceLayout } from "@/lib/cards/shared";
import { positionBetween } from "@/lib/cards/order";
import {
  CARD_SORTS,
  CARD_VIEWS,
  NO_FILTER,
  applyFilter,
  categoriesOf,
  isFiltering,
  readView,
  sortCards,
  tagsOf,
  writeView,
  type CardFilter,
  type CardSort,
  type CardView,
} from "@/lib/cards/view";
import { CardGrid } from "./card-grid";
import { CardEditor, type CardPayload } from "./card-editor";
import { CardToTaskDialog, SendCardDialog } from "./card-dialogs";
import { cardErrorKey } from "./errors";
import type { TileActions } from "./card-tile";
import { MfgTabs } from "@/components/manufacturing/ui";

interface CardList {
  cards: CardItem[];
  canWrite: boolean;
  owner: boolean;
}

const VIEW_ICON = { grid: LayoutGrid, list: List, columns: Columns3 } as const;

export interface CardsViewProps {
  spaceId: string;
  spaceName: string;
  userId: string;
  initial: CardItem[];
  canWrite: boolean;
  owner: boolean;
  /** The space's layout: «تصنيع» adds the line about the official ledger. */
  layout?: SpaceLayout;
  /** A manufacturing space the person may also open «مخزون التصنيع» in: the two tabs are drawn above the cards. */
  stockTab?: boolean;
}

/**
 * «اللوحات» — the screen. The server decided what the person may read and write (the lists and every change are checked
 * there again); this component only draws it: the switcher (شبكة · قائمة · أعمدة), the filters, the sort, the cards and
 * their menus. The cards are refetched when the window gets focus again, so a colleague's change shows up without a
 * live connection.
 */
export function CardsView({ spaceId, spaceName, userId, initial, canWrite, owner, layout = "CARDS", stockTab = false }: CardsViewProps) {
  const ledgerNotice = layout === "MANUFACTURING";
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [view, setView] = React.useState<CardView>("grid");
  const [sort, setSort] = React.useState<CardSort>("manual");
  const [filter, setFilter] = React.useState<CardFilter>(NO_FILTER);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [archivedView, setArchivedView] = React.useState(false);
  const [editing, setEditing] = React.useState<CardItem | "new" | null>(null);
  const [sending, setSending] = React.useState<CardItem | null>(null);
  const [tasking, setTasking] = React.useState<CardItem | null>(null);

  // the view this person chose last time (read after the first paint, so the server and the browser agree)
  React.useEffect(() => {
    setView(readView(userId));
  }, [userId]);
  function chooseView(next: CardView) {
    setView(next);
    writeView(userId, next);
  }

  const liveKey = React.useMemo(() => ["cards", spaceId, "live"] as const, [spaceId]);
  const archiveKey = React.useMemo(() => ["cards", spaceId, "archive"] as const, [spaceId]);
  const key = archivedView ? archiveKey : liveKey;

  const query = useQuery({
    queryKey: key,
    queryFn: () => apiGet<CardList>(`/api/cards?spaceId=${encodeURIComponent(spaceId)}${archivedView ? "&archived=1" : ""}`),
    ...(archivedView ? {} : { initialData: { cards: initial, canWrite, owner } }),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  const all = React.useMemo(() => query.data?.cards ?? [], [query.data]);

  const mutate = React.useCallback(
    (fn: (cards: CardItem[]) => CardItem[]) => qc.setQueryData<CardList>(liveKey, (prev) => (prev ? { ...prev, cards: fn(prev.cards) } : prev)),
    [qc, liveKey],
  );
  const refetchLive = React.useCallback(() => qc.invalidateQueries({ queryKey: liveKey }), [qc, liveKey]);
  const fail = React.useCallback((err: unknown) => toast(t(cardErrorKey(err)), "error"), [toast, t]);

  const categories = React.useMemo(() => categoriesOf(all), [all]);
  const tags = React.useMemo(() => tagsOf(all), [all]);
  const shown = React.useMemo(() => sortCards(applyFilter(all, filter), sort), [all, filter, sort]);

  // ---- what the tiles ask for ----
  const actions: TileActions = React.useMemo(
    () => ({
      onEdit: (card) => setEditing(card),
      onSend: (card) => setSending(card),
      onTask: (card) => setTasking(card),
      onPin: async (card) => {
        mutate((cs) => cs.map((c) => (c.id === card.id ? { ...c, pinned: !card.pinned } : c)));
        try {
          await apiPatch(`/api/cards/${card.id}`, { pinned: !card.pinned });
        } catch (err) {
          fail(err);
          void refetchLive();
        }
      },
      onToggleItem: async (card, index) => {
        if (!card.data || !("items" in card.data)) return;
        const items = card.data.items.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
        mutate((cs) => cs.map((c) => (c.id === card.id ? { ...c, data: { items } } : c)));
        try {
          await apiPatch(`/api/cards/${card.id}`, { data: { items } });
        } catch (err) {
          fail(err);
          void refetchLive();
        }
      },
      onArchive: async (card) => {
        mutate((cs) => cs.filter((c) => c.id !== card.id));
        try {
          await apiDelete(`/api/cards/${card.id}`);
          toast(t("cards.deleted"), "success");
        } catch (err) {
          fail(err);
          void refetchLive();
        }
      },
      onRestore: async (card) => {
        try {
          await apiPost(`/api/cards/${card.id}/restore`);
          qc.setQueryData<CardList>(archiveKey, (prev) => (prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== card.id) } : prev));
          void refetchLive();
          toast(t("cards.restored"), "success");
        } catch (err) {
          fail(err);
        }
      },
      onDuplicate: async (card) => {
        try {
          await apiPost(`/api/cards/${card.id}/duplicate`);
          void refetchLive();
          toast(t("cards.duplicated"), "success");
        } catch (err) {
          fail(err);
        }
      },
    }),
    [mutate, fail, refetchLive, toast, t, qc, archiveKey],
  );

  async function save(payload: CardPayload) {
    if (editing === "new") {
      const { card } = await apiPost<{ card: CardItem }>("/api/cards", { spaceId, ...payload });
      mutate((cs) => [card, ...cs]);
      toast(t("cards.created"), "success");
    } else if (editing) {
      const { kind: _kind, ...changes } = payload;
      void _kind;
      try {
        // the version this editor started from: a card that moved on answers 409 and nothing is overwritten
        const { card } = await apiPatch<{ card: CardItem }>(`/api/cards/${editing.id}`, { ...changes, version: editing.version });
        mutate((cs) => cs.map((c) => (c.id === card.id ? card : c)));
        toast(t("cards.saved"), "success");
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        // the typing is kept on this device; the card's own page shows the difference and lets the person decide
        saveDraft(browserStorage(), draftKey(userId, editing.id), { baseVersion: editing.version ?? 1, savedAt: new Date().toISOString(), payload: changes });
        toast(t("cards.conflict_grid"), "error");
        void refetchLive();
      }
    }
    setEditing(null);
  }

  // drag and drop: the card moves at once; the server writes ONE number and answers with it
  async function reorder(movedId: string, previousId: string | null, nextId: string | null) {
    const at = (id: string | null) => all.find((c) => c.id === id)?.position;
    const guess = positionBetween(at(previousId), at(nextId));
    if (guess !== null) mutate((cs) => cs.map((c) => (c.id === movedId ? { ...c, position: guess } : c)));
    try {
      const { position } = await apiPost<{ position: number }>(`/api/cards/${movedId}/move`, { previousId, nextId });
      mutate((cs) => cs.map((c) => (c.id === movedId ? { ...c, position } : c)));
      // a renumbering (rare) moved other cards too: read the list again
      if (guess === null) void refetchLive();
    } catch (err) {
      fail(err);
      void refetchLive();
    }
  }

  const live = query.data;
  const mayWrite = (live?.canWrite ?? canWrite) && !archivedView;
  const canReorder = mayWrite && sort === "manual" && view !== "columns";
  const activeFilters = isFiltering(filter);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 md:px-6 md:py-6">
      {stockTab ? <MfgTabs current="cards" /> : null}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-fg">{archivedView ? t("cards.archive_title") : t("cards.title")}</h1>
          <p dir="auto" className="truncate text-xs text-fg-muted">{spaceName}</p>
        </div>
        <div className="flex items-center gap-2">
          {owner ? (
            <Button type="button" variant={archivedView ? "primary" : "secondary"} onClick={() => setArchivedView(!archivedView)} aria-pressed={archivedView}>
              <Archive className="size-4" aria-hidden="true" />
              {t("cards.archive")}
            </Button>
          ) : null}
          {mayWrite ? (
            <Button type="button" onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden="true" />
              {t("cards.new")}
            </Button>
          ) : null}
        </div>
      </header>

      {ledgerNotice ? (
        <p role="note" className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm font-medium text-fg">
          {t("cards.ledger_notice")}
        </p>
      ) : null}

      {!(live?.canWrite ?? canWrite) ? <p className="text-xs text-fg-muted">{t("cards.read_only")}</p> : null}

      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
          <Input
            type="search"
            value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            placeholder={t("cards.search")}
            aria-label={t("cards.search")}
            className="ps-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t("cards.view")} className="inline-flex overflow-hidden rounded-lg border border-muted">
            {CARD_VIEWS.map((v) => {
              const Icon = VIEW_ICON[v];
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => chooseView(v)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-medium transition-colors md:min-h-9",
                    view === v ? "bg-accent text-accent-fg" : "bg-surface text-fg-muted hover:bg-surface-2",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {t(`cards.view.${v}`)}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            {t("cards.sort")}
            <Select value={sort} onChange={(e) => setSort(e.target.value as CardSort)} className="w-auto">
              {CARD_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`cards.sort.${s}`)}
                </option>
              ))}
            </Select>
          </label>
          <Button type="button" variant="secondary" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            {t("cards.filters")}
            {activeFilters ? <span className="size-2 rounded-full bg-accent" aria-label={t("cards.filters_on")} /> : null}
          </Button>
        </div>

        {filtersOpen ? (
          <div className="grid gap-2 rounded-xl border border-border bg-surface-1 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-fg-muted">
              {t("cards.f.kind")}
              <Select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value as CardFilter["kind"] })}>
                <option value="ALL">{t("cards.all")}</option>
                {CARD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`cards.kind.${k}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              {t("cards.f.category")}
              <Select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
                <option value="ALL">{t("cards.all")}</option>
                <option value="NONE">{t("cards.no_category")}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              {t("cards.tag")}
              <Select value={filter.tag} onChange={(e) => setFilter({ ...filter, tag: e.target.value })}>
                <option value="ALL">{t("cards.all")}</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              {t("cards.f.color")}
              <Select value={filter.color} onChange={(e) => setFilter({ ...filter, color: e.target.value as CardFilter["color"] })}>
                <option value="ALL">{t("cards.all")}</option>
                {CARD_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {t(`cards.color.${c}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={filter.pinnedOnly} onChange={(e) => setFilter({ ...filter, pinnedOnly: e.target.checked })} className="size-5 accent-accent" />
              {t("cards.pinned_only")}
            </label>
            {activeFilters ? (
              <Button type="button" variant="ghost" onClick={() => setFilter(NO_FILTER)}>
                {t("cards.clear_filters")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={activeFilters ? t("cards.no_results") : archivedView ? t("cards.archive_empty") : t("cards.empty")}
          hint={activeFilters ? undefined : archivedView ? undefined : mayWrite ? t("cards.empty_hint") : undefined}
        />
      ) : (
        <CardGrid
          cards={shown}
          view={view}
          canReorder={canReorder}
          canWrite={mayWrite}
          owner={live?.owner ?? owner}
          archivedView={archivedView}
          ledgerNotice={ledgerNotice}
          actions={actions}
          onReorder={(id, previousId, nextId) => void reorder(id, previousId, nextId)}
        />
      )}

      <CardEditor open={editing !== null} card={editing === "new" ? null : editing} categories={categories} ledgerNotice={ledgerNotice} onClose={() => setEditing(null)} onSave={save} />
      <SendCardDialog card={sending} spaceId={spaceId} onClose={() => setSending(null)} />
      <CardToTaskDialog card={tasking} spaceId={spaceId} onClose={() => setTasking(null)} />
    </div>
  );
}
