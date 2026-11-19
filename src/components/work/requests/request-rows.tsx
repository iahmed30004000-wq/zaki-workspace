"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TaskAssignRequestBanner } from "@/components/task-assign-request-banner";
import { errorText } from "@/components/approvals/errors";
import { ORGS_QUERY_KEY } from "@/components/shell/space-switcher";
import { apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { APPROVAL_LIMITS, reasonProblem, type Decision } from "@/lib/approvals/shared";
import { fmtDMY, fmtNumber } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import type { ApprovalRow, AssignRow, CardRow, RequestRow, SheetRow, TicketRow } from "./types";

/** The query key every list of the inbox lives under, so one action refreshes whichever tab is on screen. */
export const WORK_REQUESTS_KEY = ["work-requests"] as const;

/**
 * A row acts IN PLACE through the door that already exists for it: the call is made here, the server decides again (rank, turn, rights),
 * a refusal is shown under the row in Arabic, and on success the inbox and the number on «الشغل» are refetched (no page reload).
 */
function useAct() {
  const { t } = useI18n();
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(call: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call();
      await Promise.all([queries.invalidateQueries({ queryKey: WORK_REQUESTS_KEY }), queries.invalidateQueries({ queryKey: ORGS_QUERY_KEY })]);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

function Shell({ row, meta, children, error }: { row: RequestRow; meta: ReactNode; children?: ReactNode; error: string | null }) {
  return (
    <li className="list-none space-y-2 rounded-xl border border-border bg-surface-1 p-3" data-request-row={row.kind} data-request-id={row.id}>
      <div className="space-y-1">
        <Link href={row.href} className="block truncate text-sm font-semibold text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {row.title}
        </Link>
        <p className="text-xs text-fg-muted">{meta}</p>
      </div>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** The line under a title: who, where, when - only what the row has. */
function metaLine(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(" · ");
}

/** A reason box: «اطلب تعديل» and «ارفض» need one (the server refuses without it too). */
function ReasonForm({ busy, submitLabel, onSubmit, onCancel }: { busy: boolean; submitLabel: string; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim() && !busy) onSubmit(reason.trim());
      }}
    >
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={APPROVAL_LIMITS.reason}
        placeholder={t("workreq.reason.label")}
        aria-label={t("workreq.reason.label")}
        className="min-w-0 flex-1"
      />
      <Button type="submit" size="sm" variant="danger" disabled={busy || !reason.trim()}>
        {submitLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {t("workreq.reason.cancel")}
      </Button>
    </form>
  );
}

// ───────────────────────────────────────────────────── approvals ─────────────────────────────────────────────────────

export function ApprovalRowView({ row }: { row: ApprovalRow }) {
  const { t } = useI18n();
  const { busy, error, run, setError } = useAct();
  const [asking, setAsking] = useState<Decision | null>(null);
  const decide = (decision: Decision, reason: string | null) => {
    const problem = reasonProblem(decision, reason);
    if (problem) return setError(t(problem));
    return run(() => apiPost(`/api/approvals/${row.id}/decide`, { decision, reason }));
  };
  return (
    <Shell
      row={row}
      error={error}
      meta={metaLine([
        t("workreq.row.by", { name: row.byName }),
        row.place,
        row.amount,
        row.waitingOn ? t("workreq.row.waiting_on", { name: row.waitingOn }) : null,
        row.status === "CHANGES_REQUESTED" ? t("workreq.row.sent_back") : null,
        fmtDMY(row.at),
      ])}
    >
      {row.canDecide ? (
        asking ? (
          <ReasonForm busy={busy} submitLabel={t(asking === "REJECT" ? "workreq.reject" : "workreq.changes")} onSubmit={(reason) => void decide(asking, reason)} onCancel={() => setAsking(null)} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void decide("APPROVE", null)}>
              {t("workreq.approve")}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setAsking("CHANGES")}>
              {t("workreq.changes")}
            </Button>
            <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => setAsking("REJECT")}>
              {t("workreq.reject")}
            </Button>
          </div>
        )
      ) : null}
    </Shell>
  );
}

// ───────────────────────────────────────────────────── assignment requests ─────────────────────────────────────────────────────

export function AssignRowView({ row }: { row: AssignRow }) {
  const { busy, error, run } = useAct();
  return (
    <Shell row={row} error={error} meta={metaLine([row.key, row.place, fmtDMY(row.at)])}>
      <TaskAssignRequestBanner
        mode={row.canAnswer ? "addressee" : "waiting"}
        fromName={row.fromName}
        toName={row.toName}
        busy={busy}
        onAccept={() => void run(() => apiPost(`/api/tasks/${row.taskId}/request/accept`, { requestId: row.requestId }))}
        onReturn={(reason) => void run(() => apiPost(`/api/tasks/${row.taskId}/request/return`, { reason, requestId: row.requestId }))}
      />
    </Shell>
  );
}

// ───────────────────────────────────────────────────── tickets ─────────────────────────────────────────────────────

export function TicketRowView({ row, viewerId }: { row: TicketRow; viewerId: string }) {
  const { t } = useI18n();
  const { busy, error, run } = useAct();
  return (
    <Shell
      row={row}
      error={error}
      meta={metaLine([
        row.key,
        row.place,
        enumLabel("TaskPriority", row.priority),
        enumLabel("TicketStatus", row.status),
        row.assignee ? t("workreq.row.taken_by", { name: row.assignee }) : t("workreq.row.nobody"),
        fmtDMY(row.at),
      ])}
    >
      {row.canTake || row.canResolve ? (
        <div className="flex flex-wrap gap-2">
          {row.canTake ? (
            <Button type="button" size="sm" disabled={busy} onClick={() => void run(() => apiPatch(`/api/tickets/${row.id}`, { status: "IN_PROGRESS", assigneeId: viewerId }))}>
              {t("workreq.take")}
            </Button>
          ) : null}
          {row.canResolve ? (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => apiPatch(`/api/tickets/${row.id}`, { status: "RESOLVED" }))}>
              {t("workreq.resolve")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Shell>
  );
}

// ───────────────────────────────────────────────────── cards and sheets ─────────────────────────────────────────────────────

export function CardRowView({ row }: { row: CardRow }) {
  const { t } = useI18n();
  const { busy, error, run } = useAct();
  const move = (status: "APPROVED" | "DRAFT") => run(() => apiPut(`/api/cards/${row.id}/status`, { status }));
  return (
    <Shell row={row} error={error} meta={metaLine([row.byName ? t("workreq.row.by", { name: row.byName }) : null, row.place, fmtDMY(row.at)])}>
      {row.canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void move("APPROVED")}>
            {t("workreq.card.approve")}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void move("DRAFT")}>
            {t("workreq.card.back")}
          </Button>
        </div>
      ) : null}
    </Shell>
  );
}

export function SheetRowView({ row }: { row: SheetRow }) {
  const { t } = useI18n();
  const { busy, error, run } = useAct();
  return (
    <Shell
      row={row}
      error={error}
      meta={metaLine([row.byName ? t("workreq.row.by", { name: row.byName }) : null, t("workreq.row.version", { n: fmtNumber(row.version) }), fmtDMY(row.at)])}
    >
      {row.canDecide ? (
        <div className="flex flex-wrap gap-2">
          {/* an approval is of the version the approver SAW: the server refuses it if the sheet moved on */}
          <Button type="button" size="sm" disabled={busy} onClick={() => void run(() => apiPut(`/api/knowledge/${row.id}/status`, { status: "APPROVED", version: row.version }))}>
            {t("workreq.sheet.approve")}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => apiPut(`/api/knowledge/${row.id}/status`, { status: "DRAFT" }))}>
            {t("workreq.sheet.back")}
          </Button>
        </div>
      ) : null}
    </Shell>
  );
}

/** One row, whatever its kind. */
export function RequestRowView({ row, viewerId }: { row: RequestRow; viewerId: string }) {
  switch (row.kind) {
    case "approval":
      return <ApprovalRowView row={row} />;
    case "assign":
      return <AssignRowView row={row} />;
    case "ticket":
      return <TicketRowView row={row} viewerId={viewerId} />;
    case "card":
      return <CardRowView row={row} />;
    case "sheet":
      return <SheetRowView row={row} />;
  }
}
