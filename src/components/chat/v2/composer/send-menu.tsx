"use client";

import React from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ct } from "@/lib/chat/text";
import { SEND_HOLD_MS, sendHoldOpensMenu, type Point } from "@/lib/chat/v2/composer/hold-gesture";

/**
 * C3c.2 — the menu of the SEND button: right-click on the computer, a long press on a phone. Today it has one item, «ابعت بدون صوت»; C3c.3 adds «جدول الإرسال»
 * by adding its id to `SEND_MENU_ITEMS`, a line to `sendMenuItemsOf` (when it is offered) and a label to `labelOf` — nothing else in this file changes.
 *
 * The button itself is NOT a menu trigger: a plain click and Enter still send. The menu is opened by the gesture (a controlled `open`) and is anchored on an
 * invisible span laid over the button.
 */
export type SendMenuItemId = "silent";

/** Every item the menu can have, in the order it shows them. */
export const SEND_MENU_ITEMS: readonly SendMenuItemId[] = ["silent"];

/** Which items the menu offers now: none while an edit is saved or there is nothing to send; «ابعت بدون صوت» only with the company's switch on. Pure. */
export function sendMenuItemsOf(s: { silentSend: boolean; editing: boolean; canSubmit: boolean }): SendMenuItemId[] {
  if (s.editing || !s.canSubmit) return [];
  return SEND_MENU_ITEMS.filter((id) => (id === "silent" ? s.silentSend : true));
}

const labelOf = (id: SendMenuItemId): string => (id === "silent" ? ct("chatsilent.menu.silent") : id);

export interface SendMenuProps {
  items: readonly SendMenuItemId[];
  onPick: (id: SendMenuItemId) => void;
  /** the send button */
  children?: React.ReactNode;
  /** server-render tests: draw it open, in place */
  defaultOpen?: boolean;
  portal?: boolean;
}

export function SendMenu({ items, onPick, children, defaultOpen = false, portal = true }: SendMenuProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const press = React.useRef<{ timer: ReturnType<typeof setTimeout>; start: Point; last: Point } | null>(null);
  // the lift that ends a long press is a click on the button: it must not also send
  const swallow = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const endPress = React.useCallback(() => {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  }, []);
  React.useEffect(
    () => () => {
      endPress();
      if (swallow.current) clearTimeout(swallow.current);
    },
    [endPress],
  );
  if (items.length === 0) return <>{children}</>;
  const openNow = (byFinger: boolean) => {
    endPress();
    // only a long press ends in a click on the button (a right-click does not); a second call for the same press (the phone's own «contextmenu» event) keeps what the first set
    if (byFinger) {
      if (swallow.current) clearTimeout(swallow.current);
      swallow.current = setTimeout(() => (swallow.current = null), 1000);
    }
    setOpen(true);
  };
  return (
    <span
      data-send-menu
      className="relative inline-flex select-none [-webkit-touch-callout:none]"
      onContextMenu={(event) => {
        event.preventDefault();
        // a finger is still down: the phone raised its own «contextmenu» for the long press, so the lift is coming
        openNow(press.current !== null);
      }}
      onPointerDown={(event) => {
        // a mouse has the right button; a finger or a pen long-presses
        if (event.pointerType === "mouse") return;
        endPress();
        const start = { x: event.clientX, y: event.clientY };
        press.current = {
          start,
          last: start,
          timer: setTimeout(() => {
            const p = press.current;
            if (p && sendHoldOpensMenu(p.start, p.last, SEND_HOLD_MS)) openNow(true);
            else endPress();
          }, SEND_HOLD_MS),
        };
      }}
      onPointerMove={(event) => {
        if (press.current) press.current.last = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onClickCapture={(event) => {
        if (!swallow.current) return;
        clearTimeout(swallow.current);
        swallow.current = null;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent portal={portal} align="end" aria-label={ct("chatsilent.menu.label")} onCloseAutoFocus={(event) => event.preventDefault()}>
          {items.map((id) => (
            <DropdownMenuItem key={id} data-send-item={id} onSelect={() => onPick(id)}>
              {labelOf(id)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
