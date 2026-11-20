"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ListTodo, Pencil, Trash2 } from "lucide-react";
import type { ChecklistDto, ChecklistItemDto, ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { Button } from "@/components/ui/button";
import { MakeWorkDialog } from "@/components/chat/message/make-work-dialog";
import { chatKeys } from "@/lib/chat/cache/keys";
import { replaceMessage } from "@/lib/chat/cache/writer";
import { checklistRequestOf, CHECKLIST_ITEM_MAX, doneLineKey, type ChecklistAction } from "@/lib/chat/checklist-client";
import { errorKeyOf } from "@/lib/chat/poll-client";
import { ct } from "@/lib/chat/text";
import { fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * «قائمة مهام» (C3c.1) — the list a CHECKLIST message draws under its title: a box per item, who finished a ticked item and when («خلّصها فلان · 10:20»), the progress
 * («3 من 5»), «+ أضف بند» where the server says I may, and a pencil and a bin on the items I may change. Every control follows what the server sent (`canTick`, `canAdd`,
 * `canEdit`) and the server decides again; an answer is the message as this person now sees it, and it replaces the message in the cache (the other screens are told by
 * `checklist.changed` and the sync feed, which return the presented message for each of them).
 *
 * The view is pure (`ChecklistView`: props in, markup out, so a render test needs no cache); `ChecklistBubble` adds the requests and the cache.
 */

export interface ChecklistViewProps {
  checklist: ChecklistDto;
  busy?: boolean;
  error?: string;
  /** an action of the list; resolves when it is done (the view closes an edit or an add only on `true`) */
  onAct?: (action: ChecklistAction) => Promise<boolean>;
  /** «اعمل منها مهمة»: absent, the button is not drawn */
  onMakeTask?: () => void;
}

function ItemRow({ item, canTick, busy, onAct }: { item: ChecklistItemDto; canTick: boolean; busy: boolean; onAct?: ChecklistViewProps["onAct"] }) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(item.text);
  const doneKey = doneLineKey(item);
  const act = (action: ChecklistAction) => onAct?.(action) ?? Promise.resolve(false);
  if (editing) {
    return (
      <li data-checklist-item={item.id} className="flex items-center gap-1.5">
        <input
          autoFocus
          maxLength={CHECKLIST_ITEM_MAX}
          value={text}
          aria-label={ct("chatcl.edit")}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
            if (e.key === "Enter" && !e.nativeEvent.isComposing && text.trim()) void act({ type: "edit", itemId: item.id, text }).then((ok) => ok && setEditing(false));
          }}
          className="h-10 min-w-0 flex-1 rounded-lg border border-muted bg-surface px-2 text-sm md:h-8"
        />
        <Button type="button" size="sm" variant="tonal" disabled={busy || !text.trim()} onClick={() => void act({ type: "edit", itemId: item.id, text }).then((ok) => ok && setEditing(false))}>
          {ct("chatcl.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          {ct("chatcl.cancel")}
        </Button>
      </li>
    );
  }
  return (
    <li data-checklist-item={item.id} data-done={item.done ? "true" : "false"} className="group/item flex items-start gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        disabled={!canTick || busy}
        onClick={() => void act({ type: "tick", itemId: item.id, done: !item.done })}
        className="flex min-h-9 min-w-0 flex-1 items-start gap-2 rounded-lg px-1 py-1.5 text-start text-sm disabled:cursor-default"
      >
        <span aria-hidden="true" className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded border", item.done ? "border-accent bg-accent text-accent-fg" : "border-border")}>
          {item.done ? <Check className="size-3.5" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block break-words", item.done && "text-fg-muted line-through")}>{item.text}</span>
          {doneKey ? (
            <span data-checklist-done-line className="block text-xs text-fg-muted">
              {ct(doneKey, { name: item.doneByName ?? "", time: fmtTime(item.doneAt) })}
            </span>
          ) : null}
        </span>
      </button>
      {item.canEdit ? (
        <span className="flex shrink-0 items-center">
          <Button type="button" size="icon" variant="ghost" aria-label={ct("chatcl.edit")} disabled={busy} onClick={() => { setText(item.text); setEditing(true); }}>
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label={ct("chatcl.remove")} disabled={busy} onClick={() => void act({ type: "remove", itemId: item.id })}>
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </span>
      ) : null}
    </li>
  );
}

export function ChecklistView({ checklist, busy = false, error = "", onAct, onMakeTask }: ChecklistViewProps) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const submit = () => {
    if (!draft.trim() || busy) return;
    void (onAct?.({ type: "add", text: draft }) ?? Promise.resolve(false)).then((ok) => {
      if (ok) {
        setDraft("");
        setAdding(false);
      }
    });
  };
  return (
    <div data-checklist className="mt-1.5 w-72 max-w-full space-y-1">
      <ul aria-label={ct("chatcl.list")} className="space-y-0.5">
        {checklist.items.map((item) => (
          <ItemRow key={item.id} item={item} canTick={checklist.canTick} busy={busy} onAct={onAct} />
        ))}
      </ul>
      {adding ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            maxLength={CHECKLIST_ITEM_MAX}
            value={draft}
            placeholder={ct("chatcl.add_placeholder")}
            aria-label={ct("chatcl.add_placeholder")}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(false);
              if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
            }}
            className="h-10 min-w-0 flex-1 rounded-lg border border-muted bg-surface px-2 text-sm md:h-8"
          />
          <Button type="button" size="sm" variant="tonal" disabled={busy || !draft.trim()} onClick={submit}>
            {ct("chatcl.add_save")}
          </Button>
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        <span data-checklist-progress>{ct("chatcl.progress", { done: checklist.done, total: checklist.total })}</span>
        {checklist.canAdd && !adding ? (
          <Button type="button" variant="link" data-checklist-add className="min-h-8 text-xs font-semibold" disabled={busy} onClick={() => setAdding(true)}>
            {ct("chatcl.add")}
          </Button>
        ) : null}
        {!checklist.canAdd && checklist.total >= checklist.max && checklist.othersCanAdd ? <span>{ct("chatcl.full", { max: checklist.max })}</span> : null}
        {onMakeTask ? (
          <Button type="button" variant="link" data-checklist-make-task className="min-h-8 gap-1 text-xs font-semibold" disabled={busy} onClick={onMakeTask}>
            <ListTodo aria-hidden="true" className="size-3.5" />
            {ct("chatcl.to_task")}
          </Button>
        ) : null}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The list of a message, with its requests. «اعمل منها مهمة» is drawn for a person who may make work of a message (the header the pane already holds says so: `me.canMakeWork`,
 * the tasks box of the section grid) while the message has not become a task; it runs the ONE door that makes work of a message (the same dialog and the same privacy rule as
 * the menu's item: a list from a private conversation makes a private task) and then asks for the steps (`POST …/checklist/steps`).
 */
export function ChecklistBubble({ message, conversationId }: { message: MessageDto; conversationId: string }) {
  const qc = useQueryClient();
  const header = qc.getQueryData<ConversationHeaderDto>(chatKeys.header(conversationId));
  const canMakeTask = !!header?.me.canMakeWork && header.me.canMakeTask !== false && !header.me.oversight && !message.work?.some((w) => w.kind === "task");
  const privateSource = !!header && (header.kind !== "TOPIC" || !!header.restricted || !!header.teamId);
  const [busy, setBusy] = React.useState(false);
  // two quick presses in one render tick both see `busy === false`: the guard is a ref, so one request is in flight at a time and the answers cannot arrive out of order
  const inFlight = React.useRef(false);
  const [error, setError] = React.useState("");
  const [making, setMaking] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const checklist = message.checklist;
  if (!checklist || message.deleted) return null;

  async function act(action: ChecklistAction): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const request = checklistRequestOf(message.id, action);
      const response = await fetch(request.url, { method: request.method, headers: request.body ? { "content-type": "application/json" } : undefined, body: request.body ? JSON.stringify(request.body) : undefined });
      if (!response.ok) {
        const key = errorKeyOf(await response.json().catch(() => null));
        throw new Error(key ? ct(key) : ct("chatcl.failed"));
      }
      replaceMessage(qc, conversationId, (await response.json()) as MessageDto);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : ct("chatcl.failed"));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function stepsFor(taskId: string) {
    const response = await fetch(`/api/chat/messages/${encodeURIComponent(message.id)}/checklist/steps`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId }) }).catch(() => null);
    setNotice(ct(response?.ok ? "chatcl.to_task_done" : "chatcl.to_task_steps_failed"));
    // the «صارت مهمة» chip: no event of the feed says that a task was made of a message, so the messages are asked for again
    void qc.invalidateQueries({ queryKey: chatKeys.messages(conversationId), exact: true });
  }

  return (
    <>
      <ChecklistView checklist={checklist} busy={busy} error={error} onAct={act} {...(canMakeTask ? { onMakeTask: () => setMaking(true) } : {})} />
      {notice ? (
        <p role="status" className="mt-1 text-xs text-fg-muted">
          {notice}
        </p>
      ) : null}
      {making ? (
        <MakeWorkDialog
          message={{ id: message.id, body: message.body }}
          kind="task"
          privateSource={privateSource}
          onClose={() => setMaking(false)}
          onDone={(made) => {
            setMaking(false);
            if (made.kind === "task") void stepsFor(made.id);
          }}
        />
      ) : null}
    </>
  );
}
