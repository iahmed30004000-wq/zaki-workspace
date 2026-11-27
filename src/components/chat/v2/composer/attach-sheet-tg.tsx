"use client";

import React from "react";
import { flushSync } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Camera, ChartColumn, FileText, Image as ImageIcon, Images, ListChecks, UserRound, type LucideIcon } from "lucide-react";
import { Sheet, SheetDescription, SheetOverlay, SheetPanel, SheetTitle } from "@/components/ui/sheet";
import { ContactTab } from "@/components/chat/v2/composer/attach-contacts";
import { PhotoEditor } from "@/components/chat/v2/composer/photo-editor";
import { PollCreateButton, TgPollForm } from "@/components/chat/v2/composer/poll-form-tg";
import { createPoll } from "@/components/chat/composer/poll-dialog";
import { usePaneActions } from "@/components/chat/v2/pane/pane-actions";
import { appendMessage } from "@/lib/chat/cache/writer";
import { messageClientId } from "@/lib/chat/conversation/client";
import { emptyPollDraft, pollDraftProblem, type PollDraft } from "@/lib/chat/poll-client";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";
import { effectOn } from "@/lib/motion/effects";
import { TG_MOTION, tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { dragHasFiles } from "@/lib/chat/v2/composer/clipboard-files";
import { sheetDragOffset, sheetDragOutcome, type SheetSize } from "@/lib/chat/v2/composer/sheet-drag";
import type { AttachTabId } from "@/lib/chat/v2/composer/attach-items";
import type { PendingFile } from "@/lib/chat/v2/composer/types";
import "@/components/chat/v2/tg-sheets.css";

/**
 * «المرفقات» on a phone with Telegram's look: a sheet at about half the screen that slides in over a dim, with the kinds as tabs at the bottom (المعرض · ملف
 * · استفتاء · جهة اتصال, and the checklist the app already had). Dragged up by its head it is a full page («استفتاء جديد» for the poll); dragged down it
 * steps back and closes. Location and articles are not here: the app has neither.
 */
const ICONS: Record<AttachTabId, LucideIcon> = { media: ImageIcon, file: FileText, poll: ChartColumn, contact: UserRound, checklist: ListChecks };
/** Each kind's own colour: the theme's categorical tokens. */
const TONES: Record<AttachTabId, string> = { media: "text-cat-6", file: "text-cat-4", poll: "text-cat-1", contact: "text-cat-3", checklist: "text-cat-5" };
const LABELS: Record<AttachTabId, string> = { media: "chatui.attachsheet.gallery", file: "tgsheets.attach.file", poll: "tgsheets.attach.poll", contact: "tgsheets.attach.contact", checklist: "chatcl.menu" };

export interface AttachTileProps {
  item: PendingFile;
  index: number;
  busy: boolean;
  onRemove: (index: number) => void;
  onStartEdit?: () => void;
  onHd?: (index: number, on: boolean) => void;
}
export interface AttachCaptionProps {
  count: number;
  busy: boolean;
  caption: string;
  canSend: boolean;
  onCaption: (value: string) => void;
  onSend: () => void;
}
/** The pieces the older sheet already draws (a numbered tile, the caption with its send button): handed in, so there is one of each. */
export interface AttachParts {
  Tile: React.ComponentType<AttachTileProps>;
  CaptionBar: React.ComponentType<AttachCaptionProps>;
}

export interface TgAttachPanelProps {
  parts: AttachParts;
  tabs: AttachTabId[];
  tab: AttachTabId;
  size: SheetSize;
  files: PendingFile[];
  busy: boolean;
  caption: string;
  canSend: boolean;
  onTab: (id: AttachTabId) => void;
  /** the full page's back arrow: half height again */
  onBack: () => void;
  onExpand?: () => void;
  onCaption: (value: string) => void;
  /** the system's own pickers (the composer's hidden inputs) */
  onPick: (kind: "media" | "file") => void;
  /** pictures taken with the phone's camera; absent: no camera tile */
  onCamera?: (files: File[]) => void;
  onRemove: (index: number) => void;
  onStartEdit?: (index: number) => void;
  onHd?: (index: number, on: boolean) => void;
  onSend: () => void;
  /** the poll form or the contacts */
  content?: React.ReactNode;
  /** «إنشاء» in the full page's bar */
  headerAction?: React.ReactNode;
  /** the head is dragged to change the sheet's size */
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function TgAttachPanel({ parts, tabs, tab, size, files, busy, caption, canSend, onTab, onBack, onExpand, onCaption, onPick, onCamera, onRemove, onStartEdit, onHd, onSend, content, headerAction, dragProps }: TgAttachPanelProps) {
  const camera = React.useRef<HTMLInputElement>(null);
  const { Tile, CaptionBar } = parts;
  const full = size === "full";
  const picks = tab === "media" || tab === "file";
  const has = files.length > 0;
  const tiles = files.map((item, index) => <Tile key={`${item.file.name}-${index}`} item={item} index={index} busy={busy} onRemove={onRemove} {...(onStartEdit ? { onStartEdit: () => onStartEdit(index) } : {})} {...(onHd ? { onHd } : {})} />);
  const square = "flex size-full flex-col items-center justify-center gap-1.5 rounded-lg bg-surface-1 p-2 text-center text-xs font-medium text-fg disabled:opacity-60";
  const fileRow = "flex min-h-16 w-full items-center gap-3 px-4 text-start disabled:opacity-60";
  return (
    <div data-attach-sheet="" data-size={size} className="flex min-h-0 flex-1 flex-col">
      <div data-attach-drag="" {...dragProps} className="shrink-0 touch-none select-none">
        {full ? (
          <div data-attach-bar="" className="flex min-h-14 items-center gap-2 border-b border-border bg-surface-1 px-2">
            <button type="button" data-attach-back="" aria-label={ct("tgsheets.settings.back")} onClick={onBack} className="grid size-11 shrink-0 place-items-center rounded-full text-fg">
              <ArrowRight aria-hidden="true" className="size-5" />
            </button>
            <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{ct(tab === "poll" ? "tgsheets.poll.new" : LABELS[tab])}</h2>
            {headerAction}
          </div>
        ) : (
          <button type="button" data-attach-handle="" aria-label={ct("tgsheets.attach.expand")} onClick={onExpand} className="flex min-h-6 w-full items-center justify-center py-2.5 focus-visible:outline-none [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-accent">
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-fg-muted/40" />
          </button>
        )}
      </div>

      <div id="tg-attach-body" role="tabpanel" aria-label={ct(LABELS[tab])} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", full && "pt-3")}>
        {tab === "media" ? (
          <>
            <ul data-attach-grid="" className="grid grid-cols-3 gap-1.5 px-2">
              {onCamera ? (
                <li className="aspect-square">
                  <button type="button" data-attach-camera="" disabled={busy} onClick={() => camera.current?.click()} className={square}>
                    <Camera aria-hidden="true" className="size-8 text-accent" />
                    {ct("tgsheets.attach.camera")}
                  </button>
                </li>
              ) : null}
              {tiles}
              <li className="aspect-square">
                <button type="button" data-attach-gallery="" disabled={busy} onClick={() => onPick("media")} className={square}>
                  <Images aria-hidden="true" className="size-8 text-cat-6" />
                  {ct(has ? "chatui.attachsheet.more" : "tgsheets.attach.from_gallery")}
                </button>
              </li>
            </ul>
            {has ? null : <p className="px-6 py-4 text-center text-sm text-fg-muted">{ct("tgsheets.attach.gallery_hint")}</p>}
          </>
        ) : tab === "file" ? (
          <>
            <div className="mx-2 divide-y divide-border rounded-2xl bg-surface-1">
              <button type="button" data-attach-file="" disabled={busy} onClick={() => onPick("file")} className={fileRow}>
                <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-cat-4 text-on-photo">
                  <FileText className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] text-fg">{ct("tgsheets.attach.from_device")}</span>
                  <span className="block text-xs text-fg-muted">{ct("tgsheets.attach.from_device_hint")}</span>
                </span>
              </button>
              <button type="button" data-attach-file-media="" disabled={busy} onClick={() => onPick("media")} className={fileRow}>
                <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-cat-6 text-on-photo">
                  <Images className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] text-fg">{ct("tgsheets.attach.from_gallery")}</span>
                  <span className="block text-xs text-fg-muted">{ct("tgsheets.attach.from_gallery_hint")}</span>
                </span>
              </button>
            </div>
            {has ? <ul data-attach-grid="" className="mt-2 grid grid-cols-3 gap-1.5 px-2">{tiles}</ul> : null}
          </>
        ) : (
          content
        )}
        {onCamera ? (
          // the phone's own camera, through a file input: the browser asks for no permission of its own
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const taken = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (taken.length > 0) onCamera(taken);
            }}
          />
        ) : null}
      </div>

      {picks && has ? (
        <div className="shrink-0 py-2">
          <CaptionBar count={files.length} busy={busy} caption={caption} canSend={canSend} onCaption={onCaption} onSend={onSend} />
        </div>
      ) : null}

      {full ? null : (
        <div role="tablist" aria-label={ct("chatui.attachsheet.kinds")} className="tg-no-scrollbar mx-3 mb-2 mt-1 flex shrink-0 items-center gap-1 overflow-x-auto rounded-full border border-border/60 bg-surface-1 p-1 shadow-card">
          {tabs.map((id) => {
            const Icon = ICONS[id];
            const selected = id === tab;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="tg-attach-body"
                data-attach-tab={id}
                onClick={() => onTab(id)}
                className={cn("flex min-h-12 min-w-16 flex-1 shrink-0 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-xs font-medium", selected ? "bg-accent/10 text-accent" : "text-fg-muted")}
              >
                <Icon aria-hidden="true" className={cn("size-5", selected ? "text-accent" : TONES[id])} />
                <span className="whitespace-nowrap">{ct(LABELS[id])}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface TgAttachSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parts: AttachParts;
  tabs: AttachTabId[];
  files: PendingFile[];
  busy: boolean;
  caption: string;
  canSend: boolean;
  onCaption: (value: string) => void;
  onPick: (kind: "media" | "file") => void;
  onCamera?: (files: File[]) => void;
  onRemove: (index: number) => void;
  onEdit?: (index: number, file: File) => void;
  onHd?: (index: number, on: boolean) => void;
  onSend: () => void;
  onChecklist: () => void;
  onDropFiles?: (files: File[]) => void;
}

type Drag = { pointer: number; y: number; moved: boolean };

/** What is inside the open sheet: mounted only while it is open, so the pane is asked and the poll starts empty each time. */
function TgAttachBody({ panel, size, setSize, ...p }: TgAttachSheetProps & { panel: React.RefObject<HTMLDivElement>; size: SheetSize; setSize: (size: SheetSize) => void }) {
  const qc = useQueryClient();
  const pane = usePaneActions();
  const [tab, setTab] = React.useState<AttachTabId>("media");
  const [editing, setEditing] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<PollDraft>(emptyPollDraft);
  const [clientId, setClientId] = React.useState(() => messageClientId());
  const [sending, setSending] = React.useState(false);
  const [pollError, setPollError] = React.useState("");
  const drag = React.useRef<Drag | null>(null);
  const dragged = React.useRef(false);

  /** The new size at once, and the slide from where the sheet was (`translate`, which the sheet's own entrance animation does not hold). */
  const resize = (next: SheetSize) => {
    const el = panel.current;
    const before = el?.getBoundingClientRect().top ?? 0;
    if (el) el.style.translate = "";
    flushSync(() => setSize(next));
    if (!el || typeof el.animate !== "function" || !effectOn("transitions")) return;
    const shift = before - el.getBoundingClientRect().top;
    if (shift !== 0) el.animate([{ translate: `0 ${shift}px` }, { translate: "0 0" }], { duration: TG_MOTION.sheetMs, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
  };

  const dragProps: React.HTMLAttributes<HTMLDivElement> = {
    onPointerDown: (event) => {
      dragged.current = false;
      const target = event.target as Element;
      // the bar's own buttons are tapped, never dragged
      if (target.closest("[data-attach-back], [data-poll-create]")) return;
      drag.current = { pointer: event.pointerId, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event) => {
      const d = drag.current;
      if (!d || d.pointer !== event.pointerId || !panel.current) return;
      const dy = event.clientY - d.y;
      if (Math.abs(dy) > 6) d.moved = true;
      if (d.moved) panel.current.style.translate = `0 ${sheetDragOffset(size, dy)}px`;
    },
    onPointerUp: (event) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.pointer !== event.pointerId || !d.moved) {
        // a plain tap on the handle (the pointer was captured by the head, so no click reaches the button)
        if (d && size === "half" && (event.target as Element).closest("[data-attach-drag]")) resize("full");
        return;
      }
      dragged.current = true;
      const next = sheetDragOutcome(size, event.clientY - d.y);
      if (next === "close") p.onOpenChange(false);
      else resize(next);
    },
    onPointerCancel: () => {
      drag.current = null;
      resize(size);
    },
  };

  const problem = pollDraftProblem(draft);
  async function create() {
    if (sending || problem) return;
    setSending(true);
    setPollError("");
    try {
      const message = await createPoll(pane.conversationId, draft, clientId);
      appendMessage(qc, pane.conversationId, message);
      p.onOpenChange(false);
      pane.toNewest();
    } catch (e) {
      setPollError(e instanceof Error ? e.message : ct("chatc.poll.failed"));
      setSending(false);
    }
  }
  const createButton = <PollCreateButton disabled={problem !== null} busy={sending} onCreate={() => void create()} />;
  const editingFile = editing !== null ? p.files[editing] : undefined;

  return (
    <>
      <TgAttachPanel
        parts={p.parts}
        tabs={p.tabs}
        tab={tab}
        size={size}
        files={p.files}
        busy={p.busy}
        caption={p.caption}
        canSend={p.canSend}
        onTab={(id) => (id === "checklist" ? p.onChecklist() : setTab(id))}
        onBack={() => resize("half")}
        // the keyboard's way up (a finger's tap is handled with the drag)
        onExpand={() => {
          if (!dragged.current && size === "half") resize("full");
        }}
        onCaption={p.onCaption}
        onPick={p.onPick}
        {...(p.onCamera ? { onCamera: p.onCamera } : {})}
        onRemove={p.onRemove}
        {...(p.onEdit ? { onStartEdit: setEditing } : {})}
        {...(p.onHd ? { onHd: p.onHd } : {})}
        onSend={p.onSend}
        dragProps={dragProps}
        headerAction={tab === "poll" ? createButton : null}
        content={
          tab === "poll" ? (
            <TgPollForm
              draft={draft}
              error={pollError}
              action={size === "half" ? createButton : null}
              onChange={(patch) => {
                // a changed poll is a different send: the id is renewed, so a retry of the same words never makes two
                setClientId(messageClientId());
                setDraft((d) => ({ ...d, ...patch }));
              }}
            />
          ) : tab === "contact" ? (
            <ContactTab onSent={() => p.onOpenChange(false)} />
          ) : null
        }
      />
      {editingFile && editing !== null && p.onEdit ? (
        <PhotoEditor
          file={editingFile.file}
          onCancel={() => setEditing(null)}
          onDone={(edited) => {
            p.onEdit?.(editing, edited);
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

export function TgAttachSheet(props: TgAttachSheetProps) {
  const [size, setSize] = React.useState<SheetSize>("half");
  const [wasOpen, setWasOpen] = React.useState(props.open);
  const [dragOver, setDragOver] = React.useState(false);
  const panel = React.useRef<HTMLDivElement>(null);
  // every opening starts at half height (adjusted while rendering: no frame of the old size)
  if (wasOpen !== props.open) {
    setWasOpen(props.open);
    if (props.open) setSize("half");
  }
  const vars = tgMotionVars(["sheetMs"]) as React.CSSProperties;
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <SheetOverlay className="tg-attach-dim" style={vars} />
        <SheetPanel
          ref={panel}
          hideClose
          style={vars}
          data-tg-attach={size}
          data-drag-over={dragOver ? "" : undefined}
          className={cn("tg-attach-sheet max-h-[100dvh] gap-0 overflow-hidden bg-surface-2", size === "full" ? "h-[100dvh] rounded-none border-t-0 pt-[env(safe-area-inset-top)]" : "h-[64dvh]", dragOver && "outline-dashed outline-2 -outline-offset-8 outline-accent")}
          onDragOver={(event) => {
            if (!dragHasFiles(event.dataTransfer.types)) return;
            event.preventDefault();
            if (!props.busy) setDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
          }}
          onDrop={(event) => {
            if (!dragHasFiles(event.dataTransfer.types)) return;
            event.preventDefault();
            setDragOver(false);
            const dropped = Array.from(event.dataTransfer.files);
            if (!props.busy && dropped.length) props.onDropFiles?.(dropped);
          }}
        >
          <SheetTitle className="sr-only">{ct("chatui.attachsheet.title")}</SheetTitle>
          <SheetDescription className="sr-only">{ct("chatui.attachsheet.empty")}</SheetDescription>
          <TgAttachBody {...props} panel={panel} size={size} setSize={setSize} />
        </SheetPanel>
      </DialogPrimitive.Portal>
    </Sheet>
  );
}
