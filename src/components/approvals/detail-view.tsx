"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api-client";
import { fmtDMY, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { minorToAmountText } from "@/lib/rewards";
import { amountText, type Decision } from "@/lib/approvals/shared";
import type { ApprovalDetail } from "@/lib/approvals/view";
import { Button } from "@/components/ui/button";
import { AttachmentList } from "./attachments";
import { Chain } from "./chain";
import { DecisionPanel } from "./decision-panel";
import { errorText } from "./errors";
import { FormFiller } from "./form-filler";
import type { Candidate } from "./approver-picker";
import { MoneyNote, RequestForm, linkLabel } from "./request-form";
import { StatusBadge } from "./status-badge";

/**
 * «طلب الموافقة»: the content, the chain, the files, and what THIS person may do — decide (the approver whose turn it is), cancel or
 * edit and resubmit (the requester). Somebody who reads it only because of their place (a space manager, the owner) gets the
 * line that says so and no button: the server would refuse them anyway. The pure face has no network (`DetailBody`), so a render
 * test and the page draw exactly the same thing.
 */
export function DetailBody({ detail, showSpace = true }: { detail: ApprovalDetail; showSpace?: boolean }) {
  const { t } = useI18n();
  const money = detail.amount ? amountText(detail.amount.minor, detail.amount.currency) : "";
  return (
    <div className="space-y-4" data-approval-detail={detail.id}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-semibold tracking-tight text-fg">{detail.title}</h1>
          <StatusBadge status={detail.status} />
        </div>
        <p className="text-xs text-fg-muted" suppressHydrationWarning>
          {t("approvals.card.by", { name: detail.requester.name })}
          {showSpace && detail.workspaceName ? ` · ${detail.workspaceName}` : ""}
          {` · ${fmtDateTime(detail.createdAt)}`}
          {detail.version > 1 ? ` · ${t("approvals.card.version", { n: detail.version })}` : ""}
          {detail.form ? ` · ${t("approvals.detail.from_form", { name: detail.form.name })}` : ""}
        </p>
        {detail.decidedAt ? (
          <p className="text-xs text-fg-muted" suppressHydrationWarning>
            {t("approvals.detail.decided_at", { date: fmtDMY(detail.decidedAt) })}
          </p>
        ) : null}
      </header>

      {money ? (
        <section className="space-y-2" data-approval-amount>
          <p className="text-sm text-fg">
            <span className="text-xs text-fg-muted">{t("approvals.detail.amount")}: </span>
            <span className="font-semibold">{money}</span>
          </p>
          <MoneyNote />
        </section>
      ) : null}

      {detail.amountHidden ? (
        <section className="space-y-1" data-approval-amount-hidden>
          <p className="text-sm text-fg">
            <span className="text-xs text-fg-muted">{t("approvals.detail.amount")}: </span>
            <span className="font-semibold">{t("approvals.amount_hidden")}</span>
          </p>
          <p className="text-xs text-fg-muted">{t("approvals.amount_hidden_fix")}</p>
        </section>
      ) : null}

      {detail.details ? <p className="whitespace-pre-wrap rounded-xl border border-border bg-surface-1 p-3 text-sm text-fg" data-approval-details>{detail.details}</p> : null}

      {detail.linkedTo ? (
        <p className="text-sm" data-approval-link>
          <span className="text-xs text-fg-muted">{t("approvals.detail.about")}: </span>
          {detail.linkedTo.href ? (
            <Link href={detail.linkedTo.href} className="text-accent hover:underline">
              {linkLabel(detail.linkedTo.kind, t)}
            </Link>
          ) : (
            <span className="text-fg-muted">{t("approvals.detail.link_gone")}</span>
          )}
        </p>
      ) : null}

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-fg">{t("approvals.detail.files")}</h2>
        <AttachmentList files={detail.attachments} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg">{t("approvals.detail.chain")}</h2>
        <Chain steps={detail.stepsDetail} status={detail.status} currentStep={detail.currentStep} />
      </section>

      {detail.previous.length > 0 ? (
        <section className="space-y-2" data-approval-history>
          <h2 className="text-sm font-semibold text-fg">{t("approvals.detail.history")}</h2>
          {detail.previous.map((rev) => (
            <details key={rev.version} className="rounded-xl border border-border bg-surface-1 p-3" data-revision={rev.version}>
              <summary className="cursor-pointer text-sm font-medium text-fg">{t("approvals.detail.version", { n: rev.version })}: {rev.title}</summary>
              <div className="mt-2 space-y-2">
                {rev.details ? <p className="whitespace-pre-wrap text-sm text-fg">{rev.details}</p> : null}
                {rev.amountMinor !== null && rev.currency ? <p className="text-xs text-fg-muted">{amountText(rev.amountMinor, rev.currency)}</p> : null}
                <Chain steps={rev.steps} status="CHANGES_REQUESTED" currentStep={0} />
                <AttachmentList files={rev.attachments} />
              </div>
            </details>
          ))}
        </section>
      ) : null}

      {detail.you.oversight ? <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted" data-approval-oversight>{t("approvals.detail.oversight")}</p> : null}
    </div>
  );
}

export function DetailView({ detail, people }: { detail: ApprovalDetail; people: Candidate[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function decide(decision: Decision, reason: string) {
    await apiPost(`/api/approvals/${detail.id}/decide`, { decision, reason: reason.trim() || null });
    router.refresh();
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/approvals/${detail.id}/cancel`);
      router.refresh();
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  }

  const lastReason = [...detail.stepsDetail].reverse().find((s) => s.status === "CHANGES_REQUESTED");
  const files = detail.attachments.map((a) => ({ id: a.fileId, name: a.name, size: a.size }));

  return (
    <div className="space-y-4">
      <DetailBody detail={detail} />

      {detail.you.canDecide ? <DecisionPanel send={decide} /> : null}

      {detail.you.canResubmit ? (
        <section className="space-y-3 rounded-xl border border-info/40 bg-info/10 p-3" data-resubmit-panel>
          <h2 className="text-sm font-semibold text-fg">{t("approvals.resubmit.title")}</h2>
          {lastReason?.reason ? (
            <p className="whitespace-pre-wrap text-sm text-fg">
              {t("approvals.resubmit.asked", { name: lastReason.approver.name })}: {lastReason.reason}
            </p>
          ) : null}
          {detail.formFill ? (
            <FormFiller
              schema={detail.formFill.schema}
              initial={detail.formFill.answers}
              submitLabel={t("approvals.form.resend")}
              send={async (answers) => {
                await apiPost(`/api/approvals/${detail.id}/resubmit`, { answers });
                router.refresh();
              }}
            />
          ) : (
            <RequestForm
              workspaceId={detail.workspaceId}
              people={people}
              mode="resubmit"
              requestId={detail.id}
              initial={{
                title: detail.title,
                details: detail.details,
                amount: detail.amount ? minorToAmountText(detail.amount.minor) : "",
                currency: detail.amount?.currency ?? "",
                approverIds: detail.stepsDetail.map((s) => s.approver.id),
                files,
              }}
            />
          )}
        </section>
      ) : null}

      {detail.you.canCancel ? (
        <div className="space-y-2">
          {confirmCancel ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-fg">{t("approvals.cancel.confirm")}</span>
              <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void cancel()}>
                {t("approvals.cancel.yes")}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmCancel(false)}>
                {t("approvals.cancel.no")}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmCancel(true)}>
              {t("approvals.cancel.button")}
            </Button>
          )}
          <p className="text-xs text-fg-muted">{t("approvals.cancel.hint")}</p>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
