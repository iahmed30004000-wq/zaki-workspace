"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Pencil, Plus, Ticket as TicketIcon, Trash2 } from "lucide-react";
import { MAY_ALL, type SectionMay } from "@/lib/section-may";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { enumLabel, enumOptions } from "@/lib/i18n/enums";
import { TicketDetailModal } from "@/components/ticket-detail-modal";

export function errText(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError && err.messageKey) {
    const x = t(err.messageKey);
    return x !== err.messageKey ? x : t("common.error");
  }
  return t("common.error");
}

interface TicketRow {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  priority: string;
  resolvedAt: string | null;
  createdAt: string;
  creator: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
}

const STATUS_CHIP: Record<string, string> = {
  OPEN: "bg-info/10 text-info",
  IN_PROGRESS: "bg-warn/10 text-warn",
  RESOLVED: "bg-ok/10 text-ok",
  CLOSED: "bg-surface-2 text-muted",
};

/** التذاكر — IT desk for one department. */
export function DepartmentTickets({
  deptId,
  deptName,
  emoji,
  currentUserId,
  canAssign,
  may = MAY_ALL,
}: {
  deptId: string;
  deptName: string;
  emoji: string | null;
  currentUserId: string;
  canAssign: boolean; // dept member or org admin
  /** The tickets row of the person's grid: no «يضيف ويعدّل», no new ticket or edit; no «يحذف», no delete. */
  may?: SectionMay;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TicketRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [assigneeId, setAssigneeId] = useState("");

  const tickets = useQuery({
    queryKey: ["tickets", deptId],
    queryFn: () => apiGet<{ tickets: TicketRow[] }>(`/api/departments/${deptId}/tickets`),
  });

  const members = useQuery({
    queryKey: ["departments", "detail", deptId],
    queryFn: () => apiGet<{ members: { id: string; name: string }[] }>(`/api/departments/${deptId}`),
    enabled: canAssign,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tickets", deptId] });
    qc.invalidateQueries({ queryKey: ["departments"] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost(`/api/departments/${deptId}/tickets`, {
        title,
        description: description || null,
        priority,
        assigneeId: assigneeId || null,
      }),
    onSuccess: () => {
      setCreating(false);
      setTitle("");
      setDescription("");
      setAssigneeId("");
      toast(t("ticket.created"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiPatch(`/api/tickets/${id}`, payload),
    onSuccess: () => invalidate(),
    onError: (err) => toast(errText(err, t), "error"),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/tickets/${id}`),
    onSuccess: () => {
      toast(t("ticket.deleted"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const saveEdit = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPatch(`/api/tickets/${editing!.id}`, payload),
    onSuccess: () => {
      setEditing(null);
      toast(t("ticket.updated"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const rows = tickets.data?.tickets ?? [];
  const open = rows.filter((r) => r.status === "OPEN" || r.status === "IN_PROGRESS").length;

  return (
    <>
      {may.edit ? (
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <LifeBuoy className="size-4 text-cat-3" />
          {t("ticket.new")}
        </Button>
      ) : null}

      {detailId ? <TicketDetailModal ticketId={detailId} currentUserId={currentUserId} onClose={() => setDetailId(null)} /> : null}

      {creating ? (
        <Modal open onClose={() => setCreating(false)} title={`${emoji ?? "🎟️"} ${deptName} — ${t("ticket.newTitle")}`}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim().length >= 3) create.mutate();
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ticket.titlePlaceholder")} required minLength={3} maxLength={200} />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t("ticket.descPlaceholder")} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {enumOptions("TaskPriority").map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {canAssign ? (
                <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">{t("ticket.unassigned")}</option>
                  {(members.data?.members ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={create.isPending}>
                <Plus className="size-4" />
                {t("ticket.submit")}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editing ? (
        <Modal open onClose={() => setEditing(null)} title={`T${editing.number} — ${t("ticket.editTitle")}`}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const payload: Record<string, unknown> = {};
              if (title.trim() && title.trim() !== editing.title) payload.title = title.trim();
              if (description !== (editing.description ?? "")) payload.description = description || null;
              if (priority !== editing.priority) payload.priority = priority;
              if (assigneeId !== (editing.assignee?.id ?? "")) payload.assigneeId = assigneeId || null;
              if (Object.keys(payload).length === 0) {
                setEditing(null);
                return;
              }
              saveEdit.mutate(payload);
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t("ticket.descPlaceholder")} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {enumOptions("TaskPriority").map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">{t("ticket.unassigned")}</option>
                {(members.data?.members ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={saveEdit.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-3 space-y-2 rounded-2xl bg-surface-1 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
            <TicketIcon className="size-3.5 text-cat-3" />
            {t("ticket.openCount", { n: open })}
          </p>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span dir="ltr" className="shrink-0 font-mono text-xs text-muted">T{r.number}</span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setDetailId(r.id)}
                    className="w-full truncate text-start text-xs font-medium text-fg hover:text-accent"
                  >
                    {r.title}
                  </button>
                  <p className="truncate text-xs text-muted">
                    {r.creator?.name}
                    {r.assignee ? ` · ${t("ticket.to")} ${r.assignee.name}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${STATUS_CHIP[r.status]}`}>
                  {enumLabel("TicketStatus", r.status)}
                </span>
                {canAssign && may.edit ? (
                  <>
                    <Select
                      value={r.status}
                      onChange={(e) => update.mutate({ id: r.id, payload: { status: e.target.value } })}
                      className="h-7 w-28 text-xs"
                      aria-label={t("ticket.statusLabel")}
                    >
                      {enumOptions("TicketStatus").map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("ticket.edit")}
                      onClick={() => {
                        setEditing(r);
                        setTitle(r.title);
                        setDescription(r.description ?? "");
                        setPriority(r.priority);
                        setAssigneeId(r.assignee?.id ?? "");
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </>
                ) : null}
                {canAssign && may.delete ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("ticket.delete")}
                    className="text-danger"
                    disabled={del.isPending}
                    onClick={() => del.mutate(r.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
