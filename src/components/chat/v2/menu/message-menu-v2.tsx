"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { QueryClientContext } from "@tanstack/react-query";
import { Ellipsis, EyeOff, Reply, SmilePlus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { menuFor, menuOpen, type MessageMenuContext, type MessageMenuId } from "@/components/chat/message/message-menu-registry";
import { EmojiPickerDialog } from "@/components/chat/v2/menu/emoji-picker";
import { menuIconOf } from "@/components/chat/v2/menu/menu-icons";
import { MessageOverlay } from "@/components/chat/v2/menu/message-overlay";
import { ReactionBar } from "@/components/chat/v2/menu/reaction-bar";
import { TgConfirm } from "@/components/chat/v2/menu/tg-confirm";
import { useTgPhone } from "@/components/shell/tg-phone";
import { useOptionalToast } from "@/components/ui/toast";
import { chatKeys } from "@/lib/chat/cache/keys";
import { keepInSaved, savedFlagsOf, type ListWithSaved } from "@/lib/chat/v2/menu/menu-context";
import type { Rect } from "@/lib/chat/v2/menu/phone-menu";
import type { TapPoint } from "@/lib/chat/v2/menu/quick-reactions";
import { selectionStore, useSelectionEnabled } from "@/lib/chat/selection";
import { useParityActions } from "@/lib/chat/v2/phone/parity-actions";
import { announceRemoval } from "@/lib/chat/v2/phone/removals";
import { ct, ctCount } from "@/lib/chat/text";

/** «تيليجرام على التلفون»: what the tap menu asks of the bubble it opens from, and of the pane. Only the phone's overlay reads it. */
export interface PhoneMenuProps {
  /** where the bubble is on the screen now */
  anchorRect: () => Rect | null;
  /** the tap that opened the menu (null: a long press or a key) */
  openedBy: () => TapPoint | null;
  /** a second tap came right after: the person's quick reaction */
  doubleTap: () => void;
  /** a reaction is on its way: the bubble draws its pill at once and the emoji flies there; the answer takes it back (the server refused) */
  expectReaction: (emoji: string, from: Rect | null) => () => void;
  /** the reactions on the message that are mine */
  chosen: ReadonlySet<string>;
  /** the pane's own commands, with what they answered */
  sendReaction: (emoji: string) => Promise<boolean>;
  togglePin: () => Promise<boolean>;
}

export interface MessageMenuV2Props {
  /** «تيليجرام على التلفون» (absent: the phone's sheet of before) */
  phone?: PhoneMenuProps;
  context: MessageMenuContext;
  /** the six quick reactions (today's six until C4's setting exists) */
  quick: readonly string[];
  /** a pick of the registry's list (a delete is confirmed here first) */
  onAction: (id: MessageMenuId) => void;
  /** a reaction, from the quick bar or the full picker: toggled through the react door */
  onReact: (emoji: string) => void;
  /** the phone: a long press on the bubble opens the sheet (controlled from the bubble) */
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  /** the computer: a right click on the bubble opens the menu (controlled from the bubble); «⋯» opens it too */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** draw the panels in place instead of on <body> (server-render tests; the same switch the UI kit has) */
  portal?: boolean;
}

/** a row of the menu, Telegram's: a rounded 8 px row (36 px with a mouse, 44 px for a thumb), the outline icon first, the highlight a quiet grey (no accent stripe) */
const ROW = "gap-3 border-s-0 ps-3";
const ROW_HOVER = "data-[highlighted]:bg-surface-2";

const small =
  "flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-1 text-fg-muted opacity-0 shadow-card transition-opacity hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none [@media(hover:none)]:hidden";

/**
 * C2.6 — the menu of ONE message on the new screen, drawn from the registry (`menuFor` with `surface: "v2"`: Telegram's order and words) and never from a
 * list of its own.
 *
 *  - computer: hovering a bubble shows two small buttons beside it — a reaction button (the quick bar) and «↩» (reply, only where the registry offers it) —
 *    and «⋯», which opens the whole menu; a right click on the bubble opens the same menu. The quick bar is on top of the menu.
 *  - phone: a long press opens the same list as a bottom sheet (the bubble owns the press, `LONG_PRESS_MS`).
 *  - «⌄» of the quick bar opens the full picker; a delete asks first.
 *
 * Nothing is drawn for a deleted message, a system line, or while the owner reads in silent oversight (`menuOpen`): a reaction or a pin is refused to him.
 */
export function MessageMenuV2({ context, quick, onAction, onReact, sheetOpen, onSheetOpenChange, menuOpen: open, onMenuOpenChange, portal = true, phone }: MessageMenuV2Props) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  // «تيليجرام على التلفون»: a tap's overlay in place of the sheet, a pin asks first, and the confirmations are Telegram's
  const tgPhone = useTgPhone();
  const tg = tgPhone && phone !== undefined;
  // what the pin dialog asks is kept while it closes: it must not change its words as it fades
  const [pinAsk, setPinAsk] = React.useState<"pin" | "unpin">("pin");
  const [pinOpen, setPinOpen] = React.useState(false);
  const [reactOpen, setReactOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // S5.7 (a): «حذف عندي» is this package's own item BESIDE the registry's list (the registry is the old screens' too): it hides the message for the person only and asks first
  const parity = useParityActions();
  const [confirmHide, setConfirmHide] = React.useState(false);
  // C3a.3: «حوّل للمحفوظة» runs HERE (the item is the registry's; the doors are today's dm and forward doors). Whether it is on offer comes from the cached list, read only
  // while a menu is open and only when a query client is above (a render on its own has none: no item); the server decides again
  const queries = React.useContext(QueryClientContext);
  const toast = useOptionalToast();
  const pathname = usePathname();
  // C3b.5: «حدّد» is the registry's item too; it is offered while the open conversation's viewport says the screen can select (the company's switch `chatMultiSelect`)
  const canSelect = useSelectionEnabled();
  const asked = open || sheetOpen;
  const offered = React.useMemo(() => {
    if (!asked) return context;
    let next = context;
    if (queries) {
      const flags = savedFlagsOf(queries.getQueryData<ListWithSaved>(chatKeys.list()), context.viewerId, pathname);
      if (flags.canSaved) next = { ...next, canSaved: true, inSaved: flags.inSaved };
    }
    return canSelect ? { ...next, canSelect: true } : next;
  }, [asked, queries, context, pathname, canSelect]);
  if (!menuOpen(context)) return null;
  const actions = menuFor(asked ? offered : context);
  const canReply = actions.some((a) => a.id === "reply");

  const pick = (id: MessageMenuId) => {
    onMenuOpenChange(false);
    onSheetOpenChange(false);
    if (id === "delete") setConfirmDelete(true);
    else if (id === "pin" && tg) {
      setPinAsk(context.pinned ? "unpin" : "pin");
      setPinOpen(true);
    }
    else if (id === "select") {
      // no door and no dialog: the selection starts with this message (the viewport draws the checks, the header the bar)
      if (context.messageId) selectionStore.begin(context.messageId);
    } else if (id === "saved") {
      const messageId = context.messageId;
      if (!messageId) return;
      void keepInSaved(messageId).then((ok) => {
        toast?.toast(ct(ok ? "chatsaved.done" : "chatsaved.failed"), ok ? "success" : "error");
      });
    } else onAction(id);
  };
  const react = (emoji: string) => {
    setReactOpen(false);
    onMenuOpenChange(false);
    onSheetOpenChange(false);
    onReact(emoji);
  };
  /** a pick of the overlay: a reaction that is NEW is drawn and flown at once; taking mine back just asks the door */
  const overlayReact = (emoji: string, from: Rect | null) => {
    if (!phone) return;
    const undo = phone.chosen.has(emoji) ? null : phone.expectReaction(emoji, from);
    void phone.sendReaction(emoji).then((ok) => {
      if (!ok) undo?.();
    });
  };
  const togglePin = () => {
    const unpinning = pinAsk === "unpin";
    setPinOpen(false);
    if (!phone) return;
    void phone.togglePin().then((ok) => {
      if (!ok) return;
      if (!unpinning) toast?.toast(ct("tgmsg.pin.done"), "success");
      else toast?.toast(ct("tgmsg.pin.unpinned"), "success", { label: ct("tgmsg.undo"), onClick: () => void phone.togglePin() });
    });
  };
  const hideForMe = () => {
    setConfirmHide(false);
    if (!parity || !context.messageId) return;
    // the message leaves the list for me only: say so, so the log can turn it to dust (a dropped page looks the same)
    announceRemoval([context.messageId]);
    void parity.hide([context.messageId]);
  };
  const more = () => {
    setReactOpen(false);
    onMenuOpenChange(false);
    onSheetOpenChange(false);
    setPickerOpen(true);
  };

  return (
    <>
      <div data-message-hover className="flex shrink-0 items-center gap-1 self-center">
        {canReply ? (
          <button type="button" data-hover-reply aria-label={ct("chatc.menu.reply")} onClick={() => onAction("reply")} className={small}>
            <Reply aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          </button>
        ) : null}
        <DropdownMenu open={reactOpen} onOpenChange={setReactOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" data-hover-react aria-label={ct("chatc.menu.react")} className={small}>
              <SmilePlus aria-hidden="true" className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent portal={portal} align="start">
            <ReactionBar emojis={quick} onPick={react} onMore={more} />
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu open={open} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button type="button" data-message-menu-trigger aria-label={ct("chatc.menu.open")} className={small}>
              <Ellipsis aria-hidden="true" className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent portal={portal} align="start" className="min-w-56">
            <ReactionBar emojis={quick} onPick={react} onMore={more} />
            {actions.length > 0 && <DropdownMenuSeparator />}
            {actions.map((a) => {
              const Icon = menuIconOf(a.id, context.pinned);
              return (
                <DropdownMenuItem key={a.id} data-menu-item={a.id} tone={a.danger ? "danger" : undefined} className={a.danger ? ROW : `${ROW} ${ROW_HOVER}`} onSelect={() => pick(a.id)}>
                  <Icon aria-hidden="true" className={`size-5 shrink-0 ${a.danger ? "" : "text-fg-muted"} ${a.id === "reply" || a.id === "forward" ? "rtl:-scale-x-100" : ""}`} />
                  {ct(a.labelKey(context))}
                </DropdownMenuItem>
              );
            })}
            {parity && context.messageId ? (
              <DropdownMenuItem data-menu-item="hide-for-me" tone="danger" className={ROW} onSelect={() => setConfirmHide(true)}>
                <EyeOff aria-hidden="true" className="size-5 shrink-0" />
                {ct("chatparity.hide.menu")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {tg ? (
        <MessageOverlay
          portal={portal}
          open={sheetOpen}
          onClose={() => onSheetOpenChange(false)}
          context={context}
          actions={actions}
          quick={quick}
          chosen={phone.chosen}
          anchor={phone.anchorRect}
          openedBy={phone.openedBy}
          onDoubleTap={phone.doubleTap}
          onPick={pick}
          onReact={overlayReact}
          {...(parity && context.messageId
            ? {
                onHide: () => {
                  onSheetOpenChange(false);
                  setConfirmHide(true);
                },
              }
            : {})}
        />
      ) : (
      <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetContent portal={portal}>
          <SheetHeader>
            <SheetTitle>{ct("chatc.menu.title")}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <ReactionBar emojis={quick} onPick={react} onMore={more} />
            <ul className="mt-2 flex flex-col">
              {actions.map((a) => {
                const Icon = menuIconOf(a.id, context.pinned);
                return (
                  <li key={a.id}>
                    <button type="button" data-menu-item={a.id} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-base hover:bg-surface-2 ${a.danger ? "text-danger" : ""}`} onClick={() => pick(a.id)}>
                      <Icon aria-hidden="true" className={`size-5 shrink-0 ${a.danger ? "" : "text-fg-muted"} ${a.id === "reply" || a.id === "forward" ? "rtl:-scale-x-100" : ""}`} />
                      {ct(a.labelKey(context))}
                    </button>
                  </li>
                );
              })}
              {parity && context.messageId ? (
                <li>
                  <button
                    type="button"
                    data-menu-item="hide-for-me"
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-base text-danger hover:bg-surface-2"
                    onClick={() => {
                      onSheetOpenChange(false);
                      setConfirmHide(true);
                    }}
                  >
                    <EyeOff aria-hidden="true" className="size-5 shrink-0" />
                    {ct("chatparity.hide.menu")}
                  </button>
                </li>
              ) : null}
            </ul>
          </SheetBody>
        </SheetContent>
      </Sheet>
      )}

      <EmojiPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={onReact} portal={portal} />

      {tg ? (
        <>
          <TgConfirm
            portal={portal}
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={ctCount("tgmsg.del.title", 1)}
            body={ctCount("tgmsg.del.body", 1)}
            note={ct(context.mine ? "chatc.menu.delete_body_mine" : "chatc.menu.delete_body_other")}
            confirmLabel={ct("tgmsg.del.confirm")}
            danger
            onConfirm={() => {
              setConfirmDelete(false);
              onAction("delete");
            }}
          />
          <TgConfirm portal={portal} open={confirmHide} onOpenChange={setConfirmHide} title={ct("chatparity.hide.title")} body={ct("chatparity.hide.body")} confirmLabel={ct("chatparity.hide.confirm")} danger onConfirm={hideForMe} />
          <TgConfirm
            portal={portal}
            open={pinOpen}
            onOpenChange={setPinOpen}
            title={ct(pinAsk === "unpin" ? "tgmsg.pin.unpin_title" : "tgmsg.pin.title")}
            body={ct(pinAsk === "unpin" ? "tgmsg.pin.unpin_body" : "tgmsg.pin.body")}
            confirmLabel={ct(pinAsk === "unpin" ? "tgmsg.pin.unpin_confirm" : "tgmsg.pin.confirm")}
            danger={pinAsk === "unpin"}
            onConfirm={togglePin}
          />
        </>
      ) : (
        <>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent portal={portal} aria-label={ct("chatc.menu.delete_title")}>
          <DialogHeader>
            <DialogTitle>{ct("chatc.menu.delete_title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p>{ct(context.mine ? "chatc.menu.delete_body_mine" : "chatc.menu.delete_body_other")}</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmDelete(false)}>
              {ct("chatc.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setConfirmDelete(false);
                onAction("delete");
              }}
            >
              {ct("chatui.menu.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmHide} onOpenChange={setConfirmHide}>
        <DialogContent portal={portal} aria-label={ct("chatparity.hide.title")}>
          <DialogHeader>
            <DialogTitle>{ct("chatparity.hide.title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p>{ct("chatparity.hide.body")}</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmHide(false)}>
              {ct("chatc.cancel")}
            </Button>
            <Button type="button" variant="danger" onClick={hideForMe}>
              {ct("chatparity.hide.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      )}
    </>
  );
}
