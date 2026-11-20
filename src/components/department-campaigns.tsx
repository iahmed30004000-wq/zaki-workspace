"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Megaphone, Plus, Trash2 } from "lucide-react";
import { MAY_ALL, type SectionMay } from "@/lib/section-may";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { fmtShort } from "@/lib/format";
import { enumLabel, enumOptions } from "@/lib/i18n/enums";
import { cn } from "@/lib/utils";

export function errText(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError && err.messageKey) {
    const x = t(err.messageKey);
    return x !== err.messageKey ? x : t("common.error");
  }
  return t("common.error");
}

interface CampaignRow {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: "DRAFT" | "SCHEDULED" | "RUNNING" | "DONE" | "CANCELLED";
  priority: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  owner: { id: string; name: string } | null;
  _count: { items: number };
}

const STATUS_CHIP: Record<string, string> = {
  DRAFT: "bg-surface-2 text-fg-muted",
  SCHEDULED: "bg-info/10 text-info",
  RUNNING: "bg-warn/10 text-warn",
  DONE: "bg-ok/10 text-ok",
  CANCELLED: "bg-surface-2 text-muted",
};

const STATUSES = ["DRAFT", "SCHEDULED", "RUNNING", "DONE", "CANCELLED"] as const;

/** W1.6: the task a campaign item became, as this reader may read it: named, or only «hidden» (the fact that a link exists). */
type LinkedTask = { state: "visible"; id: string; key: string; title: string } | { state: "hidden" };
interface ItemRow {
  id: string;
  title: string;
  kind: string;
  dueDate: string;
  doneAt: string | null;
  task: LinkedTask | null;
}

/**
 * W1.6 ⚠️ + 🔧: an item of kind «مهمة» does what a task does, and any item can become one. We do not remove the item, we mark it and give the way out:
 * «اعمل منه مهمة» makes a task through the task service and links both ways (a second click only finds the same task).
 */
export function CampaignItems({ campaignId, canConvert }: { campaignId: string; canConvert: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["campaign-detail", campaignId],
    queryFn: () => apiGet<{ campaign: { items: ItemRow[] } }>(`/api/campaigns/${campaignId}`),
    enabled: open,
  });
  const toTask = useMutation({
    mutationFn: (itemId: string) => apiPost<{ created: boolean; task: LinkedTask }>(`/api/production/campaign-items/${itemId}/task`, {}),
    onSuccess: (res) => {
      toast(t(res.created ? "work.convert.done" : "work.convert.already"), "success");
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaignId] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const items = detail.data?.campaign.items ?? [];
  return (
    <div className="basis-full space-y-1.5">
      <button type="button" className="text-xs text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
        {t(open ? "work.convert.items_hide" : "work.convert.items_show")}
      </button>
      {open ? (
        <ul data-campaign-items className="divide-y divide-border rounded-lg border border-border bg-surface-1">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{it.title}</span>
              <span className="shrink-0 text-muted">{fmtShort(it.dueDate)}</span>
              {it.kind === "task" && !it.task ? (
                <span className="basis-full text-fg-muted">
                  <span aria-hidden="true">⚠️ </span>
                  {t("work.convert.item_warn")}
                  <span className="mx-1" aria-hidden="true">🔧</span>
                  {t("work.convert.item_fix")}
                </span>
              ) : null}
              {it.task ? (
                it.task.state === "visible" ? (
                  <Link href={`/tasks/${it.task.id}`} className="text-accent hover:underline">
                    {t("work.convert.linked")} · {it.task.key}
                  </Link>
                ) : (
                  <span className="text-muted">{t("work.convert.hidden_task")}</span>
                )
              ) : canConvert ? (
                <Button type="button" size="sm" variant="secondary" disabled={toTask.isPending} onClick={() => toTask.mutate(it.id)}>
                  <span aria-hidden="true">🔧</span>
                  {t("work.convert.task_item")}
                </Button>
              ) : null}
            </li>
          ))}
          {detail.isLoading ? <li className="px-2.5 py-2 text-xs text-muted">…</li> : null}
          {!detail.isLoading && items.length === 0 ? <li className="px-2.5 py-2 text-center text-xs text-muted">{t("work.convert.items_empty")}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/** الحملات — marketing calendar for one department. */
export function DepartmentCampaigns({
  deptId,
  deptName,
  emoji,
  canManage,
  currentUserId,
  may = MAY_ALL,
}: {
  deptId: string;
  deptName: string;
  emoji: string | null;
  canManage: boolean;
  currentUserId: string;
  /** The campaigns row of the person's grid: no «يضيف ويعدّل», no new campaign or changes; no «يحذف», no delete. */
  may?: SectionMay;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const campaigns = useQuery({
    queryKey: ["campaigns", deptId],
    queryFn: () => apiGet<{ campaigns: CampaignRow[] }>(`/api/departments/${deptId}/campaigns`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["campaigns", deptId] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost(`/api/departments/${deptId}/campaigns`, {
        title,
        description: description || null,
        priority,
        startDate,
        endDate,
      }),
    onSuccess: () => {
      setCreating(false);
      setTitle("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      toast(t("camp.created"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiPatch(`/api/campaigns/${id}`, payload),
    onSuccess: () => invalidate(),
    onError: (err) => toast(errText(err, t), "error"),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/campaigns/${id}`),
    onSuccess: () => {
      toast(t("camp.deleted"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const rows = campaigns.data?.campaigns ?? [];
  const running = rows.filter((r) => r.status === "RUNNING" || r.status === "SCHEDULED").length;

  return (
    <>
      {may.edit ? (
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Megaphone className="size-4 text-cat-1" />
          {t("camp.new")}
        </Button>
      ) : null}

      {creating ? (
        <Modal open onClose={() => setCreating(false)} title={`${emoji ?? "📣"} ${deptName} — ${t("camp.newTitle")}`}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim().length >= 3 && startDate && endDate) create.mutate();
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("camp.titlePlaceholder")} required minLength={3} maxLength={200} />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t("camp.descPlaceholder")} />
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-muted">{t("camp.start")}</span>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted">{t("camp.end")}</span>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted">{t("camp.priority")}</span>
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {enumOptions("TaskPriority")
                    .filter((o) => o.value !== "NONE")
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </Select>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={create.isPending}>
                <Plus className="size-4" />
                {t("camp.submit")}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
            <CalendarClock className="size-3.5 text-cat-1" />
            {t("camp.activeCount", { n: running })}
          </p>
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const mine = r.owner?.id === currentUserId;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span dir="ltr" className="shrink-0 font-mono text-xs text-muted">C{r.number}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-fg">{r.title}</p>
                    <p className="truncate text-xs text-muted">
                      {fmtShort(r.startDate)} ← {fmtShort(r.endDate)}
                      {r.owner ? ` · ${r.owner.name}` : ""}
                      {` · ${t("camp.itemsLine", { n: r._count.items })}`}
                    </p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_CHIP[r.status])}>
                    {enumLabel("CampaignStatus", r.status)}
                  </span>
                  {canManage && may.edit ? (
                    <Select
                      value={r.status}
                      onChange={(e) => update.mutate({ id: r.id, payload: { status: e.target.value } })}
                      className="h-7 w-28 text-xs"
                      aria-label={t("camp.statusLabel")}
                    >
                      {enumOptions("CampaignStatus").map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {canManage && may.delete ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("camp.delete")}
                      className="text-danger"
                      disabled={del.isPending}
                      onClick={() => {
                        if (confirm(t("camp.deleteConfirm", { title: r.title }))) del.mutate(r.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                  <CampaignItems campaignId={r.id} canConvert={canManage && may.edit} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}