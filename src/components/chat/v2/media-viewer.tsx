"use client";

import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, MessageSquare, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ct } from "@/lib/chat/text";
import { useReturnFocus } from "@/components/ui/dialog";
import { ImageText } from "@/components/image-text";
import { stripFormatting } from "@/lib/chat/format/parse";
import { isAlbumMedia, safeMediaUrl } from "@/lib/chat/album-layout";
import type { AttachmentDto, MessageDto } from "@/server/chat/dto";
import { mediaPageUrl } from "@/lib/chat/v2/info/info-tabs";
import type { MediaItemDto, MediaPageDto } from "@/server/chat/media";

/**
 * C3b.3 — THE MEDIA VIEWER of the new chat screen: a full-screen dialog over everything for the pictures and videos of a conversation.
 *
 *   ← / →  (and a swipe)      the previous / next one (direction follows the screen: in Arabic the LEFT arrow is NEXT)
 *   wheel · pinch · double tap   zoom a picture (+ / − / 0 on the keyboard; drag to move it while zoomed)
 *   Esc                        closes the viewer, and ONLY the viewer
 *   download · «اعرض بالمحادثة» · the caption · videos with their own native controls
 *
 * It is a real Radix dialog (focus kept inside and given back, the page behind inert and not scrolling, announced by its title) so the chat's own key layer
 * (`shortcuts.ts`: a `[role="dialog"]` on the page is an overlay) leaves Esc to it and the conversation stays open.
 *
 * The list (C3d): the media of the messages that are LOADED (`viewerItemsOf`, oldest first, never the files of a deleted message) joined, once the viewer is open, with
 * the whole conversation's from `GET …/media?kind=MEDIA` (`viewerItemOfMedia` / `mergeViewerItems`), so the arrows reach pictures that were never loaded. The
 * route never returns the file of a deleted message either, and a message the screen knows was deleted since is dropped from the fetched part at once.
 */

export { safeMediaUrl };

/** the pictures the text reader accepts (the bubble asks the same list) */
export const OCR_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface ViewerItem {
  /** the attachment's id (a key and what the bubble's tap is matched against) */
  id: string;
  /** the message it came from, when the source knows it (it is what «اعرض بالمحادثة» jumps to) */
  messageId: string | null;
  attachment: AttachmentDto;
  url: string;
  /** the message's words without their markers, or null */
  caption: string | null;
  authorName: string | null;
  /** C3d: the message's time (ISO) and the picture's place inside it, when the source knows them: what orders the loaded part and the fetched part together */
  at?: string;
  position?: number;
}

function itemOf(attachment: AttachmentDto, message: (Pick<MessageDto, "id" | "body" | "authorName"> & { createdAt?: string }) | null, position?: number): ViewerItem | null {
  const url = safeMediaUrl(attachment.url);
  if (!url || !isAlbumMedia(attachment)) return null;
  const caption = message?.body ? stripFormatting(message.body).trim() : "";
  return {
    id: attachment.id,
    messageId: message?.id ?? null,
    attachment,
    url,
    caption: caption || null,
    authorName: message?.authorName ?? null,
    ...(message?.createdAt ? { at: message.createdAt } : {}),
    ...(position !== undefined ? { position } : {}),
  };
}

/**
 * The LOADED part of the viewer's list: the pictures and videos of the given messages, in the order given (oldest first).
 * A deleted message gives nothing (its files are never exposed), nor does a voice note, a message that is only pending, or an address that is not ours.
 */
export function viewerItemsOf(messages: readonly MessageDto[]): ViewerItem[] {
  const out: ViewerItem[] = [];
  for (const message of messages) {
    if (message.deleted || message.kind === "VOICE" || message.kind === "SYSTEM" || message.pending || message.id.includes(":")) continue;
    message.attachments.forEach((attachment, index) => {
      const item = itemOf(attachment, message, index);
      if (item) out.push(item);
    });
  }
  return out;
}

/** C3d — the fetched part: the items of `GET …/media?kind=MEDIA` (newest first, as the route sends them) as viewer items, oldest first. */
export function viewerItemsOfMedia(items: readonly MediaItemDto[]): ViewerItem[] {
  const out: ViewerItem[] = [];
  for (const row of items) {
    const item = itemOf(row.attachment, { id: row.messageId, body: row.caption ?? "", authorName: row.authorName, createdAt: row.at }, row.position);
    if (item) out.push(item);
  }
  return out.reverse();
}

/**
 * C3d — the loaded part and the fetched part as ONE list, oldest first, each picture once (the loaded copy wins: it is the live one). A fetched picture whose message the
 * screen knows is deleted is dropped (the list was fetched a moment ago; the files of a deleted message never show). Items are ordered by the message's time, then
 * the picture's place in it; an item with no time (a source that does not know it) keeps its place next to the one before it.
 */
export function mergeViewerItems(loaded: readonly ViewerItem[], fetched: readonly ViewerItem[], deletedMessageIds: ReadonlySet<string> = new Set()): ViewerItem[] {
  const have = new Set(loaded.map((item) => item.id));
  const extra = fetched.filter((item) => !have.has(item.id) && !(item.messageId && deletedMessageIds.has(item.messageId)));
  if (extra.length === 0) return [...loaded];
  const all = [...loaded, ...extra];
  const keyed = all.map((item, index) => ({ item, index }));
  keyed.sort((a, b) => {
    const [x, y] = [a.item.at ?? "", b.item.at ?? ""];
    if (x !== y) return x < y ? -1 : 1;
    if (a.item.messageId && a.item.messageId === b.item.messageId) return (a.item.position ?? 0) - (b.item.position ?? 0) || a.index - b.index;
    return a.index - b.index;
  });
  return keyed.map((k) => k.item);
}

/** The viewer's list when nothing else is known: the media of one bubble. */
export function viewerItemsOfAttachments(attachments: readonly AttachmentDto[]): ViewerItem[] {
  return attachments.flatMap((a) => itemOf(a, null) ?? []);
}

/** The index of the item with this attachment id (0 when it is not there). */
export function indexOfItem(items: readonly ViewerItem[], id: string): number {
  const at = items.findIndex((item) => item.id === id);
  return at < 0 ? 0 : at;
}

/** One step through the list, without wrapping past the ends. */
export function stepIndex(index: number, step: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + step));
}

/** 1 = the NEXT one, -1 = the PREVIOUS one, 0 = not an arrow. In a right-to-left screen the next one is toward the left. */
export function stepOfKey(key: string, rtl: boolean): -1 | 0 | 1 {
  if (key === "ArrowLeft") return rtl ? 1 : -1;
  if (key === "ArrowRight") return rtl ? -1 : 1;
  return 0;
}

const SWIPE_MIN_PX = 60;
/** A swipe (the finger's travel in pixels) as a step: long enough, and mostly sideways. In a right-to-left screen a finger moving to the right brings the NEXT one in. */
export function swipeStepOf(dx: number, dy: number, rtl: boolean): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return rtl === dx > 0 ? 1 : -1;
}

export const MAX_SCALE = 6;
export const DOUBLE_TAP_SCALE = 2.5;
export interface View {
  scale: number;
  x: number;
  y: number;
}
const FIT: View = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(1, scale));
}
/** The scale after a wheel turn (a negative delta zooms in). */
export function wheelScale(scale: number, deltaY: number): number {
  return clampScale(scale * Math.exp(-deltaY * 0.0015));
}
/** Zoom to `next`, keeping the point `focal` (pixels from the stage's centre) where it is. Back to 1 recentres. */
export function zoomAt(view: View, next: number, focal: { x: number; y: number }): View {
  const scale = clampScale(next);
  if (scale === 1) return FIT;
  const ratio = scale / view.scale;
  return { scale, x: focal.x - (focal.x - view.x) * ratio, y: focal.y - (focal.y - view.y) * ratio };
}
/** Keeps the picture's edge from leaving the stage: a picture that fits (scale 1, or smaller than the stage) cannot be moved. */
export function clampPan(view: View, content: { w: number; h: number }, stage: { w: number; h: number }): View {
  const maxX = Math.max(0, (content.w * view.scale - stage.w) / 2);
  const maxY = Math.max(0, (content.h * view.scale - stage.h) / 2);
  return { scale: view.scale, x: Math.min(maxX, Math.max(-maxX, view.x)) + 0, y: Math.min(maxY, Math.max(-maxY, view.y)) + 0 };
}

/** What a tap on a picture asks the provider for: the picture, the list to use when the provider does not know it, and whether «اقرأ النص» is offered. */
export interface ViewerRequest {
  startId: string;
  fallback: ViewerItem[];
  canReadImages: boolean;
}

/** What a provider above the conversation gives the bubbles: the list of the loaded media, the viewer itself, and, when the conversation can scroll to a message, the jump. */
export interface MediaViewerSource {
  items: () => ViewerItem[];
  onShowInChat?: (messageId: string) => void;
  /** open the viewer HERE (above the list), not inside the bubble */
  open?: (request: ViewerRequest) => void;
}
export const MediaViewerContext = React.createContext<MediaViewerSource | null>(null);

const NO_ITEMS: ViewerItem[] = [];
/** The most pages of the media route one opening reads (60 each: the last thousand pictures and videos; the loaded ones always count). */
const MAX_MEDIA_PAGES = 16;

/**
 * C3d — the conversation's media as `GET …/media?kind=MEDIA` has it, read page by page while the viewer is open (and abandoned when it closes). A failure or a
 * refusal leaves the loaded part alone: the viewer then works exactly as it did before the route existed.
 */
function useFetchedMedia(conversationId: string | undefined, open: boolean): ViewerItem[] {
  const [fetched, setFetched] = React.useState<{ id: string; items: ViewerItem[] } | null>(null);
  React.useEffect(() => {
    if (!open || !conversationId) return;
    // what an earlier opening fetched is old by now (a message may have been deleted since): only loaded media shows until the first page of THIS opening arrives
    setFetched(null);
    const controller = new AbortController();
    void (async () => {
      const rows: MediaItemDto[] = [];
      let before: string | null = null;
      for (let page = 0; page < MAX_MEDIA_PAGES; page++) {
        try {
          const res = await fetch(mediaPageUrl(conversationId, "MEDIA", before), { signal: controller.signal, cache: "no-store" });
          if (!res.ok) return;
          const body = (await res.json()) as MediaPageDto;
          rows.push(...body.items);
          setFetched({ id: conversationId, items: viewerItemsOfMedia(rows) });
          if (!body.next) return;
          before = body.next;
        } catch {
          return;
        }
      }
    })();
    return () => controller.abort();
  }, [open, conversationId]);
  return fetched && fetched.id === conversationId ? fetched.items : NO_ITEMS;
}

/**
 * Wrap the conversation's messages once: every bubble's tap opens the viewer on the conversation's media (not only its own), and the viewer is drawn HERE, above
 * the virtual list, so a bubble that is deleted or scrolled out of the window while the viewer is open does not take the viewer with it. The list is asked again on
 * every render (a deleted message's files drop out at once).
 */
export function MediaViewerProvider({ messages, conversationId, onShowInChat, children }: { messages: readonly MessageDto[]; /** C3d: with it, the viewer also steps through the media that is not loaded (`GET …/media`) */ conversationId?: string; onShowInChat?: (messageId: string) => void; children?: React.ReactNode }) {
  const [request, setRequest] = React.useState<ViewerRequest | null>(null);
  const close = React.useCallback(() => setRequest(null), []);
  const fetched = useFetchedMedia(conversationId, request !== null);
  const value = React.useMemo<MediaViewerSource>(() => ({ items: () => viewerItemsOf(messages), onShowInChat, open: setRequest }), [messages, onShowInChat]);
  let items: ViewerItem[] = [];
  if (request) {
    const deleted = new Set(messages.filter((m) => m.deleted).map((m) => m.id));
    const merged = mergeViewerItems(viewerItemsOf(messages), fetched, deleted);
    items = merged.some((item) => item.id === request.startId) ? merged : request.fallback;
  }
  return (
    <MediaViewerContext.Provider value={value}>
      {children}
      {request ? <MediaViewer items={items} startId={request.startId} onClose={close} onShowInChat={onShowInChat} canReadImages={request.canReadImages} /> : null}
    </MediaViewerContext.Provider>
  );
}

const swallow = (event: React.SyntheticEvent) => event.stopPropagation();
const TAP_MS = 300;
const TAP_PX = 30;
const MOVED_PX = 8;

const barButton = "inline-flex size-11 items-center justify-center rounded-lg text-on-photo transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30";

interface Gesture {
  kind: "pan" | "pinch";
  startX: number;
  startY: number;
  startAt: number;
  moved: boolean;
  base: View;
  dist0: number;
  mid0: { x: number; y: number };
}

/**
 * The viewer itself. `items` is the LIVE list (see `viewerItemsOf`: the caller recomputes it, so a deleted message's files drop out at once), `startId` the picture that was tapped. The parent draws it only while it is open and
 * closes it in `onClose`. `onShowInChat` (optional) draws «اعرض بالمحادثة»; `canReadImages` draws «اقرأ النص» under a picture, as the bubble does.
 */
export function MediaViewer({ items, startId, onClose, onShowInChat, canReadImages = false }: { items: ViewerItem[]; startId: string; onClose: () => void; onShowInChat?: (messageId: string) => void; canReadImages?: boolean }) {
  const [currentId, setCurrentId] = React.useState(startId);
  const lastAt = React.useRef(indexOfItem(items, startId));
  const [view, setView] = React.useState<View>(FIT);
  const [gesturing, setGesturing] = React.useState(false);
  const [rtl, setRtl] = React.useState(true);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = React.useState<HTMLDivElement | null>(null);
  // the dialog's content (and the stage inside it) is drawn one commit AFTER this component (Radix mounts its portal in a layout effect), so a ref read in a mount
  // effect would still be null: the direction is read, and the wheel listener attached, when the node arrives
  const setContent = React.useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
    if (node) setRtl(getComputedStyle(node).direction !== "ltr");
  }, []);
  const jumping = React.useRef(false);
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<Gesture | null>(null);
  const lastTap = React.useRef<{ at: number; x: number; y: number } | null>(null);
  const viewRef = React.useRef(view);
  viewRef.current = view;
  // «اعرض بالمحادثة» goes to ANOTHER place: focus is not given back to the bubble the viewer was opened from (that would scroll it into view and undo the jump)
  const returnFocus = useReturnFocus((event) => {
    if (jumping.current) event.preventDefault();
  });
  const empty = items.length === 0;
  React.useEffect(() => {
    if (empty) onClose();
  }, [empty, onClose]);

  // the list is live: the picture is found by its id; when it is gone (its message was deleted) the viewer stays where it was, on whatever is there now
  const found = items.findIndex((candidate) => candidate.id === currentId);
  const at = found >= 0 ? found : Math.min(lastAt.current, Math.max(0, items.length - 1));
  lastAt.current = at;
  const item = items[at];
  const isImage = item?.attachment.kind === "IMAGE";
  const isImageRef = React.useRef(isImage);
  isImageRef.current = isImage;

  const measure = React.useCallback(() => {
    const img = imageRef.current;
    return { stage: { w: stage?.clientWidth ?? 0, h: stage?.clientHeight ?? 0 }, content: { w: img?.clientWidth ?? 0, h: img?.clientHeight ?? 0 } };
  }, [stage]);
  const relative = React.useCallback(
    (clientX: number, clientY: number) => {
      const rect = stage?.getBoundingClientRect();
      return rect ? { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) } : { x: 0, y: 0 };
    },
    [stage],
  );
  const apply = React.useCallback(
    (next: View) => {
      const { stage, content } = measure();
      setView(next.scale <= 1.02 ? FIT : clampPan(next, content, stage));
    },
    [measure],
  );

  function go(step: number) {
    const next = stepIndex(at, step, items.length);
    if (next === at) return;
    setCurrentId(items[next]!.id);
    setView(FIT);
    pointers.current.clear();
    gesture.current = null;
    lastTap.current = null;
  }
  const zoomBy = (factor: number) => apply(zoomAt(viewRef.current, viewRef.current.scale * factor, { x: 0, y: 0 }));

  // the wheel zooms a picture. A passive listener cannot stop the page behind from moving, so it is attached by hand
  React.useEffect(() => {
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!isImageRef.current) return;
      event.preventDefault();
      const current = viewRef.current;
      apply(zoomAt(current, wheelScale(current.scale, event.deltaY * (event.ctrlKey ? 3 : 1)), relative(event.clientX, event.clientY)));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [stage, apply, relative]);

  function onPointerDown(event: React.PointerEvent) {
    // the arrows and the buttons over the stage are theirs: capturing the pointer here would swallow their click
    // a right or middle button is the browser's (a menu, a scroll), never a pan or a swipe
    if (!isImage || (event.target as HTMLElement).closest("button") || (event.pointerType === "mouse" && event.button !== 0)) return;
    try {
      stage?.setPointerCapture(event.pointerId);
    } catch {
      /* a pointer that is already gone */
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setGesturing(true);
    const rel = relative(event.clientX, event.clientY);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { kind: "pinch", startX: 0, startY: 0, startAt: Date.now(), moved: true, base: viewRef.current, dist0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid0: relative((a.x + b.x) / 2, (a.y + b.y) / 2) };
    } else if (pointers.current.size === 1) {
      gesture.current = { kind: "pan", startX: event.clientX, startY: event.clientY, startAt: Date.now(), moved: false, base: viewRef.current, dist0: 1, mid0: rel };
    }
  }
  function onPointerMove(event: React.PointerEvent) {
    const g = gesture.current;
    if (!g || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = relative((a.x + b.x) / 2, (a.y + b.y) / 2);
      const zoomed = zoomAt(g.base, g.base.scale * (dist / g.dist0), g.mid0);
      apply({ ...zoomed, x: zoomed.x + (mid.x - g.mid0.x), y: zoomed.y + (mid.y - g.mid0.y) });
    } else if (g.kind === "pan") {
      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;
      if (Math.hypot(dx, dy) > MOVED_PX) g.moved = true;
      if (g.base.scale > 1) apply({ scale: g.base.scale, x: g.base.x + dx, y: g.base.y + dy });
    }
  }
  function onPointerUp(event: React.PointerEvent) {
    const g = gesture.current;
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0) {
      // one finger of a pinch is up: the pinch is over, nothing else is decided by the other one
      gesture.current = null;
      return;
    }
    setGesturing(false);
    gesture.current = null;
    if (!g || g.kind !== "pan") return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    const now = Date.now();
    if (!g.moved && now - g.startAt < TAP_MS) {
      const previous = lastTap.current;
      if (previous && now - previous.at < TAP_MS && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < TAP_PX) {
        lastTap.current = null;
        const current = viewRef.current;
        apply(current.scale > 1 ? FIT : zoomAt(current, DOUBLE_TAP_SCALE, g.mid0));
      } else {
        lastTap.current = { at: now, x: event.clientX, y: event.clientY };
      }
      return;
    }
    if (g.moved && g.base.scale === 1 && viewRef.current.scale === 1) go(swipeStepOf(dx, dy, rtl));
  }

  /** the browser took the gesture away (a scroll, a system swipe): nothing is decided from it */
  function onPointerCancel(event: React.PointerEvent) {
    pointers.current.delete(event.pointerId);
    gesture.current = null;
    if (pointers.current.size === 0) setGesturing(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement;
    const ownsKeys = target.tagName === "VIDEO" || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
    if (!ownsKeys && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const step = stepOfKey(event.key, rtl);
      if (step) {
        event.preventDefault();
        go(step);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        go(event.key === "Home" ? -items.length : items.length);
      } else if (isImage && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomBy(1.5);
      } else if (isImage && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        zoomBy(1 / 1.5);
      } else if (isImage && event.key === "0") {
        event.preventDefault();
        setView(FIT);
      }
    }
    // a key pressed here is the viewer's: it never reaches the bubble it was opened from
    event.stopPropagation();
  }

  if (!item) return null;
  const Previous = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const showInChat = onShowInChat && item.messageId ? onShowInChat : null;

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-media-viewer-overlay className="fixed inset-0 z-[90] bg-scrim" />
        <DialogPrimitive.Content
          ref={setContent}
          data-media-viewer
          tabIndex={-1}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          onKeyDown={onKeyDown}
          onPointerDown={swallow}
          onPointerUp={swallow}
          onPointerMove={swallow}
          onPointerCancel={swallow}
          onTouchStart={swallow}
          onTouchMove={swallow}
          onTouchEnd={swallow}
          onDoubleClick={swallow}
          onContextMenu={swallow}
          onClick={swallow}
          className="fixed inset-0 z-[91] flex flex-col text-on-photo outline-none"
        >
          {returnFocus.noteOpener}
          <DialogPrimitive.Title className="sr-only">{ct("chatalb.viewer")}</DialogPrimitive.Title>
          <div className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <DialogPrimitive.Close className={barButton} aria-label={ct("chatalb.close")}>
              <X className="size-5" aria-hidden="true" />
            </DialogPrimitive.Close>
            <p data-viewer-position className="min-w-0 flex-1 truncate text-sm" aria-live="polite">
              {ct("chatalb.position", { n: at + 1, total: items.length })}
              {item.authorName ? <span className="ms-2 text-xs opacity-80">{item.authorName}</span> : null}
            </p>
            {isImage ? (
              <>
                <button type="button" className={barButton} aria-label={ct("chatalb.zoom_out")} disabled={view.scale <= 1} onClick={() => zoomBy(1 / 1.5)}>
                  <ZoomOut className="size-5" aria-hidden="true" />
                </button>
                <button type="button" className={barButton} aria-label={ct("chatalb.zoom_in")} disabled={view.scale >= MAX_SCALE} onClick={() => zoomBy(1.5)}>
                  <ZoomIn className="size-5" aria-hidden="true" />
                </button>
              </>
            ) : null}
            {showInChat ? (
              <button
                type="button"
                data-viewer-show
                className={cn(barButton, "w-auto gap-1.5 px-3 text-sm")}
                onClick={() => {
                  jumping.current = true;
                  showInChat(item.messageId as string);
                  onClose();
                }}
              >
                <MessageSquare className="size-4" aria-hidden="true" />
                <span>{ct("chatalb.show")}</span>
              </button>
            ) : null}
            <a href={item.url} download={item.attachment.name} className={barButton} aria-label={ct("chatc.download", { name: item.attachment.name })}>
              <Download className="size-5" aria-hidden="true" />
            </a>
          </div>

          <div
            ref={setStage}
            data-viewer-stage
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
            style={isImage ? { touchAction: "none" } : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- our own attachment address (checked above); the zoom is a CSS transform on the real file
              <img
                key={item.id}
                ref={imageRef}
                src={item.url}
                alt={item.attachment.name}
                draggable={false}
                className="max-h-full max-w-full select-none object-contain"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: gesturing ? "none" : "transform 120ms ease-out" }}
              />
            ) : (
              <video key={item.id} src={item.url} controls playsInline preload="metadata" aria-label={item.attachment.name} className="max-h-full max-w-full" />
            )}
            {items.length > 1 ? (
              <>
                <button type="button" data-viewer-prev className={cn(barButton, "absolute start-2 top-1/2 -translate-y-1/2 bg-scrim/60")} aria-label={ct("chatalb.prev")} disabled={at === 0} onClick={() => go(-1)}>
                  <Previous className="size-6" aria-hidden="true" />
                </button>
                <button type="button" data-viewer-next className={cn(barButton, "absolute end-2 top-1/2 -translate-y-1/2 bg-scrim/60")} aria-label={ct("chatalb.next")} disabled={at === items.length - 1} onClick={() => go(1)}>
                  <Next className="size-6" aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>

          {item.caption || (canReadImages && isImage && OCR_MIMES.has(item.attachment.mime)) ? (
            <div className="flex max-h-[40%] flex-col gap-2 overflow-y-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
              {item.caption ? (
                <p data-viewer-caption dir="auto" className="whitespace-pre-wrap text-sm leading-relaxed">
                  {item.caption}
                </p>
              ) : null}
              {canReadImages && isImage && OCR_MIMES.has(item.attachment.mime) ? (
                <div className="rounded-lg bg-surface-1 p-2 text-fg">
                  <ImageText key={item.id} endpoint={`/api/chat/attachments/${encodeURIComponent(item.id)}/text`} />
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
