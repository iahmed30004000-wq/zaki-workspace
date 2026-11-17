"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { fmtSize } from "@/lib/format";
import { apiUpload } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import {
  CARD_COLORS,
  GENERIC_CARD_KINDS,
  LIMITS,
  cleanTags,
  isSafeHttpsUrl,
  type CardColor,
  type CardItem,
  type CardKind,
  type ListItem,
} from "@/lib/cards/shared";
import { COLOR_STYLE } from "./colors";
import { KIND_ICON } from "./card-tile";
import { cardErrorKey } from "./errors";

/** What the editor hands back to be saved (a create adds `kind`; an edit leaves the kind alone). */
export interface CardPayload {
  kind: CardKind;
  title: string;
  body: string | null;
  data: unknown;
  color: CardColor;
  category: string | null;
  tags: string[];
  pinned: boolean;
  fileId: string | null;
}

interface UploadedFile {
  id: string;
  name: string;
  size: number;
}

export interface CardEditorFormProps {
  /** The card being edited; null: a new one. */
  card: CardItem | null;
  /** The kind a new card starts as. */
  initialKind?: CardKind;
  /** The categories already in use (offered as suggestions). */
  categories: string[];
  onSave: (payload: CardPayload) => Promise<void>;
  onCancel: () => void;
  /** A «تصنيع» space: a table's form also carries the line about the official ledger. */
  ledgerNotice?: boolean;
  /** Sends a picked file to the library of this space (the files service); tests pass their own. */
  upload?: (file: File) => Promise<UploadedFile>;
  /** Typing kept on this device from an earlier, unfinished edit: it fills the form instead of the card's own values. */
  draft?: Partial<CardPayload> | null;
  /** Told (after a short pause) what the form holds, so the screen can keep it on this device. */
  onDraft?: (payload: CardPayload) => void;
}

async function uploadToLibrary(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const made = await apiUpload<{ id: string }>("/api/files", form);
  return { id: made.id, name: file.name, size: file.size };
}

const emptyTable = () => ({ columns: ["", ""], rows: [["", ""]] as string[][] });

export function CardEditorForm({ card, initialKind = "NOTE", categories, onSave, onCancel, ledgerNotice = false, upload = uploadToLibrary, draft = null, onDraft }: CardEditorFormProps) {
  const { t } = useI18n();
  const [kind, setKind] = React.useState<CardKind>(card?.kind ?? initialKind);
  const [title, setTitle] = React.useState(draft?.title ?? card?.title ?? "");
  const [body, setBody] = React.useState(draft?.body !== undefined ? (draft.body ?? "") : (card?.body ?? ""));
  const [color, setColor] = React.useState<CardColor>(draft?.color ?? card?.color ?? "none");
  const [category, setCategory] = React.useState(draft?.category !== undefined ? (draft.category ?? "") : (card?.category ?? ""));
  const [tagsText, setTagsText] = React.useState((draft?.tags ?? card?.tags ?? []).join("، "));
  const [pinned, setPinned] = React.useState(draft?.pinned ?? card?.pinned ?? false);
  const startData = draft?.data !== undefined ? (draft.data as CardItem["data"]) : (card?.data ?? null);
  const [items, setItems] = React.useState<ListItem[]>(startData && "items" in startData ? startData.items : [{ text: "", done: false }]);
  const [url, setUrl] = React.useState(startData && "url" in startData ? startData.url : "");
  const [table, setTable] = React.useState(startData && "columns" in startData ? { columns: startData.columns, rows: startData.rows } : emptyTable());
  const [file, setFile] = React.useState<UploadedFile | null>(card?.file && card.fileId ? { id: card.fileId, name: card.file.name, size: card.file.size } : null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    setUploading(true);
    setError(null);
    try {
      const done = await upload(chosen);
      setFile(done);
      if (!title.trim()) setTitle(chosen.name.slice(0, LIMITS.title));
    } catch (err) {
      setError(cardErrorKey(err));
    } finally {
      setUploading(false);
    }
  }

  const current = (): CardPayload => ({
    kind,
    title: title.trim(),
    body: body.trim() ? body : null,
    data: kind === "LIST" ? { items: items.filter((i) => i.text.trim()) } : kind === "LINK" ? { url: url.trim() } : kind === "TABLE" ? table : null,
    color,
    category: category.trim() || null,
    tags: cleanTags(tagsText.split(/[,،\n]/)),
    pinned,
    fileId: kind === "FILE" ? (file?.id ?? null) : null,
  });

  // the typing is kept on this device (the screen decides where) a moment after the person stops
  const first = React.useRef(true);
  React.useEffect(() => {
    if (!onDraft) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => onDraft(current()), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, color, category, tagsText, pinned, items, url, table, file]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("cards.e.title");
    if (kind === "PROMPT" && !body.trim()) return setError("cards.e.prompt");
    if (kind === "LINK" && !isSafeHttpsUrl(url)) return setError("cards.e.link");
    if (kind === "FILE" && !file) return setError("cards.e.file");
    setSaving(true);
    try {
      await onSave(current());
    } catch (err) {
      setError(cardErrorKey(err));
      setSaving(false);
    }
  }

  const bodyLabel = kind === "PROMPT" ? t("cards.f.prompt") : kind === "NOTE" ? t("cards.f.note") : t("cards.f.note_optional");

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-label={card ? t("cards.edit") : t("cards.new")}>
      {card ? null : (
        <div>
          <Label>{t("cards.f.kind")}</Label>
          <div role="radiogroup" aria-label={t("cards.f.kind")} className="grid grid-cols-3 gap-2">
            {GENERIC_CARD_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 text-xs font-medium transition-colors",
                    kind === k ? "border-accent bg-accent/10 text-fg" : "border-muted bg-surface text-fg-muted hover:bg-surface-2",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {t(`cards.kind.${k}`)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <Label>{t("cards.f.title")}</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.title} required autoFocus />
      </div>

      {kind === "LINK" ? (
        <div>
          <Label>{t("cards.f.url")}</Label>
          <Input dir="ltr" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={LIMITS.url} placeholder="https://" />
          <p className="mt-1 text-xs text-fg-muted">{t("cards.f.url_hint")}</p>
        </div>
      ) : null}

      {kind === "FILE" ? (
        <div>
          <Label>{t("cards.f.file")}</Label>
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-muted bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2">
            <input type="file" className="sr-only" onChange={(e) => void pick(e)} disabled={uploading} />
            {uploading ? t("cards.f.uploading") : file ? t("cards.f.file_change") : t("cards.f.file_pick")}
          </label>
          {file ? (
            <p dir="auto" className="mt-1 break-words text-xs text-fg-muted">
              {file.name} · {fmtSize(file.size)}
            </p>
          ) : null}
        </div>
      ) : null}

      {kind === "LIST" ? (
        <div>
          <Label>{t("cards.f.items")}</Label>
          <ul className="flex flex-col gap-2 p-0">
            {items.map((item, i) => (
              <li key={i} className="flex list-none items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
                  aria-label={t("cards.f.item_done")}
                  className="size-5 shrink-0 accent-accent"
                />
                <Input
                  value={item.text}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  maxLength={LIMITS.listText}
                  aria-label={`${t("cards.f.item")} ${i + 1}`}
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  aria-label={t("cards.f.item_remove")}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-danger"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {items.length < LIMITS.listItems ? (
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => setItems([...items, { text: "", done: false }])}>
              <Plus className="size-4" aria-hidden="true" />
              {t("cards.f.item_add")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {kind === "TABLE" ? (
        <div>
          <Label>{t("cards.f.table")}</Label>
          <p role="note" className="mb-2 rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs text-fg">
            {t("cards.table_notice")}
            {ledgerNotice ? <span className="mt-1 block font-medium">{t("cards.ledger_notice")}</span> : null}
          </p>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-1">
              <thead>
                <tr>
                  {table.columns.map((c, ci) => (
                    <th key={ci} scope="col" className="min-w-32 p-0 text-start">
                      <div className="flex items-center gap-1">
                        <Input
                          value={c}
                          onChange={(e) => setTable({ ...table, columns: table.columns.map((x, j) => (j === ci ? e.target.value : x)) })}
                          maxLength={LIMITS.tableCell}
                          aria-label={`${t("cards.f.column")} ${ci + 1}`}
                          className="font-semibold"
                        />
                        {table.columns.length > 1 ? (
                          <button
                            type="button"
                            aria-label={t("cards.f.column_remove")}
                            onClick={() => setTable({ columns: table.columns.filter((_, j) => j !== ci), rows: table.rows.map((r) => r.filter((_, j) => j !== ci)) })}
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-danger"
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </th>
                  ))}
                  <th className="w-11" />
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="p-0">
                        <Input
                          value={cell}
                          onChange={(e) => setTable({ ...table, rows: table.rows.map((r, a) => (a === ri ? r.map((x, b) => (b === ci ? e.target.value : x)) : r)) })}
                          maxLength={LIMITS.tableCell}
                          aria-label={`${t("cards.f.cell")} ${ri + 1}/${ci + 1}`}
                        />
                      </td>
                    ))}
                    <td className="p-0">
                      <button
                        type="button"
                        aria-label={t("cards.f.row_remove")}
                        onClick={() => setTable({ ...table, rows: table.rows.filter((_, a) => a !== ri) })}
                        className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-danger"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {table.rows.length < LIMITS.tableRows ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setTable({ ...table, rows: [...table.rows, table.columns.map(() => "")] })}>
                <Plus className="size-4" aria-hidden="true" />
                {t("cards.f.row_add")}
              </Button>
            ) : null}
            {table.columns.length < LIMITS.tableColumns ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setTable({ columns: [...table.columns, ""], rows: table.rows.map((r) => [...r, ""]) })}>
                <Plus className="size-4" aria-hidden="true" />
                {t("cards.f.column_add")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <Label>{bodyLabel}</Label>
        <Textarea dir="auto" rows={kind === "PROMPT" || kind === "NOTE" ? 6 : 3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={LIMITS.body} />
      </div>

      <div>
        <Label>{t("cards.f.color")}</Label>
        <div role="radiogroup" aria-label={t("cards.f.color")} className="flex flex-wrap gap-1">
          {CARD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={t(`cards.color.${c}`)}
              title={t(`cards.color.${c}`)}
              onClick={() => setColor(c)}
              className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-2"
            >
              <span className={cn("block size-6 rounded-full border", COLOR_STYLE[c].dot, color === c ? "border-fg ring-2 ring-accent" : "border-muted")} />
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{t("cards.f.category")}</Label>
          <Input list="cards-categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={LIMITS.category} />
          <datalist id="cards-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <Label>{t("cards.f.tags")}</Label>
          <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder={t("cards.f.tags_hint")} />
        </div>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-5 accent-accent" />
        {t("cards.f.pinned")}
      </label>

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {t(error)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || uploading} className="flex-1">
          {t("common.save")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** The dialog around the form: a new card or the edit of one (a fresh form each time it opens). */
export function CardEditor({
  open,
  card,
  initialKind,
  categories,
  ledgerNotice = false,
  onClose,
  onSave,
}: {
  ledgerNotice?: boolean;
  open: boolean;
  card: CardItem | null;
  initialKind?: CardKind;
  categories: string[];
  onClose: () => void;
  onSave: (payload: CardPayload) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Modal open={open} title={card ? t("cards.edit") : t("cards.new")} onClose={onClose}>
      <CardEditorForm key={card?.id ?? "new"} card={card} initialKind={initialKind} categories={categories} ledgerNotice={ledgerNotice} onSave={onSave} onCancel={onClose} />
    </Modal>
  );
}
