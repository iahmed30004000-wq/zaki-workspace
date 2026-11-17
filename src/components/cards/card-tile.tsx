"use client";

import * as React from "react";
import Link from "next/link";
import {
  Archive,
  Copy,
  ExternalLink,
  GripVertical,
  Link2,
  ListChecks,
  ListTodo,
  MoreVertical,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  PackageOpen,
  Send,
  Sparkles,
  StickyNote,
  Table2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtNumber, fmtSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useOptionalToast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib/cards/clipboard";
import { isSafeHttpsUrl, type CardItem, type CardKind } from "@/lib/cards/shared";
import { COLOR_STYLE } from "./colors";
import { StatusBadge } from "./status-badge";

/** The icon of each kind (the kind's name is always written beside it: an icon alone says nothing to a screen reader). */
export const KIND_ICON: Record<CardKind, React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>> = {
  NOTE: StickyNote,
  PROMPT: Sparkles,
  LIST: ListChecks,
  LINK: Link2,
  FILE: Paperclip,
  TABLE: Table2,
  PRODUCT: PackageOpen,
  REPLY: Send,
};

/** What a tile can ask for. The screen above decides what each one does (and asks the server again). */
export interface TileActions {
  onEdit: (card: CardItem) => void;
  onArchive: (card: CardItem) => void;
  onRestore: (card: CardItem) => void;
  onPin: (card: CardItem) => void;
  onDuplicate: (card: CardItem) => void;
  onSend: (card: CardItem) => void;
  onTask: (card: CardItem) => void;
  onToggleItem: (card: CardItem, index: number) => void;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TILE_ITEMS = 6;
const TILE_ROWS = 5;

// ---------- one body per kind ----------

export function NoteBody({ card, clamp }: { card: CardItem; clamp: boolean }) {
  if (!card.body) return null;
  return <p dir="auto" className={cn("whitespace-pre-wrap break-words text-sm text-fg", clamp && "line-clamp-6")}>{card.body}</p>;
}

export function PromptBody({ card, clamp }: { card: CardItem; clamp: boolean }) {
  const { t } = useI18n();
  const toast = useOptionalToast()?.toast;
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    const ok = await copyText(card.body ?? "");
    setCopied(ok);
    toast?.(t(ok ? "cards.copied" : "cards.copy_failed"), ok ? "success" : "error");
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="flex flex-col gap-2">
      <p dir="auto" className={cn("whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-2 text-sm text-fg", clamp && "line-clamp-6")}>
        {card.body}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 self-start rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
      >
        <Copy className="size-4" aria-hidden="true" />
        {copied ? t("cards.copied") : t("cards.copy")}
      </button>
    </div>
  );
}

export function ListBody({ card, clamp, canWrite, onToggle }: { card: CardItem; clamp: boolean; canWrite: boolean; onToggle: (index: number) => void }) {
  const { t } = useI18n();
  const items = card.data && "items" in card.data ? card.data.items : [];
  const shown = clamp ? items.slice(0, TILE_ITEMS) : items;
  return (
    <div className="flex flex-col">
      {card.body ? <NoteBody card={card} clamp={clamp} /> : null}
      <ul className="flex flex-col">
        {shown.map((item, index) => (
          <li key={index}>
            <label className={cn("flex min-h-11 items-center gap-2 text-sm", canWrite ? "cursor-pointer" : "cursor-default")}>
              <input
                type="checkbox"
                checked={item.done}
                disabled={!canWrite}
                onChange={() => onToggle(index)}
                className="size-5 shrink-0 accent-accent"
              />
              <span dir="auto" className={cn("min-w-0 break-words", item.done && "text-fg-muted line-through")}>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>
      {items.length === 0 ? <p className="text-xs text-fg-muted">{t("cards.list_empty")}</p> : null}
      {clamp && items.length > shown.length ? (
        <p className="text-xs text-fg-muted">{t("cards.more_items", { n: fmtNumber(items.length - shown.length) })}</p>
      ) : null}
    </div>
  );
}

export function LinkBody({ card }: { card: CardItem }) {
  const { t } = useI18n();
  const url = card.data && "url" in card.data ? card.data.url : null;
  // asked again here: only an https address becomes an anchor, whatever the row says
  if (!isSafeHttpsUrl(url)) return <p className="text-xs text-danger">{t("cards.link_invalid")}</p>;
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* the address was just checked: host stays as is */
  }
  return (
    <div className="flex flex-col gap-2">
      {card.body ? <NoteBody card={card} clamp /> : null}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg border border-border bg-surface px-3 text-sm font-medium text-info transition-colors hover:bg-surface-2"
      >
        <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
        <span dir="ltr" className="min-w-0 truncate">{host}</span>
      </a>
    </div>
  );
}

export function FileBody({ card }: { card: CardItem }) {
  const { t } = useI18n();
  const file = card.file;
  if (!file || !card.fileId) return <p className="text-xs text-fg-muted">{t("cards.file_gone")}</p>;
  const raw = `/api/files/${card.fileId}/raw`;
  return (
    <div className="flex flex-col gap-2">
      {card.body ? <NoteBody card={card} clamp /> : null}
      {IMAGE_TYPES.has(file.mimeType) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={raw} alt={card.title} loading="lazy" className="max-h-56 w-full rounded-lg border border-border bg-surface-2 object-contain" />
      ) : null}
      <a
        href={`${raw}?download=1`}
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
      >
        <Paperclip className="size-4 shrink-0" aria-hidden="true" />
        <span dir="auto" className="min-w-0 truncate">{file.name}</span>
        <span className="shrink-0 text-xs text-fg-muted">{fmtSize(file.size)}</span>
      </a>
    </div>
  );
}

export function TableBody({ card, clamp, ledgerNotice = false }: { card: CardItem; clamp: boolean; ledgerNotice?: boolean }) {
  const { t } = useI18n();
  const data = card.data && "columns" in card.data ? card.data : { columns: [], rows: [] };
  const rows = clamp ? data.rows.slice(0, TILE_ROWS) : data.rows;
  return (
    <div className="flex flex-col gap-1">
      {card.body ? <NoteBody card={card} clamp /> : null}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2">
              {data.columns.map((c, i) => (
                <th key={i} scope="col" dir="auto" className="border-b border-border px-2 py-1.5 text-start font-semibold text-fg">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-border last:border-b-0">
                {row.map((cell, c) => (
                  <td key={c} dir="auto" className="px-2 py-1.5 align-top text-fg">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {clamp && data.rows.length > rows.length ? (
        <p className="text-xs text-fg-muted">{t("cards.more_rows", { n: fmtNumber(data.rows.length - rows.length) })}</p>
      ) : null}
      <p className="text-xs text-fg-muted">{t("cards.table_notice")}</p>
      {ledgerNotice ? <p className="text-xs font-medium text-fg">{t("cards.ledger_notice")}</p> : null}
    </div>
  );
}

/** The body of a card, whichever its kind. `clamp`: a tile keeps it short; the editor and the full view do not. */
export function CardBody({ card, clamp = true, canWrite, onToggleItem, ledgerNotice = false }: { card: CardItem; clamp?: boolean; canWrite: boolean; onToggleItem: (index: number) => void; ledgerNotice?: boolean }) {
  switch (card.kind) {
    case "PROMPT":
      return <PromptBody card={card} clamp={clamp} />;
    case "LIST":
      return <ListBody card={card} clamp={clamp} canWrite={canWrite} onToggle={onToggleItem} />;
    case "LINK":
      return <LinkBody card={card} />;
    case "FILE":
      return <FileBody card={card} />;
    case "TABLE":
      return <TableBody card={card} clamp={clamp} ledgerNotice={ledgerNotice} />;
    default:
      return <NoteBody card={card} clamp={clamp} />;
  }
}

// ---------- the menu ----------

export function CardMenu({ card, canWrite, owner, archivedView, actions }: { card: CardItem; canWrite: boolean; owner: boolean; archivedView: boolean; actions: TileActions }) {
  const { t } = useI18n();
  if (archivedView) {
    if (!owner) return null;
    return (
      <button
        type="button"
        onClick={() => actions.onRestore(card)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        {t("cards.restore")}
      </button>
    );
  }
  if (!canWrite) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${t("cards.menu")}: ${card.title}`}
          className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => actions.onEdit(card)}>
          <Pencil className="size-4" aria-hidden="true" />
          {t("cards.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onPin(card)}>
          {card.pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
          {card.pinned ? t("cards.unpin") : t("cards.pin")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onDuplicate(card)}>
          <Copy className="size-4" aria-hidden="true" />
          {t("cards.duplicate")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onSend(card)}>
          <Send className="size-4" aria-hidden="true" />
          {t("cards.send")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onTask(card)}>
          <ListTodo className="size-4" aria-hidden="true" />
          {t("cards.to_task")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem tone="danger" onSelect={() => actions.onArchive(card)}>
          <Archive className="size-4" aria-hidden="true" />
          {t("cards.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------- the tile ----------

export interface CardTileProps {
  card: CardItem;
  /** `tile`: a card in the grid or a column; `row`: one dense line of the list. */
  density: "tile" | "row";
  canWrite: boolean;
  owner: boolean;
  archivedView?: boolean;
  /** A «تصنيع» space: a data table also carries the line about the official ledger. */
  ledgerNotice?: boolean;
  actions: TileActions;
  /** The grab handle (drag and drop), already built by the list that owns the ordering. */
  handle?: React.ReactNode;
}

function Chips({ card }: { card: CardItem }) {
  if (!card.category && card.tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {card.category ? <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-fg">{card.category}</span> : null}
      {card.tags.map((tag) => (
        <span key={tag} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
          {tag}
        </span>
      ))}
    </div>
  );
}

/** The short line a row shows after the title. */
function snippetOf(card: CardItem, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (card.kind === "LIST" && card.data && "items" in card.data) {
    const done = card.data.items.filter((i) => i.done).length;
    return t("cards.list_progress", { done: fmtNumber(done), total: fmtNumber(card.data.items.length) });
  }
  if (card.kind === "LINK" && card.data && "url" in card.data && isSafeHttpsUrl(card.data.url)) {
    try {
      return new URL(card.data.url).hostname;
    } catch {
      return "";
    }
  }
  if (card.kind === "FILE") return card.file?.name ?? "";
  if (card.kind === "TABLE" && card.data && "rows" in card.data) return t("cards.table_rows", { n: fmtNumber(card.data.rows.length) });
  return (card.body ?? "").split("\n")[0] ?? "";
}

export function CardTile({ card, density, canWrite, owner, archivedView = false, ledgerNotice = false, actions, handle }: CardTileProps) {
  const { t } = useI18n();
  const Icon = KIND_ICON[card.kind];
  const style = COLOR_STYLE[card.color];
  const kindLabel = t(`cards.kind.${card.kind}`);
  const menu = <CardMenu card={card} canWrite={canWrite} owner={owner} archivedView={archivedView} actions={actions} />;

  if (density === "row") {
    return (
      <article data-card-id={card.id} data-kind={card.kind} className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-2 py-1 shadow-card", style.card)}>
        {handle}
        <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
        <span className="sr-only">{kindLabel}</span>
        {card.pinned ? <Pin className="size-4 shrink-0 text-accent" aria-label={t("cards.pinned")} /> : null}
        <h3 dir="auto" className="min-w-0 max-w-[50%] shrink-0 truncate text-sm font-semibold text-fg sm:max-w-[40%]">
          <Link href={`/cards/${card.id}`} className="inline-flex min-h-11 max-w-full items-center truncate hover:underline focus-visible:underline">{card.title}</Link>
        </h3>
        {card.status && card.status !== "DRAFT" ? <StatusBadge status={card.status} className="hidden shrink-0 md:inline-flex" /> : null}
        <span dir="auto" className="hidden min-w-0 flex-1 truncate text-xs text-fg-muted sm:block">{snippetOf(card, t)}</span>
        <span className="min-w-0 flex-1 sm:hidden" />
        {card.category ? <span className="hidden shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-fg md:inline">{card.category}</span> : null}
        {menu}
      </article>
    );
  }

  return (
    <article data-card-id={card.id} data-kind={card.kind} className={cn("flex flex-col gap-2 rounded-xl border p-3 shadow-card", style.card)}>
      <header className="flex items-start gap-1">
        {handle}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5">
          <span className="flex items-center gap-1 text-xs text-fg-muted">
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            {kindLabel}
            {card.pinned ? <Pin className="size-3.5 shrink-0 text-accent" aria-label={t("cards.pinned")} /> : null}
            {card.status && card.status !== "DRAFT" ? <StatusBadge status={card.status} className="ms-1" /> : null}
          </span>
          <h3 dir="auto" className="break-words text-base font-semibold text-fg">
            <Link href={`/cards/${card.id}`} className="inline-flex min-h-11 items-center hover:underline focus-visible:underline">{card.title}</Link>
          </h3>
        </div>
        {menu}
      </header>
      <CardBody card={card} canWrite={canWrite && !archivedView} ledgerNotice={ledgerNotice} onToggleItem={(index) => actions.onToggleItem(card, index)} />
      <Chips card={card} />
    </article>
  );
}

/** The grab handle of a sortable tile or row: a 44px target, named for the card it moves. */
export const DragHandle = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { cardTitle: string }>(
  ({ cardTitle, className, ...props }, ref) => {
    const { t } = useI18n();
    return (
      <button
        ref={ref}
        type="button"
        aria-label={`${t("cards.drag")}: ${cardTitle}`}
        className={cn("inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg active:cursor-grabbing", className)}
        {...props}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
    );
  },
);
DragHandle.displayName = "DragHandle";
