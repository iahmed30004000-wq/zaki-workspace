"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PurgeConfirm, RowMenuItems, rowMenuOffers, useRowCall, type RowAction } from "@/components/chat/home/row-menu";
import { chatKeys } from "@/lib/chat/cache/keys";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { chatHref } from "@/lib/chat/v2/routes";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

/**
 * C2.2 — the menu of a row of the new list: right-click on the computer, a long press on the phone, and a «⋮» that shows when the pointer rests on the
 * row. It offers EXACTLY what today's «⋯» offers (`src/components/chat/home/row-menu.tsx`: pin for everybody, archive the topic, delete an empty one, and
 * the owner's «حذف نهائي» with its confirmation, unchanged), because it is built from the same pieces. What a person may not do is not offered, and the
 * server decides again. The personal pin, archive, mute and «علّم كغير مقروء» are C3a: they are NOT drawn here, not even disabled.
 *
 * Behind «قائمة المحادثة» (`chatRowMenu`, the same switch as the old «⋯»): the layout hands `enabled` down.
 */

export interface RowMenuContext {
  /** the company's switch `chatRowMenu` */
  enabled: boolean;
  /** the owner rank's «حذف نهائي» (D-A4: the rank, not the oversight capability: it is not a reading decision) */
  canPurge: boolean;
  /** the viewer manages the space of this topic (the forum view knows it from its header; the list of one space from the space's own view) */
  canModerate: boolean;
}

/** What the menu of this row would offer: a space row has no menu (its id is a space's, never a conversation's). */
export function rowMenuTargetOf(row: ChatRowDto, ctx: RowMenuContext) {
  const kind: "topic" | "dm" = row.kind === "TOPIC" ? "topic" : "dm";
  return {
    kind,
    archived: row.archived === true,
    system: row.system === true,
    canModerate: kind === "topic" && ctx.canModerate,
    canPurge: ctx.canPurge,
  };
}

export function rowHasMenu(row: ChatRowDto, ctx: RowMenuContext): boolean {
  if (!ctx.enabled || row.kind === "SPACE") return false;
  return rowMenuOffers(rowMenuTargetOf(row, ctx)).any;
}

const LONG_PRESS_MS = 500;

/**
 * The gestures that open a row's menu: a right click, or a finger held for half a second (the click that follows a long press is swallowed so the
 * row does not open under the menu).
 */
export function useRowMenuGestures(onOpen: () => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallow = useRef(false);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  if (!enabled) return {};
  return {
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      onOpen();
    },
    onTouchStart: () => {
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        swallow.current = true;
        onOpen();
      }, LONG_PRESS_MS);
    },
    onTouchMove: clear,
    onTouchEnd: () => {
      clear();
      // the click of a long press comes right after the finger lifts; if none comes (the browser sent a context menu instead) the next real click must not be swallowed
      if (swallow.current) setTimeout(() => (swallow.current = false), 400);
    },
    onTouchCancel: clear,
    onClickCapture: (event: React.MouseEvent) => {
      if (!swallow.current) return;
      swallow.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** After a pin, an archive or a delete the list and the forum views are asked for again (the live line also sends it; this makes it immediate). */
export function useRefreshChatRows() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: chatKeys.list() });
    void qc.invalidateQueries({ queryKey: chatKeys.spaces() });
  }, [qc]);
}

export function RowActionsMenu({
  row,
  ctx,
  open,
  onOpenChange,
  openConversationId,
  className,
}: {
  row: ChatRowDto;
  ctx: RowMenuContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the conversation that is open on the screen: if it was deleted for good, the pane goes back to the list */
  openConversationId: string | null;
  className?: string;
}) {
  const router = useRouter();
  const refresh = useRefreshChatRows();
  const [confirming, setConfirming] = useState(false);
  const { busy, call } = useRowCall((action: RowAction) => {
    refresh();
    if ((action === "purge" || action === "delete") && openConversationId === row.id) router.push(chatHref.list);
  });
  const target = rowMenuTargetOf(row, ctx);
  if (!rowHasMenu(row, ctx)) return null;
  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={ct("chath.menu.open", { title: row.title })}
            disabled={busy}
            className={cn(
              "pointer-events-none absolute end-1 top-1/2 z-10 grid size-9 shrink-0 -translate-y-1/2 place-items-center rounded-full text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent data-[state=open]:opacity-100 motion-reduce:transition-none md:pointer-events-auto md:static md:translate-y-0 md:group-hover:opacity-100",
              className,
            )}
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <RowMenuItems id={row.id} pinned={row.pinned === true} call={call} onPurge={() => setConfirming(true)} {...target} />
        </DropdownMenuContent>
      </DropdownMenu>
      <PurgeConfirm open={confirming} id={row.id} title={row.title} busy={busy} call={call} onClose={() => setConfirming(false)} />
    </>
  );
}
