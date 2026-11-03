"use client";

import React, { useEffect, useState } from "react";
import type { MessageDto } from "@/server/chat/dto";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";

type Option = { id: string; name: string };
type Space = Option & { holdsProjects: boolean };
export type WorkKind = "task" | "ticket";

/** The first line of the message, the way the server would cut it (src/server/chat/make-work.ts `titleFrom`). */
export function titleOf(body: string | null, max = 120): string {
  const line = (body ?? "").trim().split("\n")[0]!.trim();
  return line.length <= max ? line : `${line.slice(0, max).trim()}…`;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(url);
  return r.json() as Promise<T>;
}

/**
 * «اعمل منها مهمة» / «اعمل منها تذكرة» (the owner's ask, 2026-10-25): the message's first line is the title (it can be
 * changed); a task goes to a project's board of a space (the one the person is in first), a ticket to a department.
 * The server decides again (src/server/chat/make-work.ts) and keeps the link back to the message.
 */
export function MakeWorkDialog({
  message,
  kind,
  onClose,
  onDone,
  titleMax = 120,
}: {
  message: Pick<MessageDto, "id" | "body"> | null;
  kind: WorkKind;
  onClose: () => void;
  onDone: (made: { kind: WorkKind; id: string }) => void;
  /** how long the first line may be as a title (a comment of «نتفرّج سوا»: 200) */
  titleMax?: number;
}) {
  const [title, setTitle] = useState("");
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [spaceId, setSpaceId] = useState("");
  const [projects, setProjects] = useState<Option[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [boards, setBoards] = useState<Option[] | null>(null);
  const [boardId, setBoardId] = useState("");
  const [departments, setDepartments] = useState<Option[] | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [priority, setPriority] = useState<"URGENT" | "HIGH" | "NORMAL" | "LOW">("NORMAL");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = message !== null;

  // every time it opens: the message's first line, and the places to send it
  useEffect(() => {
    if (!message) return;
    setTitle(titleOf(message.body, titleMax));
    setError("");
    setBusy(false);
    let alive = true;
    if (kind === "task") {
      getJson<{ currentSpaceId: string | null; organizations: { workspaces: Space[] }[] }>("/api/workspaces")
        .then((data) => {
          if (!alive) return;
          const list = data.organizations.flatMap((o) => o.workspaces).filter((w) => w.holdsProjects);
          setSpaces(list);
          setSpaceId(list.find((w) => w.id === data.currentSpaceId)?.id ?? list[0]?.id ?? "");
        })
        .catch(() => alive && setError(ct("chatc.work.load_failed")));
    } else {
      getJson<{ departments: Option[] }>("/api/departments")
        .then((data) => {
          if (!alive) return;
          setDepartments(data.departments);
          setDepartmentId(data.departments[0]?.id ?? "");
        })
        .catch(() => alive && setError(ct("chatc.work.load_failed")));
    }
    return () => {
      alive = false;
    };
  }, [message, kind, titleMax]);

  // the space's projects, then the project's boards (one board: picked already)
  useEffect(() => {
    setProjects(null);
    setProjectId("");
    if (!spaceId) return;
    let alive = true;
    getJson<{ projects: Option[] }>(`/api/projects?workspaceId=${encodeURIComponent(spaceId)}`)
      .then((data) => {
        if (!alive) return;
        setProjects(data.projects);
        setProjectId(data.projects[0]?.id ?? "");
      })
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [spaceId]);
  useEffect(() => {
    setBoards(null);
    setBoardId("");
    if (!projectId) return;
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

  const ready = kind === "task" ? !!boardId : !!departmentId;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!message || busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      const at = `/api/chat/messages/${encodeURIComponent(message.id)}/${kind}`;
      const body =
        kind === "task"
          ? { workspaceId: spaceId, projectId, boardId, title: title.trim() || undefined, priority }
          : { departmentId, title: title.trim() || undefined, priority };
      const r = await fetch(at, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("work");
      const data = (await r.json()) as { taskId?: string; ticketId?: string };
      onDone({ kind, id: (kind === "task" ? data.taskId : data.ticketId) ?? "" });
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
          <DialogTitle>{ct(kind === "task" ? "chatc.work.task_title" : "chatc.work.ticket_title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={(e) => void save(e)} className="space-y-4">
            <div>
              <label htmlFor="work-title" className={label}>{ct("chatc.work.name")}</label>
              <input id="work-title" maxLength={kind === "task" ? 280 : 200} value={title} onChange={(e) => setTitle(e.currentTarget.value)} className={field} />
              <p className="mt-1 text-xs text-fg-muted">{ct("chatc.work.hint")}</p>
            </div>

            {kind === "task" ? (
              <>
                <div>
                  <label htmlFor="work-space" className={label}>{ct("chatc.work.space")}</label>
                  <select id="work-space" value={spaceId} onChange={(e) => setSpaceId(e.currentTarget.value)} className={field}>
                    {(spaces ?? []).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="work-project" className={label}>{ct("chatc.work.project")}</label>
                  <select id="work-project" value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)} disabled={!projects?.length} className={field}>
                    {(projects ?? []).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {projects && projects.length === 0 && <p className="mt-1 text-xs text-fg-muted">{ct("chatc.work.no_projects")}</p>}
                </div>
                {(boards?.length ?? 0) > 1 && (
                  <div>
                    <label htmlFor="work-board" className={label}>{ct("chatc.work.board")}</label>
                    <select id="work-board" value={boardId} onChange={(e) => setBoardId(e.currentTarget.value)} className={field}>
                      {(boards ?? []).map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            ) : (
              <div>
                <label htmlFor="work-department" className={label}>{ct("chatc.work.department")}</label>
                <select id="work-department" value={departmentId} onChange={(e) => setDepartmentId(e.currentTarget.value)} disabled={!departments?.length} className={field}>
                  {(departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {departments && departments.length === 0 && <p className="mt-1 text-xs text-fg-muted">{ct("chatc.work.no_departments")}</p>}
              </div>
            )}

            <div>
              <label htmlFor="work-priority" className={label}>{ct("chatc.work.priority")}</label>
              <select id="work-priority" value={priority} onChange={(e) => setPriority(e.currentTarget.value as typeof priority)} className={field}>
                {(["URGENT", "HIGH", "NORMAL", "LOW"] as const).map((p) => (
                  <option key={p} value={p}>{ct(`chatc.work.priority.${p}`)}</option>
                ))}
              </select>
            </div>

            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy || !ready} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg disabled:opacity-60">
              {ct(kind === "task" ? "chatc.work.make_task" : "chatc.work.make_ticket")}
            </button>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
