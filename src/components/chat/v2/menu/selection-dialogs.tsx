"use client";

import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { ForwardSheet } from "@/components/chat/v2/forward/forward-sheet";
import { useChatMessages } from "@/lib/chat/cache/selectors";
import { scheduleSync } from "@/lib/chat/cache/runtime";
import { forwardableOf, orderedSelection, selectionStore, useSelection } from "@/lib/chat/selection";
import { titleOf } from "@/components/chat/message/make-work-dialog";
import { ct } from "@/lib/chat/text";
import { WORK_INBOX_REF } from "@/lib/today";

/**
 * C3b.5 → S5.2 — «حوّل» for a selection: it opens THE forward sheet (`ForwardSheet`, the same one the single «حوّل» of a message opens): search, the saved chat on top, the
 * recents, every space's places, up to ten picked, an optional comment, «بدون اسم المرسل الأصلي», ONE «إرسال» and a toast with «افتح». It reads the picked messages itself
 * (the selection and the conversation's loaded window, in the conversation's order, polls left out) and, once at least one target got its copies, ends the selection and asks
 * the feed to catch up. `count` and `busy` are the bar's; `onSend` is no longer used (the bar's own sender was replaced by the sheet's).
 */
export function ForwardManyDialog({
  open,
  from,
  count,
  skipped,
  busy,
  onClose,
}: {
  open: boolean;
  from: string;
  /** how many messages go (polls are left out) */
  count: number;
  /** how many of the picked ones are left out */
  skipped: number;
  busy: boolean;
  onClose: () => void;
  /** kept so the bar still compiles; the sheet sends by itself */
  onSend?: (targetIds: string[], withoutAuthor: boolean) => void;
}) {
  const qc = useQueryClient();
  const selection = useSelection();
  const { messages } = useChatMessages(from);
  const ids = React.useMemo(() => forwardableOf(orderedSelection(selection.ids, messages)).forward.map((m) => m.id), [selection.ids, messages]);
  return (
    <ForwardSheet
      open={open}
      from={from}
      messageIds={count === 0 ? [] : ids}
      skipped={skipped}
      busy={busy}
      onClose={onClose}
      onSent={() => {
        selectionStore.end();
        scheduleSync(qc);
      }}
    />
  );
}

/** «احذف» for a selection: asks first, says how many can go (the ones that are not mine, for a person who does not moderate, stay and are not counted). */
export function DeleteManyDialog({ open, count, skipped, busy, onClose, onConfirm }: { open: boolean; count: number; skipped: number; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-label={ct("chatsel.del.title")}>
        <DialogHeader>
          <DialogTitle>{ct("chatsel.del.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p>{ct("chatsel.del.body")}</p>
          {skipped > 0 && count > 0 ? <p className="mt-2 text-sm text-fg-muted">{ct("chatsel.del.some_yours", { ok: count, total: count + skipped })}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {ct("chatc.cancel")}
          </Button>
          <Button type="button" variant="danger" disabled={busy || count === 0} onClick={onConfirm}>
            {ct("chatsel.del.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Option = { id: string; name: string };
type Space = Option & { holdsProjects: boolean };

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(url);
  return r.json() as Promise<T>;
}

/**
 * «اعمل مهمة» for a selection: ONE task. The dialog is `MakeWorkDialog`'s form for a task (the title from the first message's first words, a space, a project — the
 * company's inbox first when it is on — a board, a priority, and the P0.3 choice for a private source) sending the rest of the selection as `alsoMessageIds` to the
 * door of the FIRST message. The server decides the source (the earliest), the description (every message quoted with author and time), the visibility (a private
 * source keeps the whole task «المعنيين بس»; for everybody it asks `confirmPublic`) and the cap.
 */
export function TaskFromSelectionDialog({
  open,
  messages,
  privateSource,
  onClose,
  onDone,
}: {
  open: boolean;
  /** the picked messages, in the conversation's order */
  messages: readonly MessageDto[];
  privateSource: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [inboxOn, setInboxOn] = React.useState(false);
  const [spaces, setSpaces] = React.useState<Space[] | null>(null);
  const [spaceId, setSpaceId] = React.useState("");
  const [projects, setProjects] = React.useState<Option[] | null>(null);
  const [projectId, setProjectId] = React.useState("");
  const [boards, setBoards] = React.useState<Option[] | null>(null);
  const [boardId, setBoardId] = React.useState("");
  const [priority, setPriority] = React.useState<"URGENT" | "HIGH" | "NORMAL" | "LOW">("NORMAL");
  const [makePublic, setMakePublic] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const first = messages[0];
  const firstWithWords = messages.find((m) => (m.body ?? "").trim());

  React.useEffect(() => {
    if (!open) return;
    setTitle(titleOf(firstWithWords?.body ?? ""));
    setError("");
    setBusy(false);
    setMakePublic(false);
    let alive = true;
    getJson<{ currentSpaceId: string | null; organizations: { workspaces: Space[] }[] }>("/api/workspaces")
      .then((data) => {
        if (!alive) return;
        const list = data.organizations.flatMap((o) => o.workspaces).filter((w) => w.holdsProjects);
        setSpaces(list);
        setSpaceId(list.find((w) => w.id === data.currentSpaceId)?.id ?? list[0]?.id ?? "");
      })
      .catch(() => alive && setError(ct("chatc.work.load_failed")));
    return () => {
      alive = false;
    };
    // the title is the first words of the first message that has any, taken when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    setProjects(null);
    setProjectId("");
    setInboxOn(false);
    if (!spaceId) return;
    let alive = true;
    const at = encodeURIComponent(spaceId);
    Promise.all([getJson<{ projects: Option[] }>(`/api/projects?workspaceId=${at}`), getJson<{ projectId: string | null }>(`/api/instant/inbox?workspaceId=${at}`).catch(() => null)])
      .then(([data, inbox]) => {
        if (!alive) return;
        const list = inbox ? data.projects.filter((p) => p.id !== inbox.projectId) : data.projects;
        setInboxOn(inbox !== null);
        setProjects(list);
        setProjectId(inbox ? WORK_INBOX_REF : (list[0]?.id ?? ""));
      })
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [spaceId]);

  React.useEffect(() => {
    setBoards(null);
    setBoardId("");
    if (!projectId) return;
    if (projectId === WORK_INBOX_REF) {
      setBoards([]);
      setBoardId(WORK_INBOX_REF);
      return;
    }
    let alive = true;
    getJson<{ boards: Option[] }>(`/api/projects/${encodeURIComponent(projectId)}/boards`)
      .then((data) => {
        if (!alive) return;
        setBoards(data.boards);
        setBoardId(data.boards[0]?.id ?? "");
      })
      .catch(() => alive && setBoards([]));
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!first || busy || !boardId) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        workspaceId: spaceId,
        projectId,
        boardId,
        title: title.trim() || undefined,
        priority,
        alsoMessageIds: messages.slice(1).map((m) => m.id),
        ...(privateSource ? { visibility: makePublic ? "SPACE" : "PARTICIPANTS", ...(makePublic ? { confirmPublic: true } : {}) } : {}),
      };
      const r = await fetch(`/api/chat/messages/${encodeURIComponent(first.id)}/task`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("work");
      onDone();
    } catch {
      setError(ct("chatc.work.failed"));
      setBusy(false);
    }
  }

  const field = "h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm";
  const label = "mb-1 block text-sm font-medium";
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("chatsel.task.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={(e) => void save(e)} className="space-y-4">
            <p className="text-sm text-fg-muted">{ct("chatsel.task.hint")}</p>
            <div>
              <label htmlFor="sel-task-title" className={label}>
                {ct("chatc.work.name")}
              </label>
              <input id="sel-task-title" maxLength={280} value={title} onChange={(e) => setTitle(e.currentTarget.value)} className={field} />
            </div>
            <div>
              <label htmlFor="sel-task-space" className={label}>
                {ct("chatc.work.space")}
              </label>
              <select id="sel-task-space" value={spaceId} onChange={(e) => setSpaceId(e.currentTarget.value)} className={field}>
                {(spaces ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sel-task-project" className={label}>
                {ct("chatc.work.project")}
              </label>
              <select id="sel-task-project" value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)} disabled={!projects?.length && !inboxOn} className={field}>
                {inboxOn ? <option value={WORK_INBOX_REF}>{ct("work.inbox.name")}</option> : null}
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {projects && projects.length === 0 && !inboxOn ? <p className="mt-1 text-xs text-fg-muted">{ct("chatc.work.no_projects")}</p> : null}
            </div>
            {(boards?.length ?? 0) > 1 ? (
              <div>
                <label htmlFor="sel-task-board" className={label}>
                  {ct("chatc.work.board")}
                </label>
                <select id="sel-task-board" value={boardId} onChange={(e) => setBoardId(e.currentTarget.value)} className={field}>
                  {(boards ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label htmlFor="sel-task-priority" className={label}>
                {ct("chatc.work.priority")}
              </label>
              <select id="sel-task-priority" value={priority} onChange={(e) => setPriority(e.currentTarget.value as typeof priority)} className={field}>
                {(["URGENT", "HIGH", "NORMAL", "LOW"] as const).map((p) => (
                  <option key={p} value={p}>
                    {ct(`chatc.work.priority.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            {privateSource ? (
              <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={makePublic} onChange={(e) => setMakePublic(e.currentTarget.checked)} className="mt-1 h-4 w-4" />
                  <span>{ct("taskpriv.make_public")}</span>
                </label>
                {makePublic ? (
                  <>
                    <p className="mt-2">{ct("taskpriv.from_private_warn")}</p>
                    <p className="mt-1">{ct("taskpriv.from_private_fix")}</p>
                  </>
                ) : (
                  <p className="mt-2 text-fg-muted">{ct("taskpriv.private_default")}</p>
                )}
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy || !boardId} className="w-full">
              {ct("chatc.work.make_task")}
            </Button>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
