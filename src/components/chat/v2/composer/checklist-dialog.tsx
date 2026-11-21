"use client";

import React from "react";
import { X } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { messageClientId } from "@/lib/chat/conversation/client";
import { errorKeyOf } from "@/lib/chat/poll-client";
import { buildChecklistPayload, checklistDraftProblem, CHECKLIST_ITEM_MAX, CHECKLIST_MAX_ITEMS, CHECKLIST_TITLE_MAX, emptyChecklistDraft, type ChecklistDraft } from "@/lib/chat/checklist-client";
import { ct } from "@/lib/chat/text";

const FIELD = "h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm";

/**
 * «قائمة مهام» from the composer's paperclip (C3c.1): a title, 1 to 30 items (Enter in an item opens the next one), and two choices: may the others add items, may the
 * others tick them. It is sent as an ordinary message with a `checklist` (the send path, its limiter, its idempotent client id and its realtime event); the server checks
 * every rule again. Like `PollDialog`, it sits in a portal but inside the composer's form in the React tree, so its submit never reaches the composer's.
 */
export function ChecklistDialog({ open, conversationId, onClose, onCreated, portal = true }: { open: boolean; conversationId: string; onClose: () => void; onCreated: (message: MessageDto) => void; portal?: boolean }) {
  const [draft, setDraft] = React.useState<ChecklistDraft>(emptyChecklistDraft);
  const [clientId, setClientId] = React.useState(() => messageClientId());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [focusAt, setFocusAt] = React.useState<number | null>(null);
  const inputs = React.useRef<(HTMLInputElement | null)[]>([]);
  React.useEffect(() => {
    if (open) {
      setDraft(emptyChecklistDraft());
      setClientId(messageClientId());
      setError("");
      setBusy(false);
    }
  }, [open]);
  React.useEffect(() => {
    if (focusAt !== null) {
      inputs.current[focusAt]?.focus();
      setFocusAt(null);
    }
  }, [focusAt]);
  // a changed list is a different send: the id is renewed (a retry of the SAME words keeps its id, so a lost answer never makes two lists)
  const change = (patch: Partial<ChecklistDraft>) => {
    setClientId(messageClientId());
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setItem = (index: number, text: string) => change({ items: draft.items.map((o, i) => (i === index ? text : o)) });
  const problem = checklistDraftProblem(draft);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || problem) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildChecklistPayload(draft, clientId)),
      });
      if (!response.ok) {
        const key = errorKeyOf(await response.json().catch(() => null));
        throw new Error(key ? ct(key) : ct("chatcl.dialog.failed"));
      }
      onCreated((await response.json()) as MessageDto);
    } catch (e) {
      setError(e instanceof Error ? e.message : ct("chatcl.dialog.failed"));
      setBusy(false);
    }
  }

  function onItemKey(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    // Enter opens the next item instead of sending the list (the button sends)
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!draft.items[index]?.trim()) return;
    if (index < draft.items.length - 1) setFocusAt(index + 1);
    else if (draft.items.length < CHECKLIST_MAX_ITEMS) {
      change({ items: [...draft.items, ""] });
      setFocusAt(index + 1);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md" portal={portal}>
        <DialogHeader>
          <DialogTitle>{ct("chatcl.dialog.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form data-checklist-form onSubmit={(event) => void create(event)} className="space-y-4">
            <div>
              <label htmlFor="checklist-title" className="mb-1 block text-sm font-medium">
                {ct("chatcl.dialog.title_label")}
              </label>
              <input id="checklist-title" maxLength={CHECKLIST_TITLE_MAX} value={draft.title} placeholder={ct("chatcl.dialog.title_placeholder")} onChange={(e) => change({ title: e.currentTarget.value })} className={FIELD} />
            </div>
            <div className="space-y-2">
              {draft.items.map((text, index) => (
                <div key={index} className="flex items-center gap-2">
                  <label htmlFor={`checklist-item-${index}`} className="sr-only">
                    {ct("chatcl.dialog.item", { n: index + 1 })}
                  </label>
                  <input
                    id={`checklist-item-${index}`}
                    ref={(el) => {
                      inputs.current[index] = el;
                    }}
                    maxLength={CHECKLIST_ITEM_MAX}
                    value={text}
                    placeholder={ct("chatcl.dialog.item", { n: index + 1 })}
                    onChange={(e) => setItem(index, e.currentTarget.value)}
                    onKeyDown={(e) => onItemKey(e, index)}
                    className={FIELD}
                  />
                  {draft.items.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon" aria-label={ct("chatcl.dialog.remove_item", { n: index + 1 })} onClick={() => change({ items: draft.items.filter((_, i) => i !== index) })}>
                      <X aria-hidden="true" className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {draft.items.length < CHECKLIST_MAX_ITEMS ? (
                <Button type="button" variant="link" data-checklist-add-item className="min-h-11" onClick={() => change({ items: [...draft.items, ""] })}>
                  {ct("chatcl.dialog.add_item")}
                </Button>
              ) : null}
              <p className="text-xs text-fg-muted">{ct("chatcl.dialog.hint")}</p>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.othersCanAdd} onChange={(e) => change({ othersCanAdd: e.currentTarget.checked })} className="size-4" />
              {ct("chatcl.dialog.others_add")}
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.othersCanTick} onChange={(e) => change({ othersCanTick: e.currentTarget.checked })} className="size-4" />
              {ct("chatcl.dialog.others_tick")}
            </label>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy || problem !== null} className="w-full">
              {ct("chatcl.dialog.create")}
            </Button>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
