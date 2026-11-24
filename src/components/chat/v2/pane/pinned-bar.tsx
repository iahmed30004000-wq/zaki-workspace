"use client";

import React from "react";
import { List, Pin } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
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
  if (!pins.length) return null;
  const i = index % pins.length;
  const pin = pins[i]!;
  // pins come newest first: the number a person sees counts from the oldest
  const number = pins.length - i;
  const label = tg ? ct("chatc.pinbar.numbered", { n: number }) : ct("chatc.pinbar.label");
  const body = (
    <>
      <Pin aria-hidden="true" className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-accent">
          {label}
          {!tg && pins.length > 1 ? ` · ${ct("chatc.pinbar.count", { i: i + 1, n: pins.length })}` : ""}
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
  if (!tg) {
    return (
      <button type="button" data-pinned-bar aria-label={ct("chatc.pinbar.label")} onClick={cycle} className="flex min-h-11 w-full items-center gap-2 border-b border-border bg-surface-1 px-3 py-1 text-start hover:bg-surface-2">
        {body}
      </button>
    );
  }
  return (
    <div data-pinned-bar data-pinned-tg className="flex min-h-11 w-full items-center border-b border-border bg-surface-1">
      <button type="button" aria-label={label} onClick={cycle} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-1 text-start hover:bg-surface-2">
        {body}
      </button>
      <button
        type="button"
        data-pinned-list-open
        aria-label={ct("chatc.pinbar.all", { n: pins.length })}
        onClick={() => setListOpen(true)}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-fg-muted hover:bg-surface-2"
      >
        <List aria-hidden="true" className="size-5" />
      </button>
      <PinsList open={listOpen} pins={pins} conversationId={conversationId} canUnpinAll={canUnpinAll} onClose={() => setListOpen(false)} onJump={onJump} />
    </div>
  );
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
