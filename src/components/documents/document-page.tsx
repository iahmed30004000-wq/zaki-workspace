"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bold, Heading1, Heading2, History, Link2, List, ListOrdered, Trash2, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { fmtAgo, fmtDateTime, fmtNumber } from "@/lib/format";
import { filterMentionChoices } from "@/lib/chat/conversation/mentions";
import { applyEdit, mentionContext, pickMention, type EditAction } from "@/lib/docs/edit";
import { LIMITS } from "@/lib/docs/markup";
import type { DocItem, DocRevisionFull, DocRevisionsView } from "@/lib/docs/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { DocBody } from "./doc-body";
import { docErrorText } from "./documents-view";

/** What the server answers when the document moved on: the document as it is now. */
export interface DocConflict {
  title: string;
  content: string;
  version: number;
  updatedAt: string;
  lastEditorName: string | null;
}

type SaveState = "saved" | "unsaved" | "saving" | "error" | "title";

const AUTOSAVE_MS = 1200;
const RETRY_MS = 6000;

const TOOLS: Array<{ action: EditAction; icon: React.ComponentType<{ className?: string }>; label: string }> = [
  { action: "h1", icon: Heading1, label: "docs.tb.h1" },
  { action: "h2", icon: Heading2, label: "docs.tb.h2" },
  { action: "bold", icon: Bold, label: "docs.tb.bold" },
  { action: "ul", icon: List, label: "docs.tb.ul" },
  { action: "ol", icon: ListOrdered, label: "docs.tb.ol" },
  { action: "link", icon: Link2, label: "docs.tb.link" },
];

/** The «someone saved before you» banner: three conscious ways out, nothing is written by ignoring it. */
export function ConflictBanner({ current, onKeep, onTake, onCopy }: { current: DocConflict; onKeep: () => void; onTake: () => void; onCopy: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
      <p className="font-semibold text-fg">{t("docs.conflict.title")}</p>
      <p className="mt-1 text-fg-muted">
        {current.lastEditorName
          ? t("docs.conflict.body", { who: current.lastEditorName, n: fmtNumber(current.version) })
          : t("docs.conflict.body_nobody", { n: fmtNumber(current.version) })}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={onKeep}>{t("docs.conflict.keep")}</Button>
        <Button size="sm" variant="secondary" onClick={onTake}>{t("docs.conflict.take")}</Button>
        <Button size="sm" variant="ghost" onClick={onCopy}>{t("docs.conflict.copy")}</Button>
      </div>
    </div>
  );
}

/** One past version: its words, and the button that brings it back as a NEW version. */
function RevisionPreview({ docId, version, names, canWrite, onRestore, onClose }: { docId: string; version: number; names: string[]; canWrite: boolean; onRestore: (version: number) => void; onClose: () => void }) {
  const { t } = useI18n();
  const one = useQuery({
    queryKey: ["doc", docId, "revision", version],
    queryFn: () => apiGet<{ revision: DocRevisionFull }>(`/api/documents/${docId}/revisions?version=${version}`),
    staleTime: Infinity,
  });
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-2 p-3">
      {one.isLoading || !one.data ? (
        <p className="text-xs text-fg-muted">{t("docs.history.loading")}</p>
      ) : (
        <>
          <p className="text-sm font-semibold text-fg">{one.data.revision.title}</p>
          <DocBody content={one.data.revision.content} names={names} emptyText={t("docs.preview_empty")} />
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {canWrite && <Button size="sm" onClick={() => onRestore(version)}>{t("docs.history.restore")}</Button>}
        <Button size="sm" variant="ghost" onClick={onClose}>{t("docs.history.close")}</Button>
      </div>
    </div>
  );
}

export function HistoryPanel({ doc, canWrite, onRestore, initial }: { doc: Pick<DocItem, "id" | "version">; canWrite: boolean; onRestore: (version: number) => void; initial?: DocRevisionsView }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState<number | null>(null);
  const query = useQuery({
    queryKey: ["doc", doc.id, "revisions", doc.version],
    queryFn: () => apiGet<DocRevisionsView>(`/api/documents/${doc.id}/revisions`),
    ...(initial ? { initialData: initial } : {}),
    staleTime: 5_000,
  });
  const revisions = query.data?.revisions ?? [];
  return (
    <section aria-label={t("docs.history")} className="rounded-xl border border-border bg-surface-1 p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <History className="size-4 text-fg-muted" />
        {t("docs.history")}
      </h2>
      <p className="mt-1 text-xs text-fg-muted">{t("docs.history.hint")}</p>
      <p className="mt-1 text-xs text-fg-muted">{t("docs.history.current", { n: fmtNumber(doc.version) })}</p>
      {revisions.length === 0 ? (
        <p className="mt-2 text-xs text-fg-muted">{t("docs.history.empty")}</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {revisions.map((r) => (
            <li key={r.version} className="rounded-lg border border-border p-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-fg">{t("docs.history.version", { n: fmtNumber(r.version) })}</span>
                <span className="text-fg-muted">{t("docs.history.by", { who: r.editorName })}</span>
                <span className="text-fg-muted">{fmtDateTime(r.createdAt)}</span>
                {r.cause === "RESTORE" && <span className="rounded-full bg-info/10 px-2 py-0.5 text-info">{t("docs.history.replaced_restore")}</span>}
                <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setOpen(open === r.version ? null : r.version)}>
                  {t("docs.history.view")}
                </Button>
              </div>
              {open === r.version && (
                <RevisionPreview docId={doc.id} version={r.version} names={[]} canWrite={canWrite} onRestore={onRestore} onClose={() => setOpen(null)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * «المستندات» — one document: the writing box with its toolbar, the live preview, autosave, the history and the settings.
 *
 * Saving is protected by versions, as a card's is: every save carries the version the editor started from, a document that
 * moved on answers 409 and this screen shows `ConflictBanner`; nothing is overwritten silently. ⚠️ There is no live co-editing,
 * and the page says so (the last save wins, a colleague's save is announced). The server decided what this person may do
 * (`canWrite`, `canManage`) and decides again on every request.
 */
export function DocumentPage({ initial }: { initial: DocItem }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const canWrite = initial.canWrite;

  const [title, setTitle] = React.useState(initial.title);
  const [content, setContent] = React.useState(initial.content);
  const [version, setVersion] = React.useState(initial.version);
  const [shared, setShared] = React.useState(initial.sharedWithPartners);
  const [state, setState] = React.useState<SaveState>("saved");
  const [conflict, setConflict] = React.useState<DocConflict | null>(null);
  const [mode, setMode] = React.useState<"write" | "read">(canWrite ? "write" : "read");
  const [showHistory, setShowHistory] = React.useState(false);
  const [pick, setPick] = React.useState<{ query: string; index: number } | null>(null);

  // what the server holds, as this screen last learned it; the live text is compared with it
  const saved = React.useRef({ title: initial.title, content: initial.content, version: initial.version });
  const live = React.useRef({ title, content });
  live.current = { title, content };
  const inflight = React.useRef(false);
  const stopped = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const area = React.useRef<HTMLTextAreaElement>(null);
  const names = React.useMemo(() => initial.people.map((p) => p.name), [initial.people]);

  const isDirty = () => live.current.title !== saved.current.title || live.current.content !== saved.current.content;

  const schedule = React.useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function flush(): Promise<void> {
    if (!canWrite || inflight.current || stopped.current) return;
    const patch: { title?: string; content?: string } = {};
    const base = saved.current;
    if (live.current.content !== base.content) patch.content = live.current.content;
    if (live.current.title !== base.title) {
      if (live.current.title.trim().length === 0) setState("title");
      else patch.title = live.current.title;
    }
    if (patch.title === undefined && patch.content === undefined) return;
    inflight.current = true;
    setState("saving");
    try {
      const res = await apiPatch<{ document: DocItem }>(`/api/documents/${initial.id}`, { version: base.version, ...patch });
      // compared with what was SENT, not with what the server stored (it may have cleaned the text), so a save never loops
      saved.current = { title: patch.title ?? base.title, content: patch.content ?? base.content, version: res.document.version };
      setVersion(res.document.version);
      setState(isDirty() ? "unsaved" : "saved");
      void qc.invalidateQueries({ queryKey: ["doc", initial.id, "revisions"] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const current = (err.body as { current?: DocConflict } | null)?.current;
        if (current) {
          stopped.current = true; // no more autosave until the person chooses
          setConflict(current);
          setState("unsaved");
        } else setState("error");
      } else {
        setState("error");
        schedule(RETRY_MS);
        if (err instanceof ApiError && err.status !== 0 && err.status < 500) toast(docErrorText(t, err), "error");
      }
    } finally {
      inflight.current = false;
      if (!stopped.current && isDirty() && !timer.current) schedule(AUTOSAVE_MS);
    }
  }

  // every change of the words schedules a save a moment after the typing stops
  React.useEffect(() => {
    if (!canWrite || stopped.current) return;
    if (!isDirty()) return;
    setState((s) => (s === "saving" ? s : "unsaved"));
    schedule(AUTOSAVE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content]);

  React.useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (canWrite && (isDirty() || inflight.current)) {
        event.preventDefault();
        event.returnValue = t("docs.leave");
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Wait for the save that is running, then save what is left, before something that needs the document at rest. */
  async function settle(): Promise<boolean> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    for (let i = 0; i < 40 && inflight.current; i++) await new Promise((r) => setTimeout(r, 100));
    await flush();
    for (let i = 0; i < 40 && inflight.current; i++) await new Promise((r) => setTimeout(r, 100));
    return !conflict && !isDirty();
  }

  const conflictActions = {
    keep: () => {
      if (!conflict) return;
      // «آخر حفظ بيفوز», by choice: start again from the version that is there now, with my words
      saved.current = { ...saved.current, version: conflict.version };
      stopped.current = false;
      setConflict(null);
      void flush().then(() => toast(t("docs.conflict.kept"), "success"));
    },
    take: () => {
      if (!conflict) return;
      if (!window.confirm(t("docs.conflict.take_confirm"))) return;
      saved.current = { title: conflict.title, content: conflict.content, version: conflict.version };
      setTitle(conflict.title);
      setContent(conflict.content);
      setVersion(conflict.version);
      stopped.current = false;
      setConflict(null);
      setState("saved");
    },
    copy: () => {
      void navigator.clipboard?.writeText(live.current.content).then(
        () => toast(t("docs.conflict.copied"), "success"),
        () => undefined,
      );
    },
  };

  async function restore(target: number) {
    if (!window.confirm(t("docs.history.restore_confirm"))) return;
    if (!(await settle())) return;
    try {
      const res = await apiPost<{ document: DocItem }>(`/api/documents/${initial.id}/restore`, { version: target, baseVersion: saved.current.version });
      saved.current = { title: res.document.title, content: res.document.content, version: res.document.version };
      setTitle(res.document.title);
      setContent(res.document.content);
      setVersion(res.document.version);
      setState("saved");
      void qc.invalidateQueries({ queryKey: ["doc", initial.id] });
      toast(t("docs.history.restored"), "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const current = (err.body as { current?: DocConflict } | null)?.current;
        if (current) {
          stopped.current = true;
          setConflict(current);
          return;
        }
      }
      toast(docErrorText(t, err), "error");
    }
  }

  async function toggleShare(next: boolean) {
    if (next && !window.confirm(t("docs.share.confirm"))) return;
    try {
      const res = await apiPost<{ document: DocItem }>(`/api/documents/${initial.id}/share`, { shared: next });
      setShared(res.document.sharedWithPartners);
      toast(t(next ? "docs.share.on_toast" : "docs.share.off_toast"), "success");
    } catch (err) {
      toast(docErrorText(t, err), "error");
    }
  }

  async function archive() {
    if (!window.confirm(t("docs.archive.confirm"))) return;
    try {
      stopped.current = true;
      await apiDelete(`/api/documents/${initial.id}`);
      toast(t("docs.archive.done"), "success");
      router.push("/documents");
    } catch (err) {
      stopped.current = false;
      toast(docErrorText(t, err), "error");
    }
  }

  // ---------- the writing box ----------

  function tool(action: EditAction) {
    const el = area.current;
    if (!el) return;
    const out = applyEdit(el.value, { start: el.selectionStart, end: el.selectionEnd }, action);
    setContent(out.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(out.selection.start, out.selection.end);
    });
  }

  const choices = React.useMemo(() => (pick ? filterMentionChoices(initial.people, pick.query).slice(0, 6) : []), [pick, initial.people]);

  function readPick() {
    const el = area.current;
    if (!el || !canWrite) return;
    const at = mentionContext(el.value, el.selectionStart);
    setPick(at ? { query: at.query, index: 0 } : null);
  }

  function choose(name: string) {
    const el = area.current;
    if (!el) return;
    const out = pickMention(el.value, el.selectionStart, name);
    setContent(out.value);
    setPick(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(out.cursor, out.cursor);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!pick || choices.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : choices.length - 1;
      setPick({ ...pick, index: (pick.index + step) % choices.length });
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const chosen = choices[pick.index];
      if (chosen) choose(chosen.name);
    } else if (event.key === "Escape") {
      setPick(null);
    }
  }

  const statusText = !canWrite
    ? initial.archived
      ? t("docs.save.archived")
      : t("docs.save.readonly")
    : t(
        state === "saving"
          ? "docs.save.saving"
          : state === "saved"
            ? "docs.save.saved"
            : state === "error"
              ? "docs.save.error"
              : state === "title"
                ? "docs.save.title_needed"
                : "docs.save.unsaved",
      );

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/documents" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
          <ArrowRight className="size-3.5" />
          {t("docs.back")}
        </Link>
        <span role="status" aria-live="polite" className={cn("ms-auto text-xs", state === "error" || state === "title" ? "text-danger" : "text-fg-muted")}>
          {statusText}
        </span>
      </div>

      {canWrite ? (
        <Input
          aria-label={t("docs.title_label")}
          value={title}
          maxLength={LIMITS.title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-12 text-lg font-semibold md:h-11 md:text-lg"
        />
      ) : (
        <h1 className="text-xl font-bold text-fg">{title}</h1>
      )}
      {!canWrite && (
        <p className="text-xs text-fg-muted">
          {initial.authorName ? `${t("docs.by", { who: initial.authorName })} · ` : ""}
          {t("docs.updated", { when: fmtAgo(initial.updatedAt) })}
        </p>
      )}

      {canWrite && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
          <p className="text-fg">{t("docs.noco.warn")}</p>
          <p className="mt-0.5 text-fg-muted">{t("docs.noco.fix")}</p>
        </div>
      )}

      {conflict && <ConflictBanner current={conflict} onKeep={conflictActions.keep} onTake={conflictActions.take} onCopy={conflictActions.copy} />}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label={t("docs.tb.toolbar")}>
          {TOOLS.map(({ action, icon: Icon, label }) => (
            <Button key={action} size="icon" variant="ghost" type="button" aria-label={t(label)} title={t(label)} onClick={() => tool(action)} disabled={mode === "read"}>
              <Icon className="size-4" />
            </Button>
          ))}
          <div className="ms-auto flex gap-1 md:hidden">
            <Button size="sm" variant={mode === "write" ? "primary" : "ghost"} onClick={() => setMode("write")}>{t("docs.mode_write")}</Button>
            <Button size="sm" variant={mode === "read" ? "primary" : "ghost"} onClick={() => setMode("read")}>{t("docs.mode_read")}</Button>
          </div>
        </div>
      )}

      <div className={cn("grid gap-3", canWrite && "md:grid-cols-2")}>
        {canWrite && (
          <div className={cn("relative", mode === "read" && "hidden md:block")}>
            <textarea
              ref={area}
              dir="rtl"
              aria-label={t("docs.body_label")}
              value={content}
              maxLength={LIMITS.content}
              placeholder={t("docs.body_ph")}
              onChange={(e) => {
                setContent(e.target.value);
                requestAnimationFrame(readPick);
              }}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => {
                if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) readPick();
              }}
              onClick={readPick}
              onBlur={() => setTimeout(() => setPick(null), 150)}
              className="min-h-[55vh] w-full resize-y rounded-lg border border-border bg-surface p-3 text-base leading-7 text-fg placeholder:text-fg-muted focus:border-accent/60 md:text-sm"
            />
            {pick && choices.length > 0 && (
              <ul role="listbox" aria-label={t("docs.mention_list")} className="absolute start-2 end-2 bottom-2 z-10 max-h-48 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
                {choices.map((person, i) => (
                  <li key={person.id} role="option" aria-selected={i === pick.index}>
                    <button
                      type="button"
                      className={cn("w-full px-3 py-2 text-start text-sm", i === pick.index ? "bg-accent/10 text-accent" : "text-fg hover:bg-surface-2")}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(person.name);
                      }}
                    >
                      {person.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className={cn("min-w-0 rounded-lg border border-border bg-surface-1 p-3", canWrite && mode === "write" && "hidden md:block")}>
          {canWrite && <p className="mb-1 text-xs font-medium text-fg-muted">{t("docs.preview")}</p>}
          <DocBody content={content} names={names} emptyText={t("docs.preview_empty")} />
        </div>
      </div>

      {initial.canManage && !initial.archived && (
        <section className="space-y-2 rounded-xl border border-border bg-surface-1 p-3">
          <label className="flex items-start gap-2 text-sm text-fg">
            <input type="checkbox" className="mt-1 size-4" checked={shared} onChange={(e) => void toggleShare(e.target.checked)} />
            <span>
              <span className="flex items-center gap-1 font-medium">
                <Users className="size-4 text-info" />
                {t("docs.share.label")}
              </span>
              <span className="block text-xs text-fg-muted">{t("docs.share.hint")}</span>
            </span>
          </label>
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
            <p className="text-fg">{t("docs.share.warn")}</p>
            <p className="mt-0.5 text-fg-muted">{t("docs.share.fix")}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void archive()} className="text-danger">
            <Trash2 className="size-4" />
            {t("docs.archive")}
          </Button>
        </section>
      )}

      {!initial.archived && initial.internal && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setShowHistory((v) => !v)}>
            <History className="size-4" />
            {t("docs.history")}
          </Button>
        </div>
      )}
      {showHistory && initial.internal && <HistoryPanel doc={{ id: initial.id, version }} canWrite={canWrite} onRestore={(v) => void restore(v)} />}
    </div>
  );
}
