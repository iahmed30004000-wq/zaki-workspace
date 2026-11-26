"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, LogOut, MessageCircle, Search, Share2, type LucideIcon } from "lucide-react";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import { CallButton } from "@/components/calls/call-button";
import { usePersonalCall, type PersonalChange } from "@/components/chat/v2/row-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useOptionalToast } from "@/components/ui/toast";
import { chatKeys } from "@/lib/chat/cache/keys";
import { scheduleSync } from "@/lib/chat/cache/runtime";
import { errorKeyOf } from "@/lib/chat/poll-client";
import { MUTE_PRESETS, mutedUntilOf } from "@/lib/chat/row-preview";
import { ct } from "@/lib/chat/text";
import { canLeaveOf, infoActionsOf, muteOffersOf, shareAddressOf, type InfoActionId, type InfoModel } from "@/lib/chat/v2/info/info-model";
import { useListPersonal } from "@/lib/chat/v2/info/use-info-data";
import type { PaneMembers } from "@/lib/chat/v2/pane/composer-detail";
import { chatHref } from "@/lib/chat/v2/routes";

/**
 * The cards under the big picture of the phone's info page («تيليجرام على التلفون»): «مراسلة», «كتم», «بحث», «اتصال», «مشاركة», «مغادرة» — each only where the
 * thing really works (`infoActionsOf`). They use the doors that already exist: the person's own mute, the call button, the phone's share sheet (or the
 * clipboard) and the leave door, which asks first. The server decides every one again.
 */
const CARD = "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-2xl bg-surface-1 px-1 text-xs font-semibold text-accent shadow-card disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
/** The app's own call button, dressed as one of the cards (its menu and its rules are its own); a call already going keeps its green «انضم». */
const CALL_AS_CARD =
  "[&>button:not([data-call-join])]:flex [&>button:not([data-call-join])]:min-h-16 [&>button:not([data-call-join])]:w-full [&>button:not([data-call-join])]:flex-col [&>button:not([data-call-join])]:gap-1 [&>button:not([data-call-join])]:rounded-2xl [&>button:not([data-call-join])]:border-0 [&>button:not([data-call-join])]:bg-surface-1 [&>button:not([data-call-join])]:px-1 [&>button:not([data-call-join])]:text-xs [&>button:not([data-call-join])]:font-semibold [&>button:not([data-call-join])]:text-accent [&>button:not([data-call-join])]:shadow-card [&>button>span]:inline [&>button[data-call-join]]:min-h-16 [&>button[data-call-join]]:w-full";

const LOOK: Record<Exclude<InfoActionId, "call">, { icon: LucideIcon; label: string }> = {
  message: { icon: MessageCircle, label: "tgsheets.info.message" },
  mute: { icon: Bell, label: "tgsheets.info.mute" },
  unmute: { icon: BellOff, label: "chatps.unmute" },
  search: { icon: Search, label: "tgsheets.info.search" },
  share: { icon: Share2, label: "tgsheets.info.share" },
  leave: { icon: LogOut, label: "tgsheets.info.leave" },
};

/** One card. It passes its ref on, so a menu can open from it. */
const Card = React.forwardRef<HTMLButtonElement, { id: Exclude<InfoActionId, "call"> } & React.ButtonHTMLAttributes<HTMLButtonElement>>(function Card({ id, ...rest }, ref) {
  const { icon: Icon, label } = LOOK[id];
  return (
    <button type="button" ref={ref} data-info-action={id} className={CARD} {...rest}>
      <Icon aria-hidden="true" className="size-6" />
      <span className="max-w-full truncate">{ct(label)}</span>
    </button>
  );
});

export function InfoActions({ header, people, model, saved, onMessage, onSearch }: { header: ConversationHeaderDto; people: PaneMembers | null; model: InfoModel; saved: boolean; onMessage: () => void; onSearch: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useOptionalToast();
  const personal = useListPersonal();
  const { busy, call } = usePersonalCall({ id: header.id, unread: 0 });
  const [note, setNote] = React.useState("");
  const [leaving, setLeaving] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const mute = muteOffersOf({ muted: header.me.muted === true, personal, saved, oversight: header.me.oversight === true });
  const ids = infoActionsOf({
    mute: mute?.state ?? null,
    canCall: model.buttons.includes("call") && !saved,
    canShare: shareAddressOf(header, "", saved) !== null,
    canLeave: canLeaveOf(header, people),
  });

  const muteBy = (change: PersonalChange) =>
    void call(change).then((ok) => {
      if (ok) void qc.invalidateQueries({ queryKey: chatKeys.header(header.id), exact: true });
    });

  async function share() {
    const url = shareAddressOf(header, window.location.origin, saved);
    if (!url) return;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: header.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote(ct("tgsheets.info.link_copied"));
    } catch (error) {
      // the person closed the share sheet: not a failure
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNote(ct("chatui.info.share_failed"));
    }
  }

  async function leave() {
    if (sending) return;
    setSending(true);
    const res = await fetch(`/api/chat/conversations/${encodeURIComponent(header.id)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      scheduleSync(qc);
      router.replace(chatHref.list);
      return;
    }
    setSending(false);
    setLeaving(false);
    toast?.toast(ct(errorKeyOf(await res?.json().catch(() => null)) ?? "chatc.menu.failed"), "error");
  }

  return (
    <>
      <ul data-info-actions="" className="flex gap-2 px-3">
        {ids.map((id) => (
          <li key={id} className={id === "call" ? `min-w-0 flex-1 ${CALL_AS_CARD}` : "min-w-0 flex-1"}>
            {id === "call" ? (
              <CallButton conversationId={header.id} isDm={header.kind === "DM"} canStart outlined />
            ) : id === "mute" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Card id="mute" disabled={busy} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="min-w-48">
                  {MUTE_PRESETS.map((preset) => (
                    <DropdownMenuItem key={preset.key} data-info-mute-preset={preset.key} onSelect={() => muteBy({ mutedUntil: mutedUntilOf(preset) })}>
                      {ct(preset.labelKey)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Card
                id={id}
                disabled={id === "unmute" && busy}
                onClick={id === "message" ? onMessage : id === "search" ? onSearch : id === "share" ? () => void share() : id === "unmute" ? () => muteBy({ mutedUntil: null }) : () => setLeaving(true)}
              />
            )}
          </li>
        ))}
      </ul>
      {note ? (
        <p role="status" className="px-4 pt-2 text-center text-xs text-fg-muted">
          {note}
        </p>
      ) : null}
      {leaving ? (
        <Dialog open onOpenChange={(open) => !open && setLeaving(false)}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>{ct("tgsheets.info.leave_title", { title: header.title })}</DialogTitle>
              <DialogDescription>{ct("tgsheets.info.leave_text")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setLeaving(false)}>
                {ct("tgsheets.info.cancel")}
              </Button>
              <Button type="button" variant="danger" data-info-leave-confirm="" disabled={sending} onClick={() => void leave()}>
                {ct("tgsheets.info.leave")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
