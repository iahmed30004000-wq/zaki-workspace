"use client";

import React from "react";
import { List, Pin, X } from "lucide-react";
import { QueryClientContext, useQueryClient } from "@tanstack/react-query";
import "@/components/chat/v2/phone/tg-messages.css";
import { TgConfirm } from "@/components/chat/v2/menu/tg-confirm";
import { useTgPhone } from "@/components/shell/tg-phone";
import { useOptionalToast } from "@/components/ui/toast";
import { scheduleSync } from "@/lib/chat/cache/runtime";
import { callDoor, doors } from "@/lib/chat/v2/pane/message-actions";
import { TG_MOTION, tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { apiDelete } from "@/lib/api-client";
import { chatKeys } from "@/lib/chat/cache/keys";
import { ct } from "@/lib/chat/text";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Pins = { id: string; authorName: string; preview: string | null }[];

/**
 * The bar of pinned messages under the header: each tap goes to the next pinned message (newest first) and cycles, like a messaging app. The jump is the history hook's
 * (`around` the message, a 2 s highlight); nothing is drawn when nothing is pinned.
 *
 * «شكل تيليجرام» (`tg`, the switch `tgLook`): the bar reads «رسالة مثبّتة #N» (the number of the pin counted from the oldest, as Telegram's) and a small button opens the list
 * «كل المثبّتات (n)», where a tap jumps to a message and «إلغاء تثبيت الكل» (only for whoever may pin: the server decides again) unpins them all in one step.
 */
export function PinnedBar({
  pins,
  onJump,
  tg = false,
  conversationId,
  canUnpinAll = false,
}: {
  pins: Pins;
  onJump: (messageId: string) => void;
  tg?: boolean;
  conversationId?: string;
  canUnpinAll?: boolean;
}) {
  const [index, setIndex] = React.useState(0);
  const [listOpen, setListOpen] = React.useState(false);
  // «تيليجرام على التلفون»: the bar slides down when a first pin appears and up when the last one goes, and it has its own ✕
  const phone = useTgPhone();
  const lastPins = React.useRef(pins);
  const appeared = React.useRef(false);
  if (pins.length) lastPins.current = pins;
  else appeared.current = true;
  const [gone, setGone] = React.useState(pins.length === 0);
  React.useEffect(() => {
    if (pins.length) return setGone(false);
    const leave = setTimeout(() => setGone(true), TG_MOTION.barSlideMs);
    return () => clearTimeout(leave);
  }, [pins.length]);
  const unpin = useUnpin(conversationId);
  const leaving = phone && !pins.length && !gone;
  const shown = leaving ? lastPins.current : pins;
  if (!shown.length) return unpin.dialog;
  const i = index % shown.length;
  const pin = shown[i]!;
  // pins come newest first: the number a person sees counts from the oldest
  const number = shown.length - i;
  const label = tg ? ct("chatc.pinbar.numbered", { n: number }) : ct("chatc.pinbar.label");
  const body = (
    <>
      <Pin aria-hidden="true" className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-accent">
          {label}
          {!tg && shown.length > 1 ? ` · ${ct("chatc.pinbar.count", { i: i + 1, n: shown.length })}` : ""}
        </span>
        <span className="block truncate text-sm">
          {pin.authorName}: {pin.preview ?? ct("chatc.pinbar.empty_preview")}
        </span>
      </span>
    </>
  );
  const cycle = () => {
    onJump(pin.id);
    setIndex(i + 1);
  };
  if (!tg && !phone) {
    return (
      <button type="button" data-pinned-bar aria-label={ct("chatc.pinbar.label")} onClick={cycle} className="flex min-h-11 w-full items-center gap-2 border-b border-border bg-surface-1 px-3 py-1 text-start hover:bg-surface-2">
        {body}
      </button>
    );
  }
  const slide = phone ? (leaving ? "zk-tg-pin-out pointer-events-none" : appeared.current ? "zk-tg-pin-in" : "") : "";
  return (
    <>
    <div data-pinned-bar {...(tg ? { "data-pinned-tg": true } : {})} {...(phone ? { style: tgMotionVars(["barSlideMs"]) as React.CSSProperties } : {})} className={`flex min-h-11 w-full items-center border-b border-border bg-surface-1 ${slide}`}>
      <button type="button" aria-label={label} onClick={cycle} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-1 text-start hover:bg-surface-2">
        {body}
      </button>
      {tg ? (
        <>
          <button
            type="button"
            data-pinned-list-open
            aria-label={ct("chatc.pinbar.all", { n: shown.length })}
            onClick={() => setListOpen(true)}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-fg-muted hover:bg-surface-2"
          >
            <List aria-hidden="true" className="size-5" />
          </button>
          <PinsList open={listOpen} pins={shown} conversationId={conversationId} canUnpinAll={canUnpinAll} onClose={() => setListOpen(false)} onJump={onJump} />
        </>
      ) : null}
      {phone && canUnpinAll && conversationId ? (
        <button type="button" data-pinned-unpin="" aria-label={ct("tgmsg.pin.close")} onClick={() => unpin.ask(pin.id)} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-fg-muted hover:bg-surface-2">
          <X aria-hidden="true" className="size-5" />
        </button>
      ) : null}
    </div>
    {unpin.dialog}
    </>
  );
}

/**
 * «تيليجرام على التلفون»: ✕ on the bar asks first, takes that ONE pin off (the door that pins is the door that unpins) and says so with «تراجع», which pins it
 * again. The dialog is drawn beside the bar, so it stays while the bar of the last pin slides away.
 */
function useUnpin(conversationId: string | undefined): { ask: (messageId: string) => void; dialog: React.ReactElement } {
  const qc = React.useContext(QueryClientContext);
  const toast = useOptionalToast();
  const [asked, setAsked] = React.useState<string | null>(null);
  const toggle = async (messageId: string): Promise<boolean> => {
    const result = await callDoor(doors.pin(messageId));
    if (!result.ok) {
      toast?.toast(ct(result.message ?? "chatc.menu.failed"), "error");
      return false;
    }
    if (qc && conversationId) {
      scheduleSync(qc);
      void qc.invalidateQueries({ queryKey: chatKeys.header(conversationId), exact: true });
    }
    return true;
  };
  const confirm = () => {
    const messageId = asked;
    setAsked(null);
    if (!messageId) return;
    void toggle(messageId).then((ok) => {
      if (ok) toast?.toast(ct("tgmsg.pin.unpinned"), "success", { label: ct("tgmsg.undo"), onClick: () => void toggle(messageId) });
    });
  };
  return {
    ask: setAsked,
    dialog: <TgConfirm open={asked !== null} onOpenChange={(next) => (next ? undefined : setAsked(null))} title={ct("tgmsg.pin.unpin_title")} body={ct("tgmsg.pin.unpin_body")} confirmLabel={ct("tgmsg.pin.unpin_confirm")} danger onConfirm={confirm} />,
  };
}

/** «كل المثبّتات (n)»: every pinned message, a tap goes to it; «إلغاء تثبيت الكل» for whoever may pin. */
export function PinsList({ open, pins, conversationId, canUnpinAll, onClose, onJump }: { open: boolean; pins: Pins; conversationId: string | undefined; canUnpinAll: boolean; onClose: () => void; onJump: (messageId: string) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const unpinAll = async () => {
    if (!conversationId || busy) return;
    if (typeof window !== "undefined" && !window.confirm(ct("chatc.pinbar.unpin_all_confirm", { n: pins.length }))) return;
    setBusy(true);
    setError("");
    try {
      await apiDelete(`/api/chat/conversations/${encodeURIComponent(conversationId)}/pins`);
      await qc.invalidateQueries({ queryKey: chatKeys.header(conversationId), exact: true });
      onClose();
    } catch {
      setError(ct("chatc.pinbar.unpin_all_failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("chatc.pinbar.all", { n: pins.length })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ul data-pins-list className="divide-y divide-border text-sm">
            {pins.map((p, at) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onJump(p.id);
                    onClose();
                  }}
                  className="flex min-h-12 w-full items-center gap-3 text-start hover:bg-surface-2"
                >
                  <span className="w-8 shrink-0 text-center text-xs tabular-nums text-accent" dir="ltr">
                    #{pins.length - at}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.authorName}</span>
                    <span className="block truncate text-fg-muted">{p.preview ?? ct("chatc.pinbar.empty_preview")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {canUnpinAll ? (
            <button type="button" data-pins-unpin-all onClick={() => void unpinAll()} disabled={busy} className="mt-3 min-h-11 w-full rounded-lg border border-border bg-surface-2 text-sm font-semibold text-danger disabled:opacity-60">
              {ct("chatc.pinbar.unpin_all")}
            </button>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
