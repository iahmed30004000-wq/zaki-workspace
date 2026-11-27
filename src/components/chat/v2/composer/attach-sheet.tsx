"use client";

import React from "react";
import { ChartColumn, FileText, Image as ImageIcon, ListChecks, MapPin, Paperclip, Pencil, Plus, Send, Sparkles, type LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ChecklistFromMenu, LocationFromMenu } from "@/components/chat/v2/composer/attach-menu";
import { PhotoEditor } from "@/components/chat/v2/composer/photo-editor";
import { TgAttachSheet, type AttachCaptionProps, type AttachTileProps } from "@/components/chat/v2/composer/attach-sheet-tg";
import { useTgPhone } from "@/components/shell/tg-phone";
import { COMPOSER_ICON_BUTTON, ROUND_BUTTON } from "@/components/chat/v2/composer/composer-styles";
import { ct } from "@/lib/chat/text";
import { dragHasFiles } from "@/lib/chat/v2/composer/clipboard-files";
import { attachTabsOf, type AttachItemId } from "@/lib/chat/v2/composer/attach-items";
import type { PendingFile } from "@/lib/chat/v2/composer/types";

const ICONS: Record<AttachItemId, LucideIcon> = { media: ImageIcon, file: FileText, poll: ChartColumn, checklist: ListChecks, location: MapPin };
const LABELS: Record<AttachItemId, string> = { media: "chatui.attachsheet.gallery", file: "chat.f.attach_file", poll: "chatc.poll.menu", checklist: "chatcl.menu", location: "chatloc.menu" };

export interface AttachSheetPanelProps {
  items: AttachItemId[];
  files: PendingFile[];
  busy: boolean;
  /** the caption: the same words as the composer's box (one message, one caption) */
  caption: string;
  canSend: boolean;
  onCaption: (value: string) => void;
  onPick: (id: AttachItemId) => void;
  onRemove: (index: number) => void;
  /** S6.2: the editor's result for the picture at `index`; absent: no edit button */
  onEdit?: (index: number, file: File) => void;
  /** S6.2: «جودة عالية» for the picture at `index`; absent: no quality button */
  onHd?: (index: number, on: boolean) => void;
  onSend: () => void;
}

/** One pick: its picture (or name) and its number, which is also the button that takes it away; a picture may be edited and sent in high quality. */
export function AttachTile({ item, index, busy, onRemove, onStartEdit, onHd }: AttachTileProps) {
  return (
    <li data-attach-tile={item.asFile ? "FILE" : item.kind} className="relative aspect-square overflow-hidden rounded-lg bg-surface-2">
      {item.kind === "IMAGE" && item.preview && !item.asFile ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing for next/image to optimise
        <img src={item.preview} alt={item.file.name} className="size-full object-cover" />
      ) : item.kind === "VIDEO" && item.preview && !item.asFile ? (
        <video src={item.preview} muted preload="metadata" className="size-full object-cover" aria-label={item.file.name} />
      ) : (
        <span className="flex size-full items-center justify-center break-all p-2 text-center text-xs text-fg">{item.file.name}</span>
      )}
      {!busy && item.kind === "IMAGE" && !item.asFile ? (
        <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
          {onStartEdit && (
            <button type="button" data-attach-edit aria-label={ct("chatui.attachsheet.edit")} onClick={onStartEdit} className="flex size-8 items-center justify-center rounded-full bg-surface-1/85 text-fg shadow-card backdrop-blur-md">
              <Pencil aria-hidden="true" className="size-4" />
            </button>
          )}
          {onHd && (
            <button type="button" data-attach-hd aria-label={ct("chatui.attachsheet.hd")} aria-pressed={item.hd === true} onClick={() => onHd(index, item.hd !== true)} className="flex size-8 items-center justify-center rounded-full bg-surface-1/85 text-fg shadow-card backdrop-blur-md aria-pressed:bg-accent aria-pressed:text-accent-fg">
              <Sparkles aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
      ) : null}
      {!busy ? (
        <button
          type="button"
          data-attach-number={index + 1}
          aria-label={ct("chatui.attachsheet.unchoose", { name: item.file.name })}
          onClick={() => onRemove(index)}
          className="absolute end-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {index + 1}
        </button>
      ) : null}
    </li>
  );
}

/** The caption (the composer's own words) and the round send button with the count on it. */
export function AttachCaptionBar({ count, busy, caption, canSend, onCaption, onSend }: AttachCaptionProps) {
  return (
    <div className="flex items-end gap-2 px-3">
      <div className="flex min-w-0 flex-1 items-end rounded-[23px] bg-surface-2 px-3 py-[3px]">
        <label className="sr-only" htmlFor="attach-caption">
          {ct("chatui.attachsheet.caption")}
        </label>
        <textarea
          id="attach-caption"
          data-attach-caption
          rows={1}
          value={caption}
          onChange={(event) => onCaption(event.currentTarget.value)}
          placeholder={ct("chatui.attachsheet.caption")}
          className="max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-[11px] text-base leading-[1.45] text-fg outline-none placeholder:text-fg-muted md:min-h-10 md:py-[9px]"
        />
      </div>
      <button type="button" data-attach-send className={`${ROUND_BUTTON} relative`} disabled={!canSend || busy} aria-label={ct("chatui.attachsheet.send", { n: count })} onClick={onSend}>
        <Send aria-hidden="true" className="size-6" />
        <span aria-hidden="true" className="absolute -end-1 -top-1 flex min-w-5 items-center justify-center rounded-full border border-surface-1 bg-surface-1 px-1 text-xs font-bold text-accent">
          {count}
        </span>
      </button>
    </div>
  );
}

const PARTS = { Tile: AttachTile, CaptionBar: AttachCaptionBar };

/**
 * «المرفقات» (Telegram's attach sheet) — what is inside it: the pictures and files picked so far as a grid with a number on each (the number is also the button that takes
 * one away), the caption under them, the round send button with the count on it, and the glass bar of kinds at the bottom (معرض · ملف · استطلاع · قائمة مهام). A browser cannot
 * read the phone's gallery, so «معرض» opens the system's own picker (several at once) and the picks land here.
 */
export function AttachSheetPanel({ items, files, busy, caption, canSend, onCaption, onPick, onRemove, onEdit, onHd, onSend }: AttachSheetPanelProps) {
  const has = files.length > 0;
  const [editing, setEditing] = React.useState<number | null>(null);
  const editingFile = editing !== null ? files[editing] : undefined;
  const anyHd = files.some((item) => item.hd === true && item.kind === "IMAGE" && !item.asFile);
  return (
    <div data-attach-sheet className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-center pt-1">
        <p className="rounded-full border border-border/60 bg-surface-2 px-4 py-1.5 text-sm font-semibold text-fg">{has ? ct("chatui.attachsheet.chosen", { n: files.length }) : ct("chatui.attachsheet.title")}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3">
        {has ? (
          <ul data-attach-grid className="grid grid-cols-3 gap-1.5">
            {files.map((item, index) => (
              <AttachTile key={`${item.file.name}-${index}`} item={item} index={index} busy={busy} onRemove={onRemove} onStartEdit={onEdit && (() => setEditing(index))} onHd={onHd} />
            ))}
            {!busy ? (
              <li className="aspect-square">
                <button type="button" data-attach-more aria-label={ct("chatui.attachsheet.more")} onClick={() => onPick("media")} className="flex size-full items-center justify-center rounded-lg border border-dashed border-border text-fg-muted hover:bg-surface-2 hover:text-fg">
                  <Plus aria-hidden="true" className="size-7" />
                </button>
              </li>
            ) : null}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <Paperclip aria-hidden="true" className="size-10 text-fg-muted" />
            <p className="text-sm text-fg-muted">{ct("chatui.attachsheet.empty")}</p>
            <p data-attach-drop-hint className="hidden text-xs text-fg-muted md:block">
              {ct("chatui.attachsheet.drop_hint")}
            </p>
            <button type="button" data-attach-pick onClick={() => onPick("media")} className="min-h-11 rounded-full bg-accent px-6 text-sm font-semibold text-accent-fg shadow-card hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {ct("chatui.attachsheet.pick")}
            </button>
          </div>
        )}
      </div>
      {anyHd ? (
        <p data-attach-hd-note role="status" className="px-4 text-center text-xs text-fg-muted">
          {ct("chatui.attachsheet.hd_note")}
        </p>
      ) : null}
      {editingFile && editing !== null && onEdit ? (
        <PhotoEditor
          file={editingFile.file}
          onCancel={() => setEditing(null)}
          onDone={(edited) => {
            onEdit(editing, edited);
            setEditing(null);
          }}
        />
      ) : null}
      {has ? <AttachCaptionBar count={files.length} busy={busy} caption={caption} canSend={canSend} onCaption={onCaption} onSend={onSend} /> : null}
      <nav data-attach-kinds aria-label={ct("chatui.attachsheet.kinds")} className="mx-3 mb-2 flex items-center justify-around gap-1 rounded-full border border-border/60 bg-surface-1/85 p-1 shadow-card backdrop-blur-md">
        {items.map((id) => {
          const Icon = ICONS[id];
          return (
            <button
              key={id}
              type="button"
              data-attach-kind={id}
              aria-pressed={id === "media" && has}
              onClick={() => onPick(id)}
              className="flex min-h-12 min-w-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg aria-pressed:bg-accent/15 aria-pressed:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Icon aria-hidden="true" className="size-5" />
              {ct(LABELS[id])}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export interface AttachSheetProps {
  items: AttachItemId[];
  disabled: boolean;
  files: PendingFile[];
  busy: boolean;
  caption: string;
  canSend: boolean;
  onCaption: (value: string) => void;
  onPick: (id: AttachItemId) => void;
  onRemove: (index: number) => void;
  onEdit?: (index: number, file: File) => void;
  onHd?: (index: number, on: boolean) => void;
  onSend: () => void;
  /** files dragged from the computer and let go on the open sheet (it covers the pane, so the pane's two zones never hear of them) */
  onDropFiles?: (files: File[]) => void;
}

/**
 * The paperclip with the sheet it opens (in place of the little menu while «شكل تيليجرام» is on): a bottom sheet on a phone, a side panel on a wide screen. The picker of the
 * system is opened by the surface's own hidden inputs (`onPick`), so the sheet stays open while the picks arrive. «استطلاع» and «قائمة مهام» close it and go on in their own dialogs.
 * On a phone with «تيليجرام على التلفون» (`tgPhone`) it opens the sheet of that look instead (`attach-sheet-tg.tsx`): the poll and the contacts are tabs inside it.
 */
export function AttachSheet({ items, disabled, files, busy, caption, canSend, onCaption, onPick, onRemove, onEdit, onHd, onSend, onDropFiles }: AttachSheetProps) {
  const [open, setOpen] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const takeDrag = (event: React.DragEvent) => {
    if (!dragHasFiles(event.dataTransfer.types)) return;
    // claimed even while busy, so the browser never opens the file
    event.preventDefault();
    if (!busy) setDragOver(true);
  };
  const dropFiles = (event: React.DragEvent) => {
    if (!dragHasFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    setDragOver(false);
    const dropped = Array.from(event.dataTransfer.files);
    if (!busy && dropped.length) onDropFiles?.(dropped);
  };
  const [checklistOpen, setChecklistOpen] = React.useState(false);
  const [locationOpen, setLocationOpen] = React.useState(false);
  const tg = useTgPhone();
  if (tg) {
    return (
      <>
        <button type="button" data-attach-menu="" className={COMPOSER_ICON_BUTTON} aria-label={ct("chat.f.attach_menu")} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)}>
          <Paperclip aria-hidden="true" className="size-6" />
        </button>
        <TgAttachSheet
          open={open}
          onOpenChange={setOpen}
          parts={PARTS}
          tabs={attachTabsOf({ canPoll: items.includes("poll"), canChecklist: items.includes("checklist"), canLocation: items.includes("location") })}
          files={files}
          busy={busy}
          caption={caption}
          canSend={canSend}
          onCaption={onCaption}
          onPick={onPick}
          // a photo taken now joins the picks the way a dropped one does
          onCamera={onDropFiles}
          onRemove={onRemove}
          onEdit={onEdit}
          onHd={onHd}
          onSend={() => {
            setOpen(false);
            onSend();
          }}
          onChecklist={() => {
            setOpen(false);
            setChecklistOpen(true);
          }}
          onLocation={() => {
            setOpen(false);
            setLocationOpen(true);
          }}
          onDropFiles={onDropFiles}
        />
        {checklistOpen ? <ChecklistFromMenu onClose={() => setChecklistOpen(false)} /> : null}
        {locationOpen ? <LocationFromMenu onClose={() => setLocationOpen(false)} /> : null}
      </>
    );
  }
  return (
    <>
      <button type="button" data-attach-menu className={COMPOSER_ICON_BUTTON} aria-label={ct("chat.f.attach_menu")} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)}>
        <Paperclip aria-hidden="true" className="size-6" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className={`min-h-[55dvh] gap-0 bg-surface-1/95 pt-3 backdrop-blur-md${dragOver ? " outline-dashed outline-2 -outline-offset-8 outline-accent" : ""}`}
          hideClose
          data-drag-over={dragOver ? "" : undefined}
          onDragOver={takeDrag}
          onDragLeave={(event) => {
            // leaving for a child of the sheet is not leaving
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
          }}
          onDrop={dropFiles}
        >
          <SheetTitle className="sr-only">{ct("chatui.attachsheet.title")}</SheetTitle>
          <SheetDescription className="sr-only">{ct("chatui.attachsheet.empty")}</SheetDescription>
          <AttachSheetPanel
            items={items}
            files={files}
            busy={busy}
            caption={caption}
            canSend={canSend}
            onCaption={onCaption}
            onRemove={onRemove}
            onEdit={onEdit}
            onHd={onHd}
            onSend={() => {
              setOpen(false);
              onSend();
            }}
            onPick={(id) => {
              if (id === "checklist") {
                setOpen(false);
                setChecklistOpen(true);
              } else if (id === "location") {
                setOpen(false);
                setLocationOpen(true);
              } else if (id === "poll") {
                setOpen(false);
                onPick(id);
              } else {
                onPick(id);
              }
            }}
          />
        </SheetContent>
      </Sheet>
      {checklistOpen ? <ChecklistFromMenu onClose={() => setChecklistOpen(false)} /> : null}
      {locationOpen ? <LocationFromMenu onClose={() => setLocationOpen(false)} /> : null}
    </>
  );
}
