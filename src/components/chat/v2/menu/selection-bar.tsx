"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, EyeOff, Forward, ListChecks, Trash2, X } from "lucide-react";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import { useOptionalToast } from "@/components/ui/toast";
import { DeleteManyDialog, ForwardManyDialog, TaskFromSelectionDialog } from "@/components/chat/v2/menu/selection-dialogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import { useChatMessages } from "@/lib/chat/cache/selectors";
import { scheduleSync } from "@/lib/chat/cache/runtime";
import { tombstone } from "@/lib/chat/cache/writer";
import { copyTextOf, deletableOf, escapeLeavesSelection, forwardableOf, orderedSelection, selectionActionsOf, selectionStore, useSelection, type SelectionActions } from "@/lib/chat/selection";
import { ct, ctCount } from "@/lib/chat/text";
import { copyText } from "@/lib/chat/v2/menu/clipboard";
import { isSavedHeader } from "@/lib/chat/v2/menu/menu-context";
import { useParityActions } from "@/lib/chat/v2/phone/parity-actions";
import { doors, type Door } from "@/lib/chat/v2/pane/message-actions";
import { cn } from "@/lib/utils";

/**
 * C3b.5 — THE BAR of «حدّد»: the count of the picked messages, the four actions «حوّل · انسخ · احذف · اعمل مهمة» in that order, and a ✕ that leaves. It takes the place of the
 * pane header's content while messages are picked. An action that does not apply to what is picked is a disabled button (never missing, and never a second menu: the
 * message menu is the registry's, this is a toolbar). Pure drawing: `SelectionBarHost` below does the work.
 */
export function SelectionBar({
  count,
  can,
  busy = false,
  hideForward = false,
  onForward,
  onCopy,
  onDelete,
  onHide,
  onTask,
  onClose,
}: {
  count: number;
  can: SelectionActions;
  busy?: boolean;
  /** the saved chat has nobody to forward to from it: the button is not drawn there */
  hideForward?: boolean;
  onForward: () => void;
  onCopy: () => void;
  onDelete: () => void;
  /** S5.7 «حذف عندي»: hide the picked messages for me only. Absent: the button is not drawn (a bar with no pane around it). */
  onHide?: () => void;
  onTask: () => void;
  onClose: () => void;
}) {
  const action = (id: keyof SelectionActions, label: string, Icon: typeof Copy, run: () => void, danger = false) => (
    <button
      key={id}
      type="button"
      data-selection-action={id}
      disabled={busy || !can[id]}
      aria-label={label}
      onClick={run}
      className={cn("inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50 md:min-h-9", danger ? "text-danger" : "text-fg")}
    >
      <Icon aria-hidden="true" className={cn("size-5 shrink-0", id === "forward" && "rtl:-scale-x-100")} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div data-selection-bar role="toolbar" aria-label={ctCount("chatsel.bar.count", count)} className="flex min-w-0 flex-1 items-center gap-1">
      <button type="button" data-selection-close aria-label={ct("chatsel.bar.close")} onClick={onClose} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-surface-2">
        <X aria-hidden="true" className="size-5" />
      </button>
      <p data-selection-count role="status" className="min-w-0 flex-1 truncate font-semibold">
        {ctCount("chatsel.bar.count", count)}
      </p>
      {hideForward ? null : action("forward", ct("chatsel.bar.forward"), Forward, onForward)}
      {action("copy", ct("chatsel.bar.copy"), Copy, onCopy)}
      {action("delete", ct("chatsel.bar.delete"), Trash2, onDelete, true)}
      {onHide ? (
        <button
          type="button"
          data-selection-action="hide"
          disabled={busy || count === 0}
          aria-label={ct("chatparity.hide.bar")}
          onClick={onHide}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50 md:min-h-9"
        >
          <EyeOff aria-hidden="true" className="size-5 shrink-0" />
          <span className="hidden sm:inline">{ct("chatparity.hide.bar")}</span>
        </button>
      ) : null}
      {action("task", ct("chatsel.bar.task"), ListChecks, onTask)}
    </div>
  );
}

/** S5.7 «حذف عندي» for a selection: one question, one button — nothing is deleted for anybody else. */
function HideManyDialog({ open, count, busy, onClose, onConfirm }: { open: boolean; count: number; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent aria-label={ct("chatparity.hide.title")}>
        <DialogHeader>
          <DialogTitle>{ct("chatparity.hide.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p>{count > 1 ? ct("chatparity.hide.body_many", { n: count }) : ct("chatparity.hide.body")}</p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {ct("chatc.cancel")}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={busy}>
            {ct("chatparity.hide.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const overlayIsOpen = (): boolean => document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]') !== null;
const isEditable = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && typeof el.tagName === "string" && (el.isContentEditable === true || /^(?:INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/** One call to a batch door: its JSON answer, or null when the door refused as a whole (the person is told, nothing is assumed). */
async function post<T>(door: Door): Promise<T | null> {
  try {
    const res = await fetch(door.path, { method: door.method, headers: { "content-type": "application/json" }, body: JSON.stringify(door.body) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * The bar with what it acts on, for the open conversation: the picked messages come from the cache's loaded window (the same entry the viewport reads), in the
 * conversation's order. Esc leaves — taken BEFORE the shell's own Esc (which would leave the conversation) while nothing else wants it (a field, a dialog, a menu).
 * The doors decide every action again; the answers are reported per target / per message and said in one line.
 */
export function SelectionBarHost({ header }: { header: ConversationHeaderDto }) {
  const qc = useQueryClient();
  const toast = useOptionalToast();
  const commands = usePaneCommands();
  const selection = useSelection();
  const { messages } = useChatMessages(header.id);
  const parity = useParityActions();
  const [dialog, setDialog] = React.useState<"forward" | "delete" | "hide" | "task" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const picked = React.useMemo(() => orderedSelection(selection.ids, messages), [selection.ids, messages]);
  const makeTask = Boolean(header.me.canMakeWork) && header.me.canMakeTask !== false;
  const can = selectionActionsOf(picked, { canModerate: header.me.canModerate, canMakeTask: makeTask });
  const say = (text: string, kind: "success" | "error" = "success") => toast?.toast(text, kind);
  const privateSource = header.kind !== "TOPIC" || !!header.restricted || !!header.teamId;

  // what the bar counts and acts on is what the window still holds: if every picked message left it, the selection is over
  const loaded = messages.length > 0;
  React.useEffect(() => {
    if (loaded && selection.active && picked.length === 0) selectionStore.end();
  }, [loaded, selection.active, picked.length]);

  // Esc leaves the selection, in the capture phase so the shell's own Esc (back to the list) never sees it
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (!escapeLeavesSelection({ active: selectionStore.get().active, editable: isEditable(event.target), overlayOpen: overlayIsOpen() })) return;
      event.stopPropagation();
      event.preventDefault();
      selectionStore.end();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const copy = async () => {
    const ok = await copyText(copyTextOf(picked), typeof navigator === "undefined" ? undefined : navigator.clipboard);
    say(ct(ok ? "chatsel.copied" : "chatsel.copy_failed"), ok ? "success" : "error");
    if (ok) selectionStore.end();
  };

  const forward = async (targetIds: string[], withoutAuthor: boolean) => {
    const { forward: ready } = forwardableOf(picked);
    setBusy(true);
    const answer = await post<{ results: { targetId: string; ok: boolean }[] }>(doors.forwardMany(ready.map((m) => m.id), targetIds, withoutAuthor));
    setBusy(false);
    const ok = answer?.results.filter((r) => r.ok).length ?? 0;
    if (!answer || ok === 0) return say(ct("chatsel.fwd.failed"), "error");
    say(ok === answer.results.length ? ct("chatsel.fwd.done_all") : ct("chatsel.fwd.done_some", { ok, total: answer.results.length }), ok === answer.results.length ? "success" : "error");
    setDialog(null);
    selectionStore.end();
    scheduleSync(qc);
  };

  const remove = async () => {
    const ids = deletableOf(picked, header.me.canModerate).map((m) => m.id);
    setBusy(true);
    const answer = await post<{ results: { id: string; ok: boolean }[] }>(doors.removeMany(ids));
    setBusy(false);
    const done = answer?.results.filter((r) => r.ok) ?? [];
    if (!answer || done.length === 0) return say(ct("chatsel.del.failed"), "error");
    for (const r of done) tombstone(qc, header.id, r.id);
    say(done.length === answer.results.length ? ct("chatsel.del.done_all") : ct("chatsel.del.done_some", { ok: done.length, total: answer.results.length }), done.length === answer.results.length ? "success" : "error");
    setDialog(null);
    selectionStore.end();
    scheduleSync(qc);
  };

  return (
    <>
      <SelectionBar
        count={picked.length}
        can={can}
        busy={busy}
        hideForward={isSavedHeader(header)}
        onForward={() => setDialog("forward")}
        onCopy={() => void copy()}
        onDelete={() => setDialog("delete")}
        {...(parity ? { onHide: () => setDialog("hide") } : {})}
        onTask={() => setDialog("task")}
        onClose={selectionStore.end}
      />
      <ForwardManyDialog open={dialog === "forward"} from={header.id} count={forwardableOf(picked).forward.length} skipped={forwardableOf(picked).skipped} busy={busy} onClose={() => setDialog(null)} onSend={(ids, hide) => void forward(ids, hide)} />
      <DeleteManyDialog open={dialog === "delete"} count={deletableOf(picked, header.me.canModerate).length} skipped={picked.length - deletableOf(picked, header.me.canModerate).length} busy={busy} onClose={() => setDialog(null)} onConfirm={() => void remove()} />
      <HideManyDialog
        open={dialog === "hide"}
        count={picked.length}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          const ids = picked.map((m) => m.id);
          setBusy(true);
          void (parity?.hide(ids) ?? Promise.resolve({ ok: 0, total: 0 })).then((r) => {
            setBusy(false);
            setDialog(null);
            if (r.ok > 0) selectionStore.end();
          });
        }}
      />
      <TaskFromSelectionDialog
        open={dialog === "task"}
        messages={picked}
        privateSource={privateSource}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          selectionStore.end();
          say(ct("chatsel.task.done"));
          commands.refresh();
        }}
      />
    </>
  );
}
