"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, MessageSquare, Send, Ticket as TicketIcon } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { enumLabel, enumOptions } from "@/lib/i18n/enums";
import { errText } from "@/components/department-tickets";

interface CommentRow {
  id: string;
  body: string;
  editedAt: string | null;
  createdAt: string;
  author: { id: string; name: string } | null;
}
interface ActivityRow {
  id: string;
  event: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}
/** W1.6: the task made from the ticket, as this reader may read it: named, or only «hidden» (the fact that a link exists). */
type LinkedTask = { state: "visible"; id: string; key: string; title: string } | { state: "hidden" };
interface TicketDetail {
  id: string;
  /** null: an «تذكرة فورية» (its status is changed here: there is no department desk for it) */
  departmentId: string | null;
  number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string;
  creator: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  /** null: the ticket was never turned into a task */
  task?: LinkedTask | null;
  comments: CommentRow[];
  activities: ActivityRow[];
}

const EVENT_KEYS: Record<string, string> = {
  created: "tkAct.created",
  edited: "tkAct.edited",
  status_changed: "tkAct.statusChanged",
  assigned: "tkAct.assigned",
  commented: "tkAct.commented",
};

/** نافذة التذكرة: التعليقات + سجل النشاط. */
export function TicketDetailModal({
  ticketId,
  currentUserId,
  onClose,
}: {
  ticketId: string;
  currentUserId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const detail = useQuery({
    queryKey: ["ticket-detail", ticketId],
    queryFn: () => apiGet<{ ticket: TicketDetail }>(`/api/tickets/${ticketId}/detail`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ticket-detail", ticketId] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
  };

  const addComment = useMutation({
    mutationFn: () => apiPost(`/api/tickets/${ticketId}/detail`, { body }),
    onSuccess: () => {
      setBody("");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const saveEdit = useMutation({
    mutationFn: (payload: { id: string; body: string }) =>
      apiPatch(`/api/tickets/${ticketId}/comments/${payload.id}`, { body: payload.body }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => apiPatch(`/api/tickets/${ticketId}`, { status }),
    onSuccess: () => invalidate(),
    onError: (err) => toast(errText(err, t), "error"),
  });

  // W1.6 «حوّل لمهمة»: one task per ticket (a second click returns the same one)
  const toTask = useMutation({
    mutationFn: () => apiPost<{ created: boolean; task: LinkedTask }>(`/api/tickets/${ticketId}/task`, {}),
    onSuccess: (res) => {
      toast(t(res.created ? "work.convert.done" : "work.convert.already"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const delComment = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/tickets/${ticketId}/comments/${id}`),
    onSuccess: () => invalidate(),
    onError: (err) => toast(errText(err, t), "error"),
  });

  const tk = detail.data?.ticket;
  const comments = tk?.comments ?? [];
  const activities = tk?.activities ?? [];

  return (
    <Modal open onClose={onClose} title={`T${tk?.number ?? "…"} — ${tk?.title ?? ""}`}>
      <div className="space-y-4">
        {tk?.description ? <p className="whitespace-pre-wrap text-xs text-fg-muted">{tk.description}</p> : null}

        {tk ? (
          <div data-ticket-task className="flex flex-wrap items-center gap-2 text-xs">
            {tk.task ? (
              <>
                <span className="font-medium text-fg">{t("work.convert.linked")}</span>
                {tk.task.state === "visible" ? (
                  <Link href={`/tasks/${tk.task.id}`} className="text-accent hover:underline">
                    {tk.task.key} · {tk.task.title}
                  </Link>
                ) : (
                  <span className="text-muted">{t("work.convert.hidden_task")}</span>
                )}
              </>
            ) : (
              <Button type="button" size="sm" variant="secondary" disabled={toTask.isPending} onClick={() => toTask.mutate()}>
                {t("work.convert.task_ticket")}
              </Button>
            )}
          </div>
        ) : null}

        {tk && tk.departmentId === null ? (
          <label className="flex items-center gap-2 text-xs">
            <span className="font-medium text-fg">{t("instant.status")}</span>
            <Select value={tk.status} disabled={setStatus.isPending} onChange={(e) => setStatus.mutate(e.target.value)} className="w-auto min-w-36">
              {enumOptions("TicketStatus").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        {/* Comments */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <MessageSquare className="size-3.5 text-info" />
            {t("tkAct.comments")} ({comments.length})
          </h3>
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {comments.map((c) => {
              const mine = c.author?.id === currentUserId;
              return (
                <li key={c.id} className="rounded-lg border border-border bg-surface-1 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 break-words text-xs font-medium text-fg">{c.author?.name ?? "—"}</p>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-xs text-muted">{fmtDateTime(c.createdAt)}</span>
                      {mine ? (
                        <>
                          <button
                            type="button"
                            aria-label={t("common.edit")}
                            onClick={() => {
                              setEditingId(c.id);
                              setEditBody(c.body);
                            }}
                            className="text-xs text-accent hover:underline"
                          >
                            {t("common.edit")}
                          </button>
                          <button
                            type="button"
                            aria-label={t("common.delete")}
                            className="text-xs text-danger hover:underline"
                            disabled={delComment.isPending}
                            onClick={() => delComment.mutate(c.id)}
                          >
                            {t("common.delete")}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {editingId === c.id ? (
                    <form
                      className="mt-1.5 space-y-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (editBody.trim()) saveEdit.mutate({ id: c.id, body: editBody.trim() });
                      }}
                    >
                      <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={2} />
                      <div className="flex justify-end gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          {t("common.cancel")}
                        </Button>
                        <Button type="submit" size="sm" disabled={saveEdit.isPending}>
                          {t("common.save")}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-fg">{c.body}</p>
                  )}
                </li>
              );
            })}
            {comments.length === 0 ? (
              <li className="py-3 text-center text-xs text-muted">{t("tkAct.noComments")}</li>
            ) : null}
          </ul>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) addComment.mutate();
            }}
          >
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={t("tkAct.commentPlaceholder")} />
            <Button type="submit" size="icon" aria-label={t("tkAct.send")} disabled={!body.trim() || addComment.isPending}>
              <Send className="size-4 rtl:-scale-x-100" />
            </Button>
          </form>
        </section>

        {/* Activity log */}
        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <Activity className="size-3.5 text-ok" />
            {t("tkAct.log")}
          </h3>
          <ul className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface-1 p-2">
            {activities.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span className="min-w-0 break-words">
                  <b className="font-medium text-fg">{a.actor?.name ?? "—"}</b>{" "}
                  {t(EVENT_KEYS[a.event] ?? "tkAct.unknown")}
                  {a.event === "status_changed" && a.meta
                    ? ` (${enumLabel("TicketStatus", String((a.meta as Record<string, unknown>).from ?? ""))} ← ${enumLabel("TicketStatus", String((a.meta as Record<string, unknown>).to ?? ""))})`
                    : ""}
                </span>
                <span className="shrink-0">{fmtDateTime(a.createdAt)}</span>
              </li>
            ))}
            {activities.length === 0 ? <li className="py-2 text-center text-xs text-muted">{t("tkAct.noActivity")}</li> : null}
          </ul>
        </section>
      </div>
    </Modal>
  );
}

/** Unused placeholder to keep the TicketIcon import referenced if UI changes. */
export const _icon = TicketIcon;