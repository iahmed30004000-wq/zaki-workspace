"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useOptionalToast } from "@/components/ui/toast";
import { PurgeConfirm, RowMenuItems, rowMenuOffers, useRowCall, type RowAction } from "@/components/chat/home/row-menu";
import { chatKeys } from "@/lib/chat/cache/keys";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { markConversationRead } from "@/lib/chat/cache/writer";
import { MUTE_PRESETS, mutedUntilOf, personalOffers } from "@/lib/chat/row-preview";
import { announceChatRead } from "@/lib/chat/use-chat-unread";
import { CHAT_ORDERS_KEY } from "@/lib/chat/v2/use-orders";
import { chatHref } from "@/lib/chat/v2/routes";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

/**
 * C2.2 — the menu of a row of the new list: right-click on the computer, a long press on the phone, and a «⋮» that shows when the pointer rests on the
 * row. It offers EXACTLY what today's «⋯» offers (`src/components/chat/home/row-menu.tsx`: pin for everybody, archive the topic, delete an empty one, and
 * the owner's «حذف نهائي» with its confirmation, unchanged), because it is built from the same pieces. What a person may not do is not offered, and the
 * server decides again.
 *
 * C3a.1 adds the person's OWN items, above those: pin to the top of THEIR list, archive, «علّم كغير مقروء», and the mute presets (an hour, 8 hours, a day, a week,
 * for good). They are «لإلي بس», have their own switch (`chatPersonalState`, read from the cached list: off, none of them is drawn), and need no rank. The
 * managers' items stay behind «قائمة المحادثة» (`chatRowMenu`): the layout hands `enabled` down.
 */

export interface RowMenuContext {
  /** the company's switch `chatRowMenu` */
  enabled: boolean;
  /** the owner rank's «حذف نهائي» (D-A4: the rank, not the oversight capability: it is not a reading decision) */
  canPurge: boolean;
  /** the viewer manages the space of this topic (the forum view knows it from its header; the list of one space from the space's own view) */
  canModerate: boolean;
  /** the company's switch `chatPersonalState` (C3a.1): the personal items. Absent reads as on; a connected row fills it in from the cached list. */
  personal?: boolean;
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

/** Does the row have the managers' part (today's menu, behind `chatRowMenu`)? */
function hasManagerItems(row: ChatRowDto, ctx: RowMenuContext): boolean {
  return ctx.enabled && row.kind !== "SPACE" && rowMenuOffers(rowMenuTargetOf(row, ctx)).any;
}

/** Does the row have the person's own part (C3a.1, behind `chatPersonalState`)? */
function hasPersonalItems(row: ChatRowDto, ctx: RowMenuContext): boolean {
  return ctx.personal !== false && personalOffers(row) !== null;
}

export function rowHasMenu(row: ChatRowDto, ctx: RowMenuContext): boolean {
  return hasPersonalItems(row, ctx) || hasManagerItems(row, ctx);
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

/** What one personal item changes: `PUT /api/chat/conversations/[id]/me`. */
export interface PersonalChange {
  pinned?: boolean;
  archived?: boolean;
  markedUnread?: boolean;
  mutedUntil?: string | null;
}
export type PersonalCall = (change: PersonalChange | "read") => Promise<boolean>;

/**
 * The one place a personal item talks to the server. A change is the person's own `PUT …/me`; «علّم كمقروء» on a chat with unread messages is the read mark
 * the screen already sends. After it the list, the forum views and the person's pin order are asked for again (the other tabs get the row through the sync
 * feed). The tenth pin's refusal is said in words; any other failure says so and changes nothing. Never throws.
 */
export function usePersonalCall(row: Pick<ChatRowDto, "id" | "unread">): { busy: boolean; call: PersonalCall } {
  const qc = useQueryClient();
  const toast = useOptionalToast();
  const [busy, setBusy] = useState(false);
  const say = (key: string, tone: "success" | "error" = "success") => toast?.toast(ct(key), tone);
  const call = useCallback<PersonalCall>(
    async (change) => {
      setBusy(true);
      try {
        const base = `/api/chat/conversations/${encodeURIComponent(row.id)}`;
        const reads = change === "read" && row.unread > 0;
        const res = await fetch(reads ? `${base}/read` : `${base}/me`, {
          method: reads ? "POST" : "PUT",
          ...(reads ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(change === "read" ? { markedUnread: false } : change) }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { details?: { message?: string }[] };
          const said = data.details?.[0]?.message;
          say(said === "chatps.pins_full" ? said : "chatps.failed", "error");
          return false;
        }
        if (reads) {
          markConversationRead(qc, row.id);
          announceChatRead();
        }
        // a mute whose time had already passed on the server (this device's clock is behind) was not kept: said, not shown as done
        const asked = change !== "read" && typeof change.mutedUntil === "string";
        const kept = !asked || ((await res.json().catch(() => ({}))) as { mutedUntil?: string | null }).mutedUntil;
        say(kept ? "chath.menu.done" : "chatps.failed", kept ? "success" : "error");
        void qc.invalidateQueries({ queryKey: chatKeys.list() });
        void qc.invalidateQueries({ queryKey: chatKeys.spaces() });
        void qc.invalidateQueries({ queryKey: CHAT_ORDERS_KEY });
        return true;
      } catch {
        say("chatps.failed", "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    // the toast is a stable provider value; `say` only reads it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, row.id, row.unread, toast],
  );
  return { busy, call };
}

/**
 * The person's own items of a row's menu, from `personalOffers` (inside any `DropdownMenuContent`): pin or unpin, archive or take out of the archive, mark
 * unread or read, then the mute presets (or «رفع الكتم» while muted). A space row has none.
 */
export function PersonalMenuItems({ row, call }: { row: ChatRowDto; call: PersonalCall }) {
  const offers = personalOffers(row);
  if (!offers) return null;
  return (
    <>
      <DropdownMenuItem onSelect={() => void call({ pinned: offers.pin === "pin" })}>
        <span aria-hidden="true">📌</span> {ct(offers.pin === "pin" ? "chatps.pin" : "chatps.unpin")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void call({ archived: offers.archive === "archive" })}>
        <span aria-hidden="true">🗄️</span> {ct(offers.archive === "archive" ? "chatps.archive" : "chatps.unarchive")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void (offers.read === "read" ? call("read") : call({ markedUnread: true }))}>
        <span aria-hidden="true">{offers.read === "read" ? "✅" : "🔵"}</span> {ct(offers.read === "read" ? "chatps.mark_read" : "chatps.mark_unread")}
      </DropdownMenuItem>
      {offers.mute === "lift" ? (
        <DropdownMenuItem onSelect={() => void call({ mutedUntil: null })}>
          <span aria-hidden="true">🔔</span> {ct("chatps.unmute")}
        </DropdownMenuItem>
      ) : (
        <>
          <DropdownMenuLabel>{ct("chatps.mute_label")}</DropdownMenuLabel>
          {MUTE_PRESETS.map((preset) => (
            <DropdownMenuItem key={preset.key} onSelect={() => void call({ mutedUntil: mutedUntilOf(preset) })}>
              <span aria-hidden="true">🔕</span> {ct(preset.labelKey)}
            </DropdownMenuItem>
          ))}
        </>
      )}
    </>
  );
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
  const { busy: managing, call } = useRowCall((action: RowAction) => {
    refresh();
    if ((action === "purge" || action === "delete") && openConversationId === row.id) router.push(chatHref.list);
  });
  const mine = usePersonalCall(row);
  const busy = managing || mine.busy;
  const target = rowMenuTargetOf(row, ctx);
  if (!rowHasMenu(row, ctx)) return null;
  const personal = hasPersonalItems(row, ctx);
  const managers = hasManagerItems(row, ctx);
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
          {personal ? <PersonalMenuItems row={row} call={mine.call} /> : null}
          {personal && managers ? <DropdownMenuSeparator /> : null}
          {managers ? <RowMenuItems id={row.id} pinned={row.pinned === true} call={call} onPurge={() => setConfirming(true)} {...target} /> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {managers ? <PurgeConfirm open={confirming} id={row.id} title={row.title} busy={busy} call={call} onClose={() => setConfirming(false)} /> : null}
    </>
  );
}
