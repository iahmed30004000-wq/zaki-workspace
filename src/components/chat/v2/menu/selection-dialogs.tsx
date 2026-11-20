"use client";

import React from "react";
import type { HomeDto, MessageDto } from "@/server/chat/dto";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { forwardTargets, type ForwardTarget } from "@/components/chat/message/message-dialogs";
import { titleOf } from "@/components/chat/message/make-work-dialog";
import { ct } from "@/lib/chat/text";
import { WORK_INBOX_REF } from "@/lib/today";

/** The most conversations one forward goes to (the server holds the same cap). */
const TARGETS_MAX = 10;

/**
 * C3b.5 — «حوّل» for a selection: pick one conversation or more (up to ten) from the places the old forward dialog lists (every topic I may write in and every private
 * chat of mine, never the one I am in), and say whether the copies carry the original sender's name. The server checks every target again and reports each one.
 */
export function ForwardManyDialog({
  open,
  from,
  count,
  skipped,
  busy,
  onClose,
  onSend,
}: {
  open: boolean;
  from: string;
  /** how many messages go (polls are left out) */
  count: number;
  /** how many of the picked ones are left out */
  skipped: number;
  busy: boolean;
  onClose: () => void;
  onSend: (targetIds: string[], withoutAuthor: boolean) => void;
}) {
  const [targets, setTargets] = React.useState<ForwardTarget[] | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [hideAuthor, setHideAuthor] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setTargets(null);
    setPicked([]);
    setHideAuthor(false);
    let alive = true;
    void fetch("/api/chat/home", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<HomeDto>) : Promise.reject(new Error("home"))))
      .then((home) => alive && setTargets(forwardTargets(home, from)))
      .catch(() => alive && setTargets([]));
    return () => {
      alive = false;
    };
  }, [open, from]);
  const toggle = (id: string) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : now.length >= TARGETS_MAX ? now : [...now, id]));
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-label={ct("chatsel.fwd.title")}>
        <DialogHeader>
          <DialogTitle>{ct("chatsel.fwd.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="mb-2 text-sm text-fg-muted">{ct("chatsel.fwd.hint")}</p>
          {skipped > 0 ? <p className="mb-2 text-sm text-warn">{ct("chatsel.fwd.skipped")}</p> : null}
          {targets === null ? (
            <p role="status">…</p>
          ) : targets.length === 0 ? (
            <p>{ct("chatsel.fwd.empty")}</p>
          ) : (
            <ul className="flex max-h-72 flex-col overflow-y-auto">
              {targets.map((t) => {
                const on = picked.includes(t.id);
                return (
                  <li key={t.id}>
                    <label className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 hover:bg-surface-2">
                      <input type="checkbox" data-forward-target={t.id} checked={on} disabled={!on && picked.length >= TARGETS_MAX} onChange={() => toggle(t.id)} className="size-4" />
                      <span className="min-w-0 truncate">{t.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
            <input type="checkbox" data-forward-hide-author checked={hideAuthor} onChange={(e) => setHideAuthor(e.currentTarget.checked)} className="size-4" />
            <span>{ct("chatsel.fwd.hide_author")}</span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {ct("chatc.cancel")}
          </Button>
          <Button type="button" disabled={busy || picked.length === 0 || count === 0} onClick={() => onSend(picked, hideAuthor)}>
            {ct("chatsel.fwd.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            <button type="submit" disabled={busy || !boardId} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg disabled:opacity-60">
              {ct("chatc.work.make_task")}
            </button>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
