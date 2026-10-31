"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CalendarDays, Pencil, Trash2, User, Flag, Type as TypeIcon, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiDelete, apiPost, apiPatch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui/card";
import { fmtDMY, fmtDateTime } from "@/lib/format";
import { columnLabel, enumLabel, enumOptions } from "@/lib/i18n/enums";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { TaskLinks, type LinkCandidate } from "@/components/task-links";
import { TaskSteps } from "@/components/task-steps/task-steps";
import { RemindTaskButton } from "@/components/reminders/remind-dialog";
import { TaskTimeCard } from "@/components/time/task-time-card";
import type { TaskTimeCard as TimeCardData } from "@/server/services/time-tracking";
import { RecurrenceControl } from "@/components/recurrence/recurrence-control";
import type { RecurrenceDto } from "@/server/services/task-recurrence";
import type { StepDto } from "@/lib/task-steps";
import { TaskAssignRequestBanner, type RequestBannerMode } from "@/components/task-assign-request-banner";
import { errText } from "@/components/department-tickets";
import { PeopleMulti, peopleLine } from "@/components/ui/people-multi";

export interface TaskDetailData {
  id: string;
  number: number;
  key: string;
  title: string;
  description: string | null;
  priority: string;
  type: string;
  /** The name of the board column the task is in (a column's name is whatever the board was given). */
  status: string;
  boardId: string;
  boardName: string;
  dueDate: string | null;
  creatorName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Every person the task is for, in order (the first is `assigneeId`); absent means one person. */
  assigneeIds?: string[];
  /** «المعلم» the task points at, if any (null when the feature is off or the task has none). */
  milestoneId?: string | null;
  milestoneName?: string | null;
  labelIds: string[];
  comments: { id: string; author: string; authorId: string; body: string; createdAt: string }[];
}

export function TaskDetail({
  task,
  canEdit,
  currentUserId,
  members,
  labels,
  links = null,
  milestones = null,
  assignRequests = [],
  steps = null,
  remind = false,
  rewardSlot = null,
  pinSlot = null,
  lockedFields = false,
  time = null,
  recurrence = null,
  customFieldsSlot = null,
  approvalsSlot = null,
}: {
  task: TaskDetailData;
  /** Whether the API would let this person change the task (see canWriteInWorkspace). */
  canEdit: boolean;
  currentUserId: string;
  /** `request`: somebody of a HIGHER rank than the viewer — a pick only ASKS them (src/server/services/task-assign.ts). */
  members: { id: string; name: string; request?: boolean }[];
  labels: { id: string; name: string; color: string }[];
  /** «التبعيات»: null when the company switched it off (the card is not drawn at all). */
  links?: { candidates: LinkCandidate[] } | null;
  /** The milestones of this task's project, or `null` when the company's «المعالم» switch is off. */
  milestones?: { id: string; name: string }[] | null;
  /** The pending requests to give this task to somebody of a higher rank, as the viewer reads each (none for them: not listed). */
  assignRequests?: { id: string; mode: RequestBannerMode; fromName: string; toName: string }[];
  /** «الخطوات»: null when the company switched it off (the card is not drawn); `canEdit` is the steps' own rule (never a guest, never the owner reading silently). */
  steps?: { initial: StepDto[]; canEdit: boolean } | null;
  /** «ذكّرني»: the button is drawn only while the company's switch is on. */
  remind?: boolean;
  /** «مهمة بمكافأة»: the reward card (the page draws it only for somebody who may see rewards: never a partner). */
  rewardSlot?: ReactNode;
  /** «تثبيت»: the pin button (the owner and the space's admin). */
  pinSlot?: ReactNode;
  /** A reward task is the owner's: the title, the description, the day and the rest are read-only for everybody else (the server refuses too). */
  lockedFields?: boolean;
  /** «الوقت»: null when the company switched it off or the person is an external partner (the card is not drawn). */
  time?: TimeCardData | null;
  /** «تكرار»: null when the company switched «مهمة متكررة» off (nothing is drawn); `canEdit` is the series' own rule (never a guest, never the owner reading silently). */
  recurrence?: { initial: RecurrenceDto | null; timeZone: string; canEdit: boolean } | null;
  /** «حقول مخصصة»: the card of the project's fields (the page draws it only while the switch is on, never for a partner). */
  customFieldsSlot?: ReactNode;
  /** «طلب موافقة»: the button and the linked requests (the page draws it only while the switch is on, never for a partner). */
  approvalsSlot?: ReactNode;
}) {
  // «مهمة بمكافأة»: what the person may still change on a reward task is who holds it and the comments
  const fieldsEdit = canEdit && !lockedFields;
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate?.slice(0, 10) ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : []),
  );
  const [milestoneId, setMilestoneId] = useState(task.milestoneId ?? "");
  const [selectedLabels, setSelectedLabels] = useState<string[]>(task.labelIds);
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  // «فلان وفلان»: the people the task is for, read out of the same list the boxes show (never a raw id)
  const assigneeNames =
    peopleLine(
      assigneeIds.map((id) => members.find((m) => m.id === id)?.name ?? "").filter(Boolean),
      t("common.and"),
    ) || (task.assigneeName ?? "");

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiPatch<{
        task: {
          assigneeId?: string | null;
          coAssignees?: { userId: string }[];
          assignRequest?: { toUserId: string } | null;
          coRequests?: { toUserId: string }[];
        };
      }>(`/api/tasks/${task.id}`, data),
    onSuccess: (res) => {
      setError(null);
      if (res.task.assignRequest || res.task.coRequests?.length) {
        // somebody of a higher rank was ASKED: the task keeps the people it had (and gets the others) until they answer
        setAssigneeIds([...(res.task.assigneeId ? [res.task.assigneeId] : []), ...(res.task.coAssignees ?? []).map((r) => r.userId)]);
        toast(t("taskreq.created"), "success");
      } else {
        toast(t("task.updated"), "success");
      }
      router.refresh();
    },
    onError: () => {
      toast(t("common.error"), "error");
      setError("common.error");
    },
  });

  const comment = useMutation({
    mutationFn: (body: string) =>
      apiPost<{ comment: unknown }>(`/api/tasks/${task.id}/comments`, { body }),
    onSuccess: () => {
      setCommentBody("");
      setError(null);
      router.refresh();
    },
    onError: () => {
      toast(t("common.error"), "error");
      setError("common.error");
    },
  });

  const commentEdit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiPatch(`/api/tasks/${task.id}/comments/${id}`, { body }),
    onSuccess: () => {
      setEditingComment(null);
      toast(t("task.updated"), "success");
      router.refresh();
    },
    onError: () => toast(t("common.error"), "error"),
  });

  const commentDelete = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/tasks/${task.id}/comments/${id}`),
    onSuccess: () => {
      toast(t("comment.deleted"), "success");
      router.refresh();
    },
    onError: () => toast(t("common.error"), "error"),
  });

  const answer = useMutation({
    mutationFn: (body: { requestId: string; accept: true } | { requestId: string; accept: false; reason: string }) =>
      body.accept
        ? apiPost(`/api/tasks/${task.id}/request/accept`, { requestId: body.requestId })
        : apiPost(`/api/tasks/${task.id}/request/return`, { requestId: body.requestId, reason: body.reason }),
    onSuccess: (_res, body) => {
      toast(t(body.accept ? "taskreq.accepted" : "taskreq.returned"), "success");
      router.refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");

  function saveIfChanged() {
    const patch: Record<string, unknown> = {};
    if (title !== task.title && title.trim()) patch.title = title.trim();
    if (description !== (task.description ?? "")) patch.description = description || null;
    if (priority !== task.priority) patch.priority = priority;
    if (dueDate !== (task.dueDate?.slice(0, 10) ?? "")) patch.dueDate = dueDate || null;
    // «لمين»: the whole list, the first is the primary — one person works exactly like before
    const before = task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : []);
    if (assigneeIds.join(",") !== before.join(",")) patch.assigneeIds = assigneeIds;
    if (milestoneId !== (task.milestoneId ?? "")) patch.milestoneId = milestoneId || null;
    if (JSON.stringify(selectedLabels) !== JSON.stringify(task.labelIds))
      patch.labelIds = selectedLabels;
    if (Object.keys(patch).length) save.mutate(patch);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="font-mono text-xs text-muted">{task.key}</span>
        <Badge>{columnLabel(task.status)}</Badge>
        <span className="text-xs text-fg-muted">{t("task.inBoard", { name: task.boardName })}</span>
        {remind || recurrence || pinSlot ? (
          <span className="ms-auto flex items-start gap-2">
            {pinSlot}
            {recurrence ? <RecurrenceControl taskId={task.id} initial={recurrence.initial} timeZone={recurrence.timeZone} canEdit={recurrence.canEdit} /> : null}
            {remind ? <RemindTaskButton taskId={task.id} taskTitle={task.title} /> : null}
          </span>
        ) : null}
        {canEdit ? null : <span className={cn("text-xs text-muted", remind || recurrence || pinSlot ? undefined : "ms-auto")}>{t("task.readOnly")}</span>}
      </header>

      {assignRequests.map((r) => (
        <TaskAssignRequestBanner
          key={r.id}
          mode={r.mode}
          fromName={r.fromName}
          toName={r.toName}
          busy={answer.isPending}
          onAccept={() => answer.mutate({ requestId: r.id, accept: true })}
          onReturn={(reason) => answer.mutate({ requestId: r.id, accept: false, reason })}
        />
      ))}

      <Card>
        <CardBody className="space-y-4">
          {fieldsEdit ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveIfChanged}
              className="w-full border-0 bg-transparent text-lg font-semibold text-fg focus:outline-none"
              maxLength={280}
              aria-label={t("task.title")}
            />
          ) : (
            <h1 className="text-lg font-semibold text-fg">{task.title}</h1>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
                <User className="h-3 w-3" /> {t("task.assignee")}
              </span>
              {canEdit ? (
                <div className="space-y-1">
                  <PeopleMulti
                    people={members}
                    value={assigneeIds}
                    onChange={(next) => {
                      setAssigneeIds(next);
                      save.mutate({ assigneeIds: next });
                    }}
                    label={t("task.assignee")}
                    emptyText={t("instant.field.nobody")}
                    requestTag={t("taskreq.tag")}
                  />
                  <span className="block text-xs text-fg-muted">{t("task.assigneesHint")}</span>
                </div>
              ) : (
                <p className="text-sm text-fg">{assigneeNames || t("list.unassigned")}</p>
              )}
              {canEdit && members.some((m) => m.request) ? (
                <p className="mt-1 text-xs text-fg-muted">{`${t("taskreq.tag")}: ${t("taskreq.hint")}`}</p>
              ) : null}
            </div>
            <div>
              <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
                <Flag className="h-3 w-3" /> {t("task.priority")}
              </span>
              {fieldsEdit ? (
                <Select
                  value={priority}
                  onChange={(e) => {
                    setPriority(e.target.value);
                    save.mutate({ priority: e.target.value });
                  }}
                  className="h-8"
                >
                  {enumOptions("TaskPriority").map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-fg">{enumLabel("TaskPriority", task.priority)}</p>
              )}
            </div>
            <div>
              <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
                <CalendarDays className="h-3 w-3" /> {t("task.due")}
              </span>
              {fieldsEdit ? (
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  onBlur={saveIfChanged}
                  className="h-8"
                />
              ) : (
                <p className="text-sm text-fg">{task.dueDate ? fmtDMY(task.dueDate) : "—"}</p>
              )}
            </div>
            {milestones && milestones.length > 0 ? (
              <div>
                <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
                  <Flag className="h-3 w-3" /> {t("task.milestone")}
                </span>
                {fieldsEdit ? (
                  <Select
                    value={milestoneId}
                    onChange={(e) => {
                      setMilestoneId(e.target.value);
                      save.mutate({ milestoneId: e.target.value || null });
                    }}
                    className="h-8"
                  >
                    <option value="">{t("task.noMilestone")}</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-sm text-fg">{task.milestoneName ?? t("task.noMilestone")}</p>
                )}
              </div>
            ) : null}
            <div>
              <span className="mb-1 block text-xs text-fg-muted">{t("task.labels")}</span>
              {fieldsEdit ? (
                <div className="flex flex-wrap gap-1">
                  {labels.map((l) => {
                    const active = selectedLabels.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? selectedLabels.filter((id) => id !== l.id)
                            : [...selectedLabels, l.id];
                          setSelectedLabels(next);
                          save.mutate({ labelIds: next });
                        }}
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-xs transition-colors",
                          active
                            ? "border-accent/60 bg-accent/10 text-fg"
                            : "border-border text-fg-muted hover:border-accent/40",
                        )}
                      >
                        <span
                          aria-hidden
                          className="me-1 inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: l.color }}
                        />
                        {l.name}
                      </button>
                    );
                  })}
                  {labels.length === 0 ? (
                    <p className="text-xs text-muted">{t("task.noLabels")}</p>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {labels
                    .filter((l) => task.labelIds.includes(l.id))
                    .map((l) => (
                      <Badge key={l.id} color={l.color}>
                        {l.name}
                      </Badge>
                    ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
              <TypeIcon className="h-3 w-3" /> {t("task.description")}
            </span>
            {fieldsEdit ? (
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={saveIfChanged}
                rows={4}
                placeholder={t("task.descriptionPlaceholder")}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-fg">{description}</p>
            )}
          </div>

          {error ? <p className="text-xs text-danger">{t(error)}</p> : null}
          {save.isPending ? <p className="text-xs text-muted">{t("common.saving")}</p> : null}
        </CardBody>
      </Card>

      {rewardSlot}

      {customFieldsSlot}

      {steps ? <TaskSteps taskId={task.id} initial={steps.initial} canEdit={steps.canEdit} /> : null}

      {time ? <TaskTimeCard taskId={task.id} initial={time} viewerId={currentUserId} /> : null}

      {links ? <TaskLinks taskId={task.id} canEdit={canEdit} candidates={links.candidates} /> : null}

      {approvalsSlot}

      <Card>
        <CardHeader>
          <p className="text-sm font-semibold text-fg">{t("task.commentsCount", { n: task.comments.length })}</p>
        </CardHeader>
        <CardBody className="space-y-3">
          {task.comments.map((c) => {
            const mine = c.authorId === currentUserId;
            return (
              <div key={c.id} className="rounded-lg border border-border bg-surface-2/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-fg">{c.author}</p>
                  <div className="flex items-center gap-1">
                    <p className="text-xs text-muted">{fmtDateTime(c.createdAt)}</p>
                    {mine && canEdit ? (
                      <>
                        <button
                          type="button"
                          aria-label={t("comment.edit")}
                          onClick={() => {
                            setEditingComment(c.id);
                            setEditingBody(c.body);
                          }}
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("comment.delete")}
                          onClick={() => {
                            if (confirm(t("comment.deleteConfirm"))) commentDelete.mutate(c.id);
                          }}
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                {editingComment === c.id ? (
                  <form
                    className="mt-2 flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editingBody.trim()) commentEdit.mutate({ id: c.id, body: editingBody.trim() });
                    }}
                  >
                    <Textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      rows={2}
                    />
                    <Button type="submit" size="sm" disabled={commentEdit.isPending || !editingBody.trim()}>
                      {t("common.save")}
                    </Button>
                  </form>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{c.body}</p>
                )}
              </div>
            );
          })}
          {task.comments.length === 0 ? (
            <p className="text-xs text-muted">{t("tkAct.noComments")}</p>
          ) : null}

          {canEdit ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (commentBody.trim()) comment.mutate(commentBody.trim());
              }}
            >
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={2}
                placeholder={t("comment.placeholder")}
              />
              <Button type="submit" size="icon" aria-label={t("comment.submit")} disabled={!commentBody.trim()}>
                <Send className="h-4 w-4 rtl:-scale-x-100" />
              </Button>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
